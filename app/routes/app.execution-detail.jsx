import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getExecution } from "../n8n.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const executionId = url.searchParams.get("id");

  if (!executionId) return json({ nodes: [] });

  try {
    const execution = await getExecution(executionId, { includeData: true });

    const workflowNodes = execution?.workflowData?.nodes ?? [];
    const runData = execution?.data?.resultData?.runData ?? {};

    const nodes = workflowNodes.map((node) => {
      const runs = runData[node.name];
      const ran = !!runs && runs.length > 0;
      const lastRun = ran ? runs[runs.length - 1] : null;

      // Extract output items from the node's run data
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

    // Only keep nodes that actually ran, sorted by execution order
    const ranNodes = nodes
      .filter((n) => n.ran)
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));

    return json({ nodes: ranNodes });
  } catch (e) {
    console.error("Failed to fetch execution detail:", e.message);
    return json({ nodes: [], error: e.message });
  }
};
