import prisma from "./db.server";
import { getExecutions, extractFromExecutionData } from "./n8n.server";

const SYNC_BATCH_SIZE = 50;
const SYNC_COOLDOWN = 60_000; // 1 minute between syncs

let syncInProgress = false;
let lastSyncTime = 0;

/**
 * Sync executions from n8n into the local ExecutionOrder table.
 * On first run (empty table), does a full backfill.
 * On subsequent runs, only fetches new/changed executions.
 * Throttled to at most once per minute. Fire-and-forget.
 */
export async function syncExecutions() {
  if (syncInProgress) return;
  if (Date.now() - lastSyncTime < SYNC_COOLDOWN) return;
  syncInProgress = true;

  try {
    const count = await prisma.executionOrder.count();
    if (count === 0) {
      await fullBackfill();
    } else {
      await incrementalSync();
    }
  } catch (e) {
    console.error("[n8n-sync] Sync failed:", e.message);
  } finally {
    syncInProgress = false;
    lastSyncTime = Date.now();
  }
}

/**
 * Full backfill: page through all n8n executions.
 * Uses includeData on the list endpoint so we get orderNumbers
 * without making individual detail calls.
 */
async function fullBackfill() {
  console.log("[n8n-sync] Starting full backfill...");
  let cursor = undefined;
  let total = 0;

  while (true) {
    const response = await getExecutions({
      limit: SYNC_BATCH_SIZE,
      cursor,
      includeData: true,
    });
    const executions = response.data ?? [];
    if (executions.length === 0) break;

    await upsertBatch(executions);
    total += executions.length;

    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  console.log(`[n8n-sync] Full backfill complete: ${total} executions indexed.`);
}

/**
 * Incremental sync: fetch recent executions and stop once we hit ones we already have.
 */
async function incrementalSync() {
  let cursor = undefined;
  let newCount = 0;

  while (true) {
    const response = await getExecutions({
      limit: SYNC_BATCH_SIZE,
      cursor,
      includeData: true,
    });
    const executions = response.data ?? [];
    if (executions.length === 0) break;

    // Check which ones we already have
    const ids = executions.map((e) => String(e.id));
    const existing = await prisma.executionOrder.findMany({
      where: { executionId: { in: ids } },
      select: { executionId: true, status: true },
    });
    const existingMap = new Map(existing.map((e) => [e.executionId, e.status]));

    // Find executions that are new or have a changed status
    const toSync = executions.filter((e) => {
      const existingStatus = existingMap.get(String(e.id));
      return existingStatus === undefined || existingStatus !== e.status;
    });

    if (toSync.length > 0) {
      await upsertBatch(toSync);
      newCount += toSync.length;
    }

    // If all executions in this batch already existed with same status, we're caught up
    if (toSync.length === 0) break;
    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  if (newCount > 0) {
    console.log(`[n8n-sync] Incremental sync: ${newCount} executions updated.`);
  }
}

/**
 * Extract orderNumbers from the already-fetched execution data and upsert into DB.
 * No extra API calls needed — data comes from the list response with includeData=true.
 */
async function upsertBatch(executions) {
  await Promise.all(
    executions.map((exec) => {
      const orderNumber = extractFromExecutionData(exec, "orderNumber");
      return prisma.executionOrder.upsert({
        where: { executionId: String(exec.id) },
        create: {
          executionId: String(exec.id),
          orderNumber: orderNumber != null ? String(orderNumber) : null,
          workflowId: String(exec.workflowId),
          status: exec.status,
          startedAt: exec.startedAt ? new Date(exec.startedAt) : null,
          stoppedAt: exec.stoppedAt ? new Date(exec.stoppedAt) : null,
          mode: exec.mode ?? null,
        },
        update: {
          orderNumber: orderNumber != null ? String(orderNumber) : null,
          status: exec.status,
          stoppedAt: exec.stoppedAt ? new Date(exec.stoppedAt) : null,
        },
      });
    }),
  );
}
