import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { queryLinesByOrderNumber, updateLine } from "../supabase.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("orderNumber");

  if (!orderNumber) return json({ lines: [], error: "Missing orderNumber" });

  try {
    const lines = await queryLinesByOrderNumber(orderNumber);
    return json({ lines, error: null });
  } catch (e) {
    console.error("Failed to fetch order lines:", e.message);
    return json({ lines: [], error: e.message });
  }
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const body = await request.json();
  const { lineId, fields } = body;

  if (!lineId || !fields) {
    return json({ ok: false, error: "Missing lineId or fields" }, { status: 400 });
  }

  try {
    const updated = await updateLine(lineId, fields);
    return json({ ok: true, line: updated, error: null });
  } catch (e) {
    console.error("Failed to update line:", e.message);
    return json({ ok: false, error: e.message }, { status: 500 });
  }
};
