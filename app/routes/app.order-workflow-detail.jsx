import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getExecution, retryExecution } from "../n8n.server";

/**
 * Extract the n8n execution ID from a workflow URL.
 * Handles URLs like:
 *   https://n8n.example.com/workflow/abc123/executions/12345
 *   https://n8n.example.com/execution/12345
 */
function extractExecutionId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const execIdx = parts.indexOf("executions");
    if (execIdx !== -1 && parts[execIdx + 1]) return parts[execIdx + 1];
    const execIdx2 = parts.indexOf("execution");
    if (execIdx2 !== -1 && parts[execIdx2 + 1]) return parts[execIdx2 + 1];
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

async function getExecutionDetail(executionId) {
  if (!executionId) return null;

  const exec = await getExecution(executionId, { includeData: true });
  if (!exec) return null;

  const workflowNodes = exec?.workflowData?.nodes ?? [];
  const runData = exec?.data?.resultData?.runData ?? {};

  const nodes = workflowNodes.map((node) => {
    const runs = runData[node.name];
    const ran = !!runs && runs.length > 0;
    const lastRun = ran ? runs[runs.length - 1] : null;

    const output = lastRun?.data?.main
      ?.flat()
      ?.map((item) => item?.json)
      ?.filter(Boolean) ?? [];

    return {
      name: node.name,
      type: node.type?.split(".").pop() ?? node.type,
      ran,
      startTime: lastRun?.startTime ?? null,
      executionTime: lastRun?.executionTime ?? null,
      error: lastRun?.error?.message ?? null,
      output: output.length === 1 ? output[0] : output.length > 0 ? output : null,
    };
  });

  const ranNodes = nodes
    .filter((n) => n.ran)
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));

  return {
    execution: {
      id: exec.id,
      status: exec.status,
      startedAt: exec.startedAt,
      stoppedAt: exec.stoppedAt,
      mode: exec.mode,
    },
    nodes: ranNodes,
  };
}

async function fetchOne(url) {
  const executionId = extractExecutionId(url);
  if (!executionId) return null;
  try {
    return await getExecutionDetail(executionId);
  } catch (e) {
    console.error(`[order-workflow-detail] Failed to fetch execution ${executionId}:`, e.message);
    return null;
  }
}

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const url = formData.get("url") || "";
  console.log("[order-workflow-detail] Retry requested for URL:", url);

  const executionId = extractExecutionId(url);
  console.log("[order-workflow-detail] Extracted execution ID:", executionId);

  if (!executionId) {
    return json({ ok: false, error: "No execution ID found in URL" }, { status: 400 });
  }

  try {
    const result = await retryExecution(executionId, { loadWorkflow: true });
    console.log("[order-workflow-detail] Retry result:", JSON.stringify(result));
    return json({ ok: true, result });
  } catch (e) {
    console.error(`[order-workflow-detail] Retry failed for ${executionId}:`, e.message);
    return json({ ok: false, error: e.message }, { status: 500 });
  }
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const workflowUrl = url.searchParams.get("workflowUrl") || "";
  const finisherUrl = url.searchParams.get("finisherUrl") || "";

  const [workflow, finisher] = await Promise.all([
    workflowUrl ? fetchOne(workflowUrl) : Promise.resolve(null),
    finisherUrl ? fetchOne(finisherUrl) : Promise.resolve(null),
  ]);

  return json({ workflow, finisher });
};
