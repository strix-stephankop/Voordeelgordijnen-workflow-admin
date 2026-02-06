import { useEffect, useState } from "react";
import {
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
  useFetcher,
} from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  InlineStack,
  Select,
  BlockStack,
  EmptyState,
  Banner,
  Pagination,
  SkeletonBodyText,
  Divider,
  Box,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getExecutions, getWorkflows, extractFromExecutionData } from "../n8n.server";

const PAGE_SIZE = 10;

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const workflowId = url.searchParams.get("workflowId") || "";
  const cursor = url.searchParams.get("cursor") || "";

  let workflows = [];
  let error = null;

  try {
    workflows = (await getWorkflows().catch(() => ({ data: [] }))).data ?? [];
  } catch {}

  // Paginated fetch — single API call with includeData
  try {
    const response = await getExecutions({
      status: status || undefined,
      workflowId: workflowId || undefined,
      cursor: cursor || undefined,
      limit: PAGE_SIZE,
      includeData: true,
    });

    const executionsList = response.data ?? [];
    const nextCursor = response.nextCursor ?? null;

    const executions = executionsList.map((exec) => ({
      id: exec.id,
      workflowId: exec.workflowId,
      status: exec.status,
      startedAt: exec.startedAt,
      stoppedAt: exec.stoppedAt,
      mode: exec.mode,
      orderNumber: extractFromExecutionData(exec, "orderNumber") ?? null,
    }));

    return json({
      executions,
      nextCursor,
      workflows,
      filters: { status, workflowId },
      error: null,
    });
  } catch (e) {
    console.error("Failed to load executions:", e.message);
    return json({
      executions: [],
      nextCursor: null,
      workflows,
      filters: { status, workflowId },
      error: e.message,
    });
  }
};

const STATUS_BADGE_MAP = {
  success: { tone: "success", label: "Success" },
  error: { tone: "critical", label: "Error" },
  canceled: { tone: "warning", label: "Canceled" },
  waiting: { tone: "attention", label: "Waiting" },
  running: { tone: "info", label: "Running" },
};

function StatusBadge({ status }) {
  const config = STATUS_BADGE_MAP[status] || { tone: undefined, label: status };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

function formatDate(dateString) {
  if (!dateString) return "\u2014";
  return new Date(dateString).toLocaleString();
}

function formatDuration(startedAt, stoppedAt) {
  if (!startedAt || !stoppedAt) return "\u2014";
  const ms = new Date(stoppedAt) - new Date(startedAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

const TABLE_HEADINGS = [
  { title: "Order" },
  { title: "ID" },
  { title: "Workflow" },
  { title: "Status" },
  { title: "Started" },
];

function SkeletonTable() {
  return (
    <IndexTable
      itemCount={5}
      headings={TABLE_HEADINGS}
      selectable={false}
    >
      {[...Array(5)].map((_, i) => (
        <IndexTable.Row id={`skeleton-${i}`} key={i} position={i}>
          {[...Array(5)].map((_, j) => (
            <IndexTable.Cell key={j}>
              <SkeletonBodyText lines={1} />
            </IndexTable.Cell>
          ))}
        </IndexTable.Row>
      ))}
    </IndexTable>
  );
}

function DetailRow({ label, value }) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="200">
      <Text variant="bodySm" tone="subdued">{label}</Text>
      {typeof value === "string" ? (
        <Text variant="bodySm" as="span">{value}</Text>
      ) : (
        value
      )}
    </InlineStack>
  );
}

function formatNodeDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function NodeIcon({ error }) {
  const bg = error ? "#e51c00" : "#29845a";
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {error ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3l6 6M9 3l-6 6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.5l2.5 2.5 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

function SkeletonNode({ isLast }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flexShrink: 0 }}>
        <div
          className="skeleton-pulse"
          style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--p-color-bg-fill-tertiary)" }}
        />
        {!isLast && (
          <div style={{ width: 2, flex: 1, background: "var(--p-color-border)", minHeight: 8 }} />
        )}
      </div>
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 8, minWidth: 0 }}>
        <div
          className="skeleton-pulse"
          style={{
            background: "var(--p-color-bg-surface)",
            border: "1px solid var(--p-color-border)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          <div style={{ height: 14, width: "60%", borderRadius: 4, background: "var(--p-color-bg-fill-tertiary)", marginBottom: 6 }} />
          <div style={{ height: 12, width: "35%", borderRadius: 4, background: "var(--p-color-bg-fill-tertiary)" }} />
        </div>
      </div>
    </div>
  );
}

