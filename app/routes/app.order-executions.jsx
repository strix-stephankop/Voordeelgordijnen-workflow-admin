import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("orderNumber");

  if (!orderNumber) return json({ executions: [] });

  const executions = await prisma.executionOrder.findMany({
    where: { orderNumber },
    orderBy: { startedAt: "desc" },
  });

  return json({
    executions: executions.map((e) => ({
      id: e.executionId,
      orderNumber: e.orderNumber,
      workflowId: e.workflowId,
      status: e.status,
      startedAt: e.startedAt?.toISOString() ?? null,
      stoppedAt: e.stoppedAt?.toISOString() ?? null,
      mode: e.mode,
    })),
  });
};
