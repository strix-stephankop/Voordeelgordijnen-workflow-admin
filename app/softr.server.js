/**
 * Softr Database API client + local DB cache.
 *
 * Required environment variables:
 *   SOFTR_API_KEY      – API key from your Softr workspace
 *   SOFTR_DATABASE_ID  – Database ID to sync
 */

import prisma from "./db.server";

const SOFTR_BASE = "https://tables-api.softr.io/api/v1";

function getApiKey() {
  const key = process.env.SOFTR_API_KEY;
  if (!key) throw new Error("SOFTR_API_KEY environment variable is not set");
  return key;
}

function getDatabaseId() {
  const id = process.env.SOFTR_DATABASE_ID;
  if (!id) throw new Error("SOFTR_DATABASE_ID environment variable is not set");
  return id;
}

async function softrFetch(path) {
  const url = `${SOFTR_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      "Softr-Api-Key": getApiKey(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Softr API error ${response.status}: ${body}`);
  }

  return response.json();
}

/** List all tables for a database. */
async function getTables(databaseId) {
  const result = await softrFetch(`/databases/${databaseId}/tables`);
  return result.data ?? [];
}

/** Get a single table (with fields) by ID. */
async function getTable(databaseId, tableId) {
  const result = await softrFetch(`/databases/${databaseId}/tables/${tableId}`);
  return result.data ?? null;
}

/**
 * Sync all tables + fields from Softr API into the local database.
 * Deletes existing data and replaces with fresh data.
 */
export async function syncSoftrData() {
  const databaseId = getDatabaseId();
  const tablesList = await getTables(databaseId);
  const detailed = await Promise.all(
    tablesList.map((t) => getTable(databaseId, t.id)),
  );
  const tables = detailed.filter(Boolean);

  await prisma.$transaction(async (tx) => {
    // Clear existing data (cascade deletes fields)
    await tx.softrField.deleteMany();
    await tx.softrTable.deleteMany();

    for (const table of tables) {
      await tx.softrTable.create({
        data: {
          id: table.id,
          name: table.name,
          description: table.description ?? null,
          primaryFieldId: table.primaryFieldId ?? null,
          defaultViewId: table.defaultViewId ?? null,
          fields: {
            create: (table.fields ?? []).map((field) => ({
              id: field.id,
              name: field.name,
              type: field.type,
              required: field.required ?? false,
              readonly: field.readonly ?? false,
              locked: field.locked ?? false,
              allowMultipleEntries: field.allowMultipleEntries ?? false,
              defaultValue: field.defaultValue != null ? String(field.defaultValue) : null,
              options: field.options ? JSON.stringify(field.options) : null,
              createdAt: field.createdAt ? new Date(field.createdAt) : null,
              updatedAt: field.updatedAt ? new Date(field.updatedAt) : null,
            })),
          },
        },
      });
    }
  });

  return tables.length;
}

/**
 * Get all tables with fields from the local database.
 * Returns [] if no data has been synced yet.
 */
export async function getCachedTables() {
  const tables = await prisma.softrTable.findMany({
    include: { fields: true },
    orderBy: { name: "asc" },
  });
  return tables;
}

/**
 * Check if any Softr data has been synced.
 */
export async function hasCachedData() {
  const count = await prisma.softrTable.count();
  return count > 0;
}

async function softrPost(path, body) {
  const url = `${SOFTR_BASE}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Softr-Api-Key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Softr API error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Delete a record from a Softr table.
 */
export async function deleteSoftrRecord(tableId, recordId) {
  const databaseId = getDatabaseId();
  const url = `${SOFTR_BASE}/databases/${databaseId}/tables/${tableId}/records/${recordId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "Softr-Api-Key": getApiKey(),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Softr API error ${response.status}: ${text}`);
  }
}

// Map table names to the field names used for order search
const TABLE_SEARCH_FIELDS = {
  "Kleurstalen": ["orderNumber"],
  "Ne DistriService": ["orderNumber"],
  "Webattelier - lines": ["OrderID"],
  "Webattelier - orders": ["ID"],
};

/** Normalize a Softr field value for display. */
function resolveFieldValue(value) {
  if (value == null) return value;
  // SELECT fields: { id, label }
  if (typeof value === "object" && !Array.isArray(value) && value.label != null) {
    return value.label;
  }
  // ATTACHMENT fields: [{ url, filename, ... }]
  if (Array.isArray(value) && value.length > 0 && value[0]?.url) {
    return value.map((att) => ({ url: att.url, filename: att.filename || "Download" }));
  }
  return value;
}

// NUMBER fields need IS (exact match), text fields use CONTAINS
const NUMBER_TYPES = new Set(["NUMBER", "FORMULA"]);

/**
 * Search Softr records across configured tables by order-related fields.
 * Returns results grouped by table.
 */
export async function searchSoftrRecords(query, { limit = 10 } = {}) {
  if (!query || !query.trim()) return [];

  const databaseId = getDatabaseId();
  const tables = await getCachedTables();
  if (tables.length === 0) return [];

  // Only search tables that have a configured search field
  const searchableTables = tables.filter((t) => TABLE_SEARCH_FIELDS[t.name]);

  const searches = searchableTables.map(async (table) => {
    const fieldNames = TABLE_SEARCH_FIELDS[table.name];
    const searchableFields = table.fields.filter((f) =>
      fieldNames.includes(f.name),
    );

    if (searchableFields.length === 0) return null;

    const conditions = searchableFields.map((f) => ({
      leftSide: f.id,
      operator: "IS",
      rightSide: NUMBER_TYPES.has(f.type) ? Number(query.trim()) : query.trim(),
    }));

    const condition =
      conditions.length === 1
        ? conditions[0]
        : { operator: "OR", conditions };

    const body = { filter: { condition }, paging: { offset: 0, limit } };
    console.log(`[softr-search] ${table.name}: POST`, JSON.stringify(body));

    const result = await softrPost(
      `/databases/${databaseId}/tables/${table.id}/records/search`,
      body,
    );

    console.log(`[softr-search] ${table.name}: ${result.data?.length ?? 0} records, total=${result.metadata?.total}`);

    const records = (result.data ?? []).map((record) => {
      // Resolve field IDs to field names
      const fields = {};
      for (const [fieldId, value] of Object.entries(record.fields ?? {})) {
        const fieldDef = table.fields.find((f) => f.id === fieldId);
        const name = fieldDef ? fieldDef.name : fieldId;
        fields[name] = resolveFieldValue(value);
      }
      return { id: record.id, fields };
    });

    return {
      tableId: table.id,
      tableName: table.name,
      records,
      total: result.metadata?.total ?? records.length,
    };
  });

  const settled = await Promise.allSettled(searches);

  for (const r of settled) {
    if (r.status === "rejected") {
      console.error("[softr-search] rejected:", r.reason?.message ?? r.reason);
    }
  }

  return settled
    .filter((r) => r.status === "fulfilled" && r.value && r.value.records.length > 0)
    .map((r) => r.value);
}
