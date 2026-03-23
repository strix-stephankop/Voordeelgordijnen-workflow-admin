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

export async function queryTable(table, { from = 0, to = 49, sortBy = "id", sortDir = "desc" } = {}) {
  const { data, error, count } = await supabase
    .from(table)
    .select("*", { count: "exact" })
    .order(sortBy, { ascending: sortDir === "asc" })
    .range(from, to);

  if (error) throw error;
  return { data: data ?? [], count };
}

export async function queryLinesByOrderNumber(orderNumber) {
  const { data, error } = await supabase
    .from("Webattelier - lines")
    .select("*")
    .eq("orderId", orderNumber);

  if (error) throw error;
  return data ?? [];
}

export async function queryLinesByOrderNumbers(orderNumbers) {
  if (!orderNumbers.length) return {};
  const { data, error } = await supabase
    .from("Webattelier - lines")
    .select("*")
    .in("orderId", orderNumbers);

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
  const { data, error } = await supabase
    .from("Webattelier - lines")
    .update(fields)
    .eq("id", lineId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function searchOrders(search, { from = 0, to = 49, sortBy = "id", sortDir = "desc" } = {}) {
  const isNumeric = /^\d+$/.test(search.trim());
  const filters = [`customer name.ilike.%${search}%`];
  if (isNumeric) {
    filters.push(`id.eq.${search.trim()}`);
  }

  const { data, error, count } = await supabase
    .from("Webattelier - orders")
    .select("*", { count: "exact" })
    .or(filters.join(","))
    .order(sortBy, { ascending: sortDir === "asc" })
    .range(from, to);

  if (error) throw error;
  return { data: data ?? [], count };
}
