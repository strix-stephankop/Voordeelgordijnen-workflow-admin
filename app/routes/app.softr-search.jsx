import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  searchSoftrRecords,
  hasCachedData,
  syncSoftrData,
  deleteSoftrRecord,
  updateSoftrRecord,
} from "../softr.server";

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("_action");
  const tableId = formData.get("tableId");
  const recordId = formData.get("recordId");

  if (!tableId || !recordId) {
    return json({ ok: false, error: "Missing tableId or recordId" }, { status: 400 });
  }

  if (intent === "update") {
    const fieldId = formData.get("fieldId");
    const value = formData.get("value");
    if (!fieldId) {
      return json({ ok: false, error: "Missing fieldId" }, { status: 400 });
    }
    try {
      await updateSoftrRecord(tableId, recordId, { [fieldId]: value });
      return json({ ok: true });
    } catch (e) {
      console.error("Softr update failed:", e.message);
      return json({ ok: false, error: e.message }, { status: 500 });
    }
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
