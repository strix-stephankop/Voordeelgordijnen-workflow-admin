/**
 * n8n API client for server-side usage.
 *
 * Required environment variables:
 *   N8N_API_URL  – Base URL of your n8n instance (e.g. https://n8n.example.com)
 *   N8N_API_KEY  – API key generated in n8n Settings > n8n API
 */

const N8N_API_URL = () => {
  const url = process.env.N8N_API_URL;
  if (!url) throw new Error("N8N_API_URL environment variable is not set");
  return url.replace(/\/+$/, ""); // strip trailing slashes
};

const N8N_API_KEY = () => {
  const key = process.env.N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY environment variable is not set");
  return key;
};

async function n8nFetch(path, options = {}) {
  const url = `${N8N_API_URL()}/api/v1${path}`;
  return n8nRequest(url, options);
}


async function n8nRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY(),
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`n8n API error ${response.status}: ${body}`);
  }

  return response.json();
}

/**
 * List workflow executions.
 *
 * @param {Object} params
 * @param {string} [params.status]     – Filter by status (success, error, canceled, waiting, running)
 * @param {string} [params.workflowId] – Filter by workflow ID
 * @param {number} [params.limit=20]   – Results per page (max 250)
 * @param {string} [params.cursor]     – Pagination cursor from previous response
 */
export async function getExecutions({ status, workflowId, limit = 20, cursor, includeData = false } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (workflowId) params.set("workflowId", workflowId);
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  if (includeData) params.set("includeData", "true");

  const query = params.toString();
  return n8nFetch(`/executions${query ? `?${query}` : ""}`);
}

/**
 * Extract a value by key from an execution's data.
 * Checks customData first, then searches through all nodes' output data.
 */
export function extractFromExecutionData(execution, key) {
  try {
    // Check customData (set via $execution.customData.set())
    if (execution?.customData?.[key] !== undefined) {
      return execution.customData[key];
    }

    // Check annotation data
    if (execution?.annotation?.customData?.[key] !== undefined) {
      return execution.annotation.customData[key];
    }

    // Search through node output data
    const runData = execution?.data?.resultData?.runData;
    if (!runData) {
      // Debug: log top-level keys to find where the data lives
      console.log("[n8n] Execution top-level keys:", Object.keys(execution || {}));
      return null;
    }

    for (const nodeName of Object.keys(runData)) {
      const runs = runData[nodeName];
      for (const run of runs) {
        const outputs = run?.data?.main;
        if (!outputs) continue;
        for (const output of outputs) {
          if (!output) continue;
          for (const item of output) {
            if (item?.json?.[key] !== undefined) {
              return item.json[key];
            }
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Get a single execution by ID.
 */
export async function getExecution(id, { includeData = false } = {}) {
  const params = includeData ? "?includeData=true" : "";
  return n8nFetch(`/executions/${id}${params}`);
}

/**
 * Retry an execution.
 *
 * @param {string} id – Execution ID
 * @param {Object} [options]
 * @param {boolean} [options.loadWorkflow=true] – Whether to load the latest workflow version
 */
export async function retryExecution(id, { loadWorkflow = true } = {}) {
  return n8nFetch(`/executions/${id}/retry`, {
    method: "POST",
    body: JSON.stringify({ loadWorkflow }),
  });
}

/**
 * List all workflows (for filter dropdowns, etc.).
 * Cached in memory for 5 minutes to avoid repeated fetches.
 */
let workflowsCache = { data: null, expiresAt: 0 };
const CACHE_TTL = 5 * 60 * 1000;

export async function getWorkflows() {
  if (workflowsCache.data && Date.now() < workflowsCache.expiresAt) {
    return workflowsCache.data;
  }
  const result = await n8nFetch("/workflows?active=true");
  workflowsCache = { data: result, expiresAt: Date.now() + CACHE_TTL };
  return result;
}