function SkeletonNodes() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {[0, 1, 2].map((i) => (
        <SkeletonNode key={i} isLast={i === 2} />
      ))}
    </div>
  );
}

function WorkflowNodes({ nodes, isLoading }) {
  const [expandedNodes, setExpandedNodes] = useState({});

  if (isLoading) {
    return <SkeletonNodes />;
  }

  if (!nodes || nodes.length === 0) return null;

  function toggleNode(name) {
    setExpandedNodes((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {nodes.map((node, index) => {
        const isLast = index === nodes.length - 1;
        const isExpanded = !!expandedNodes[node.name];
        const hasOutput = node.output != null;

        return (
          <div key={node.name} style={{ display: "flex", gap: 12 }}>
            {/* Timeline column */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: 24,
                flexShrink: 0,
              }}
            >
              <NodeIcon error={node.error} />
              {!isLast && (
                <div
                  style={{
                    width: 2,
                    flex: 1,
                    background: "var(--p-color-border)",
                    minHeight: 8,
                  }}
                />
              )}
            </div>

            {/* Card column */}
            <div style={{ flex: 1, paddingBottom: isLast ? 0 : 8, minWidth: 0 }}>
              <div
                onClick={hasOutput ? () => toggleNode(node.name) : undefined}
                style={{
                  background: "var(--p-color-bg-surface)",
                  border: "1px solid var(--p-color-border)",
                  borderRadius: isExpanded ? "10px 10px 0 0" : "10px",
                  padding: "10px 12px",
                  cursor: hasOutput ? "pointer" : "default",
                  transition: "box-shadow 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (hasOutput) e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text variant="bodySm" fontWeight="semibold" truncate>
                      {node.name}
                    </Text>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <Text variant="bodySm" tone="subdued" as="span">
                        {node.type}
                      </Text>
                      {node.executionTime != null && (
                        <>
                          <span style={{ color: "var(--p-color-text-subdued)", fontSize: 10 }}>·</span>
                          <Text variant="bodySm" tone="subdued" as="span">
                            {formatNodeDuration(node.executionTime)}
                          </Text>
                        </>
                      )}
                    </div>
                  </div>
                  {hasOutput && (
                    <span
                      style={{
                        display: "inline-flex",
                        transition: "transform 0.15s ease",
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        color: "var(--p-color-text-subdued)",
                        fontSize: 10,
                        flexShrink: 0,
                      }}
                    >
                      ▶
                    </span>
                  )}
                </div>
                {node.error && (
                  <div style={{ marginTop: 6, padding: "4px 8px", background: "var(--p-color-bg-surface-critical)", borderRadius: 6 }}>
                    <Text variant="bodySm" tone="critical">
                      {node.error}
                    </Text>
                  </div>
                )}
              </div>
              {isExpanded && hasOutput && (
                <div
                  style={{
                    border: "1px solid var(--p-color-border)",
                    borderTop: "none",
                    borderRadius: "0 0 10px 10px",
                    background: "var(--p-color-bg-surface-secondary)",
                    overflow: "hidden",
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      padding: "10px 12px",
                      fontSize: "11px",
                      lineHeight: "1.5",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: "280px",
                      overflowY: "auto",
                      color: "var(--p-color-text-secondary)",
                      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                    }}
                  >
                    {JSON.stringify(node.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderOverview({ execution, executionNodes, nodesLoading, relatedExecutions, workflowNameMap }) {
  if (!execution) {
    return (
      <Card>
        <Box padding="600">
          <BlockStack gap="200" inlineAlign="center">
            <Text variant="headingMd" as="h2" alignment="center" tone="subdued">
              Order overview
            </Text>
            <Text variant="bodySm" as="p" alignment="center" tone="subdued">
              Select an execution to view order details
            </Text>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  return (
    <Card>
      {nodesLoading && (
        <div style={{ height: 3, overflow: "hidden", borderRadius: "12px 12px 0 0" }}>
          <div className="loading-bar" style={{
            height: "100%",
            width: "40%",
            background: "var(--p-color-bg-fill-info)",
            borderRadius: 3,
          }} />
        </div>
      )}
      <Box padding="400">
        <BlockStack gap="400">
          {execution.orderNumber ? (
            <Text variant="headingLg" as="h2">
              Order #{execution.orderNumber}
            </Text>
          ) : (
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">
                Execution #{execution.id}
              </Text>
              <Text variant="bodySm" tone="subdued">No order number</Text>
            </BlockStack>
          )}

          <Divider />

          <BlockStack gap="300">
            <DetailRow label="ID" value={execution.id} />
            <DetailRow
              label="Workflow"
              value={workflowNameMap[String(execution.workflowId)] || `Workflow ${execution.workflowId}`}
            />
            <DetailRow label="Status" value={<StatusBadge status={execution.status} />} />
            <DetailRow label="Started" value={formatDate(execution.startedAt)} />
            <DetailRow label="Duration" value={formatDuration(execution.startedAt, execution.stoppedAt)} />
            <DetailRow label="Trigger" value={execution.mode || "\u2014"} />
          </BlockStack>

          <Divider />
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingSm" as="h3">Workflow Steps</Text>
              {nodesLoading && <Spinner size="small" />}
            </InlineStack>
            <WorkflowNodes nodes={executionNodes} isLoading={nodesLoading} />
          </BlockStack>

          {execution.orderNumber && relatedExecutions.length > 1 && (
            <>
              <Divider />
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">
                  Related Runs ({relatedExecutions.length})
                </Text>
                <BlockStack gap="200">
                  {relatedExecutions.map((e) => (
                    <Box
                      key={e.id}
                      padding="300"
                      background={e.id === execution.id ? "bg-surface-secondary" : "bg-surface"}
                      borderRadius="200"
                      borderColor="border"
                      borderWidth="025"
                    >
                      <InlineStack align="space-between" blockAlign="center" gap="200">
                        <BlockStack gap="050">
                          <Text variant="bodySm" fontWeight="semibold">
                            {workflowNameMap[String(e.workflowId)] || `Workflow ${e.workflowId}`}
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            {formatDate(e.startedAt)} · {formatDuration(e.startedAt, e.stoppedAt)}
                          </Text>
                        </BlockStack>
                        <StatusBadge status={e.status} />
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </>
          )}
        </BlockStack>
      </Box>
    </Card>
  );
}

export default function Executions() {
  const { executions, nextCursor, workflows, filters, error } =
    useLoaderData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailFetcher = useFetcher();

  const isNavigating = navigation.state === "loading";
  const isLoading = isNavigating && !revalidator.state;

  const [selectedExecution, setSelectedExecution] = useState(null);

  // Clear selection when filters or page change (not on auto-refresh)
  const cursorParam = searchParams.get("cursor") || "";
  useEffect(() => {
    setSelectedExecution(null);
  }, [filters.status, filters.workflowId, cursorParam]);

  // Auto-refresh every 5 seconds, only when page is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle" && document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [revalidator]);

  const workflowOptions = [
    { label: "All workflows", value: "" },
    ...workflows.map((w) => ({ label: w.name, value: String(w.id) })),
  ];

  const statusOptions = [
    { label: "All statuses", value: "" },
    { label: "Success", value: "success" },
    { label: "Error", value: "error" },
    { label: "Running", value: "running" },
    { label: "Waiting", value: "waiting" },
    { label: "Canceled", value: "canceled" },
  ];

  const workflowNameMap = Object.fromEntries(
    workflows.map((w) => [String(w.id), w.name]),
  );

  function updateParams(updates) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    params.delete("cursor");
    setSearchParams(params);
  }

  function handleFilterChange(key, value) {
    updateParams({ [key]: value });
  }

  function handleNextPage() {
    if (!nextCursor) return;
    const params = new URLSearchParams(searchParams);
    params.set("cursor", nextCursor);
    setSearchParams(params);
  }

  function handlePreviousPage() {
    const params = new URLSearchParams(searchParams);
    params.delete("cursor");
    setSearchParams(params);
  }

  function handleSelectExecution(execution) {
    setSelectedExecution(execution);
    detailFetcher.load(
      `/app/execution-detail?id=${encodeURIComponent(execution.id)}`,
    );
  }

  function handleTableClick(e) {
    if (e.target.closest("a, button, input")) return;
    const row = e.target.closest("tbody tr");
    if (!row || !row.id) return;
    const execution = executions.find((ex) => String(ex.id) === row.id);
    if (execution) handleSelectExecution(execution);
  }

  const detailLoading = detailFetcher.state === "loading";
  // Show nodes only when data matches the selected execution (avoid stale data flash)
  const executionNodes =
    !detailLoading && detailFetcher.data?.nodes ? detailFetcher.data.nodes : [];
  const hasCursor = searchParams.has("cursor");

  // Related executions from the current page sharing the same order number
  const relatedExecutions = selectedExecution?.orderNumber
    ? executions.filter((e) => e.orderNumber === selectedExecution.orderNumber)
    : [];

  const selectedId = selectedExecution ? String(selectedExecution.id) : null;

  const rowMarkup = executions.map((execution, index) => (
    <IndexTable.Row
      id={String(execution.id)}
      key={execution.id}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {execution.orderNumber ? `#${execution.orderNumber}` : "\u2014"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{execution.id}</IndexTable.Cell>
      <IndexTable.Cell>
        {workflowNameMap[String(execution.workflowId)] ||
          `Workflow ${execution.workflowId}`}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <StatusBadge status={execution.status} />
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(execution.startedAt)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page fullWidth>
      <TitleBar title="Workflow Executions" />
      <style>{`
        .execution-table tbody tr { cursor: pointer; }
        .execution-table tbody tr:hover td { background: var(--p-color-bg-surface-hover); }
        ${selectedId ? `.execution-table tbody tr[id="${selectedId}"] td { background: var(--p-color-bg-surface-selected) !important; }` : ""}
        @keyframes skeletonPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .skeleton-pulse { animation: skeletonPulse 1.5s ease-in-out infinite; }
        @keyframes loadingSlide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .loading-bar { animation: loadingSlide 1.2s ease-in-out infinite; }
      `}</style>
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical">
            <p>Failed to load executions: {error}</p>
          </Banner>
        )}

        <Card padding="400">
          <InlineStack gap="300">
            <Select
              label="Status"
              labelInline
              options={statusOptions}
              value={filters.status}
              onChange={(value) => handleFilterChange("status", value)}
              disabled={isLoading}
            />
            <Select
              label="Workflow"
              labelInline
              options={workflowOptions}
              value={filters.workflowId}
              onChange={(value) => handleFilterChange("workflowId", value)}
              disabled={isLoading}
            />
          </InlineStack>
        </Card>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          <BlockStack gap="400">
            <Card padding="0">
              {isLoading ? (
                <SkeletonTable />
              ) : executions.length === 0 && !error ? (
                <EmptyState
                  heading="No executions found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    {filters.status || filters.workflowId
                      ? "Try adjusting your filters."
                      : "Workflow executions from n8n will appear here."}
                  </p>
                </EmptyState>
              ) : (
                <div className="execution-table" onClick={handleTableClick}>
                  <IndexTable
                    itemCount={executions.length}
                    headings={TABLE_HEADINGS}
                    selectable={false}
                  >
                    {rowMarkup}
                  </IndexTable>
                </div>
              )}
            </Card>

            {!isLoading && (nextCursor || hasCursor) && (
              <InlineStack align="center">
                <Pagination
                  hasPrevious={hasCursor}
                  hasNext={!!nextCursor}
                  onPrevious={handlePreviousPage}
                  onNext={handleNextPage}
                />
              </InlineStack>
            )}
          </BlockStack>

          <div style={{ position: "sticky", top: "60px" }}>
            <OrderOverview
              execution={selectedExecution}
              executionNodes={executionNodes}
              nodesLoading={detailLoading}
              relatedExecutions={relatedExecutions}
              workflowNameMap={workflowNameMap}
            />
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}
