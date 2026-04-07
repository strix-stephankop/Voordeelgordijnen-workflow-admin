import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
}

if (process.env.NODE_ENV !== "production") {
  if (!global.supabaseGlobal) {
    global.supabaseGlobal = createClient(supabaseUrl, supabaseKey);
  }
}

const supabase = global.supabaseGlobal ?? createClient(supabaseUrl, supabaseKey);

export default supabase;

export async function queryTable(table, { from = 0, to = 49, sortBy = "id", sortDir = "desc", status = "" } = {}) {
  let query = supabase
    .from(table)
    .select("*", { count: "exact" })
    .order(sortBy, { ascending: sortDir === "asc" })
    .range(from, to);

  if (status) {
    query = query.ilike("status", status);
  }

  const { data, error, count } = await query;

  if (error) throw error;
  return { data: data ?? [], count };
}

export async function queryLinesByOrderNumber(orderNumber) {
  const { data, error } = await supabase
    .from("Webattelier - lines")
    .select("*")
    .eq("orderId", orderNumber)
    .order("customer_reference", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function queryLinesByOrderNumbers(orderNumbers) {
  if (!orderNumbers.length) return {};
  const { data, error } = await supabase
    .from("Webattelier - lines")
    .select("*")
    .in("orderId", orderNumbers)
    .order("customer_reference", { ascending: true });

  if (error) throw error;

  const grouped = {};
  for (const line of data ?? []) {
    const key = String(line.orderId);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(line);
  }
  return grouped;
}

export async function updateLine(lineId, fields) {
  // First get the current line to access orderJson
  const { data: current, error: fetchError } = await supabase
    .from("Webattelier - lines")
    .select("*")
    .eq("id", lineId)
    .single();

  if (fetchError) throw fetchError;

  // Update orderJson with the new field values
  let orderJson = {};
  try {
    orderJson = typeof current.orderJson === "string"
      ? JSON.parse(current.orderJson)
      : (current.orderJson || {});
  } catch {}

  const jsonFieldMap = {
    panelsLeft: "panelsLeft",
    panelsRight: "panelsRight",
    finishedWidthLeftInMm: "finishedWidthLeftInMm",
    finishedWidthRightInMm: "finishedWidthRightInMm",
    cutSizeLeftInMm: "cutSizeLeftInMm",
    cutSizeRightInMm: "cutSizeRightInMm",
  };

  for (const [fieldKey, jsonKey] of Object.entries(jsonFieldMap)) {
    if (fields[fieldKey] !== undefined) {
      orderJson[jsonKey] = fields[fieldKey];
    }
  }

  fields.orderJson = JSON.stringify(orderJson);

  // Update the line
  const { data, error } = await supabase
    .from("Webattelier - lines")
    .update(fields)
    .eq("id", lineId)
    .select()
    .single();

  if (error) throw error;

  // Update customerJson on all lines for this order
  await rebuildCustomerJson(current.orderId);

  return data;
}

async function rebuildCustomerJson(orderId) {
  // Get all lines for this order
  const { data: lines, error: linesErr } = await supabase
    .from("Webattelier - lines")
    .select("id, orderJson, customerJson")
    .eq("orderId", orderId)
    .order("customer_reference", { ascending: true });

  if (linesErr || !lines || lines.length === 0) return;

  // Parse the customerJson from the first line as template
  let customerJson = {};
  try {
    const raw = lines[0].customerJson;
    customerJson = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
  } catch {}

  // Rebuild orderLines from each line's orderJson
  customerJson.orderLines = lines.map((l) => {
    try {
      return typeof l.orderJson === "string" ? JSON.parse(l.orderJson) : (l.orderJson || {});
    } catch {
      return {};
    }
  });

  const updatedCustomerJson = JSON.stringify(customerJson);

  // Update customerJson on all lines for this order
  await supabase
    .from("Webattelier - lines")
    .update({ customerJson: updatedCustomerJson })
    .eq("orderId", orderId);
}

export async function querySyncChecks({ from = 0, to = 49 } = {}) {
  const { data, error, count } = await supabase
    .from("sync_checks")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: data ?? [], count };
}

export async function getSyncCheck(id) {
  const { data, error } = await supabase
    .from("sync_checks")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function updateSyncCheckReport(id, report) {
  const { data, error } = await supabase
    .from("sync_checks")
    .update({ report })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function queryGrandHome({ from = 0, to = 49, search = "" } = {}) {
  let query = supabase
    .from("grandhome")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search.trim()) {
    query = query.ilike("ordernumber", `%${search.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data ?? [], count };
}

export async function searchOrders(search, { from = 0, to = 49, sortBy = "id", sortDir = "desc", status = "" } = {}) {
  const isNumeric = /^\d+$/.test(search.trim());
  const filters = [`customer name.ilike.%${search}%`];
  if (isNumeric) {
    filters.push(`id.eq.${search.trim()}`);
  }

  let query = supabase
    .from("Webattelier - orders")
    .select("*", { count: "exact" })
    .or(filters.join(","))
    .order(sortBy, { ascending: sortDir === "asc" })
    .range(from, to);

  if (status) {
    query = query.ilike("status", status);
  }

  const { data, error, count } = await query;

  if (error) throw error;
  return { data: data ?? [], count };
}
