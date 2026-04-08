import prisma from "./db.server";
import { getExecutions, extractFromExecutionData } from "./n8n.server";

const MAX_ROWS = 10;
const SYNC_COOLDOWN = 60_000; // 1 minute between syncs

let syncInProgress = false;
let lastSyncTime = 0;

/**
 * Sync the 10 most recent executions from n8n into the local ExecutionOrder table.
 * Throttled to at most once per minute. Fire-and-forget.
 */
export async function syncExecutions() {
  if (syncInProgress) return;
  if (Date.now() - lastSyncTime < SYNC_COOLDOWN) return;
  syncInProgress = true;

  try {
    const response = await getExecutions({
      limit: MAX_ROWS,
      includeData: true,
    });
    const executions = response.data ?? [];

    if (executions.length > 0) {
      await upsertBatch(executions);
    }

    // Prune old rows beyond the 10 most recent
    await pruneOldRows();
  } catch (e) {
    console.error("[n8n-sync] Sync failed:", e.message);
  } finally {
    syncInProgress = false;
    lastSyncTime = Date.now();
  }
}

/**
 * Keep only the MAX_ROWS most recent executions in the local DB.
 */
async function pruneOldRows() {
  const keep = await prisma.executionOrder.findMany({
    orderBy: { startedAt: "desc" },
    take: MAX_ROWS,
    select: { id: true },
  });
  const keepIds = keep.map((r) => r.id);

  if (keepIds.length > 0) {
    await prisma.executionOrder.deleteMany({
      where: { id: { notIn: keepIds } },
    });
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
