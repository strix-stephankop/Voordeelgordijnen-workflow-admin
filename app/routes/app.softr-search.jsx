import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  searchSoftrRecords,
  hasCachedData,
  syncSoftrData,
  deleteSoftrRecord,
} from "../softr.server";

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const tableId = formData.get("tableId");
  const recordId = formData.get("recordId");

  if (!tableId || !recordId) {
    return json({ ok: false, error: "Missing tableId or recordId" }, { status: 400 });
  }

  try {
    await deleteSoftrRecord(tableId, recordId);
    return json({ ok: true });
  } catch (e) {
    console.error("Softr delete failed:", e.message);
    return json({ ok: false, error: e.message }, { status: 500 });
  }
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";

  if (!q.trim()) {
    return json({ results: [], query: q, error: null });
  }

  try {
    // Auto-sync schema if not cached yet
    const hasData = await hasCachedData();
    if (!hasData) {
      await syncSoftrData();
    }

    const results = await searchSoftrRecords(q);
    return json({ results, query: q, error: null });
  } catch (e) {
    console.error("Softr search failed:", e.message);
    return json({ results: [], query: q, error: e.message });
  }
};
