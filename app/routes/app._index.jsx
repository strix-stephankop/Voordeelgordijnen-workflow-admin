import { useState, useEffect, useCallback, useRef } from "react";
import {
  useLoaderData,
  useSearchParams,
  useNavigation,
  useFetcher,
} from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Card,
  TextField,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  EmptyState,
  Divider,
  Spinner,
  SkeletonBodyText,
  Banner,
  Select,
  Thumbnail,
  Button,
  Collapsible,
  Icon,
  Popover,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronRightIcon } from "@shopify/polaris-icons";
import { TitleBar, Modal, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { syncExecutions } from "../n8n-sync.server";
import {
  searchSoftrRecords,
  hasCachedData,
  syncSoftrData,
} from "../softr.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const selectedOrder = url.searchParams.get("selected") || "";

  syncExecutions().catch(() => {});

  if (!q) {
    return json({ orders: [], query: q, selectedOrder, error: null, softrResults: [] });
  }

  // Run Shopify + Softr searches in parallel
  const [shopifyResult, softrResult] = await Promise.allSettled([
    admin.graphql(
      `#graphql
      query orders($query: String!) {
        orders(first: 10, query: $query) {
          nodes {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            n8nWorkflowUrl: metafield(namespace: "custom", key: "n8n_workflow_url") { value }
            n8nOrderFinisherUrl: metafield(namespace: "custom", key: "n8n_order_finisher_url") { value }
            lineItems(first: 50) {
              nodes {
                id
                title
                image { url altText }
                customAttributes { key value }
              }
            }
          }
        }
      }`,
      { variables: { query: `name:${q}` } },
    ).then((r) => r.json()),
    (async () => {
      if (!(await hasCachedData())) await syncSoftrData();
      return searchSoftrRecords(q);
    })(),
  ]);

  let orders = [];
  let error = null;
  if (shopifyResult.status === "fulfilled") {
    orders = shopifyResult.value.data?.orders?.nodes ?? [];
  } else {
    console.error("Failed to search orders:", shopifyResult.reason?.message);
    error = shopifyResult.reason?.message ?? "Failed to search orders";
  }

  const softrResults = softrResult.status === "fulfilled" ? softrResult.value : [];
  if (softrResult.status === "rejected") {
    console.error("Softr search failed:", softrResult.reason?.message);
  }

  return json({ orders, query: q, selectedOrder, error, softrResults });
};

// ─── Badge maps ───

const FINANCIAL_BADGE = {
  PAID: { tone: "success", label: "Paid" },
  PARTIALLY_PAID: { tone: "warning", label: "Partially paid" },
  PARTIALLY_REFUNDED: { tone: "warning", label: "Partially refunded" },
  PENDING: { tone: "attention", label: "Pending" },
  REFUNDED: { tone: "info", label: "Refunded" },
  VOIDED: { tone: undefined, label: "Voided" },
  AUTHORIZED: { tone: "info", label: "Authorized" },
  EXPIRED: { tone: undefined, label: "Expired" },
};

const FULFILLMENT_BADGE = {
  FULFILLED: { tone: "success", label: "Fulfilled" },
  PARTIAL: { tone: "warning", label: "Partial" },
  UNFULFILLED: { tone: "attention", label: "Unfulfilled" },
  RESTOCKED: { tone: undefined, label: "Restocked" },
  SCHEDULED: { tone: "info", label: "Scheduled" },
  ON_HOLD: { tone: "warning", label: "On hold" },
};

const EXEC_STATUS_BADGE = {
  success: { tone: "success", label: "Success" },
  error: { tone: "critical", label: "Error" },
  canceled: { tone: "warning", label: "Canceled" },
  waiting: { tone: "attention", label: "Waiting" },
  running: { tone: "info", label: "Running" },
};

function StatusBadge({ status, map }) {
  const config = map[status] || { tone: undefined, label: status || "\u2014" };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

// ─── Formatters ───

function formatDate(dateString) {
  if (!dateString) return "\u2014";
  return new Date(dateString).toLocaleString();
}

function formatCurrency(amount, currency) {
  if (!amount) return "\u2014";
  return `${parseFloat(amount).toFixed(2)} ${currency}`;
}

function formatDuration(startedAt, stoppedAt) {
  if (!startedAt || !stoppedAt) return "\u2014";
  const ms = new Date(stoppedAt) - new Date(startedAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatNodeDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Workflow node timeline ───

function NodeIcon({ error }) {
  const bg = error ? "#e51c00" : "#29845a";
  return (
    <div style={{ width: 24, height: 24, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
        <div className="skeleton-pulse" style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--p-color-bg-fill-tertiary)" }} />
        {!isLast && <div style={{ width: 2, flex: 1, background: "var(--p-color-border)", minHeight: 8 }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 8, minWidth: 0 }}>
        <div className="skeleton-pulse" style={{ background: "var(--p-color-bg-surface)", border: "1px solid var(--p-color-border)", borderRadius: 10, padding: "10px 12px" }}>
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
      {[0, 1, 2].map((i) => <SkeletonNode key={i} isLast={i === 2} />)}
    </div>
  );
}

function WorkflowNodes({ nodes, isLoading }) {
  const [expandedNodes, setExpandedNodes] = useState({});

  if (isLoading) return <SkeletonNodes />;
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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flexShrink: 0 }}>
              <NodeIcon error={node.error} />
              {!isLast && <div style={{ width: 2, flex: 1, background: "var(--p-color-border)", minHeight: 8 }} />}
            </div>
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
                onMouseEnter={(e) => { if (hasOutput) e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text variant="bodySm" fontWeight="semibold" truncate>{node.name}</Text>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <Text variant="bodySm" tone="subdued" as="span">{node.type}</Text>
                      {node.executionTime != null && (
                        <>
                          <span style={{ color: "var(--p-color-text-subdued)", fontSize: 10 }}>&middot;</span>
                          <Text variant="bodySm" tone="subdued" as="span">{formatNodeDuration(node.executionTime)}</Text>
                        </>
                      )}
                    </div>
                  </div>
                  {hasOutput && (
                    <span style={{ display: "inline-flex", transition: "transform 0.15s ease", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", color: "var(--p-color-text-subdued)", fontSize: 10, flexShrink: 0 }}>
                      &#9654;
                    </span>
                  )}
                </div>
                {node.error && (
                  <div style={{ marginTop: 6, padding: "4px 8px", background: "var(--p-color-bg-surface-critical)", borderRadius: 6 }}>
                    <Text variant="bodySm" tone="critical">{node.error}</Text>
                  </div>
                )}
              </div>
              {isExpanded && hasOutput && (
                <div style={{ border: "1px solid var(--p-color-border)", borderTop: "none", borderRadius: "0 0 10px 10px", background: "var(--p-color-bg-surface-secondary)", overflow: "hidden" }}>
                  <pre style={{ margin: 0, padding: "10px 12px", fontSize: "11px", lineHeight: "1.5", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "280px", overflowY: "auto", color: "var(--p-color-text-secondary)", fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace" }}>
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

// ─── Workflow section (clickable row with status) ───

function WorkflowSection({ label, data, isLoading, onClick, onRetry, isRetrying }) {
  const disabled = !isLoading && !data;
  const execution = data?.execution;

  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 10,
        border: "1px solid var(--p-color-border)",
        background: "var(--p-color-bg-surface)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <InlineStack align="space-between" blockAlign="center" gap="200">
        <div
          onClick={disabled ? undefined : onClick}
          style={{ flex: 1, cursor: disabled ? "default" : "pointer" }}
        >
          <BlockStack gap="050">
            <Text variant="bodySm" fontWeight="semibold">{label}</Text>
            {isLoading ? (
              <Text variant="bodySm" tone="subdued">Loading...</Text>
            ) : execution ? (
              <Text variant="bodySm" tone="subdued">
                {formatDate(execution.startedAt)} &middot; {formatDuration(execution.startedAt, execution.stoppedAt)}
              </Text>
            ) : (
              <Text variant="bodySm" tone="subdued">No workflow run</Text>
            )}
          </BlockStack>
        </div>
        <InlineStack gap="200" blockAlign="center">
          {isLoading ? (
            <Spinner size="small" />
          ) : execution ? (
            <StatusBadge status={execution.status} map={EXEC_STATUS_BADGE} />
          ) : (
            <Badge tone="new">No run</Badge>
          )}
          {onRetry && (
            <Button size="slim" onClick={onRetry} loading={isRetrying} disabled={disabled}>
              Retry
            </Button>
          )}
        </InlineStack>
      </InlineStack>
    </div>
  );
}

// ─── Line items panel ───

function LineItemsPanel({ order }) {
  if (!order) {
    return (
      <Card>
        <Box padding="600">
          <BlockStack gap="200" inlineAlign="center">
            <Text variant="headingMd" as="h2" alignment="center" tone="subdued">Line items</Text>
            <Text variant="bodySm" as="p" alignment="center" tone="subdued">Search for an order to view its line items</Text>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  const lineItems = order.lineItems?.nodes ?? [];

  if (lineItems.length === 0) {
    return (
      <Card>
        <Box padding="400">
          <Text variant="bodySm" tone="subdued">No line items</Text>
        </Box>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        {lineItems.map((item) => {
          const attrs = item.customAttributes ?? [];
          return (
            <InlineStack key={item.id} gap="300" blockAlign="start" wrap={false}>
              <Thumbnail
                source={item.image?.url || ""}
                alt={item.image?.altText || item.title}
                size="small"
              />
              <BlockStack gap="100">
                <Text variant="bodySm" fontWeight="semibold">{item.title}</Text>
                {attrs.length > 0 && (
                  <BlockStack gap="050">
                    {attrs.map((attr) => (
                      <Text key={attr.key} variant="bodySm" tone="subdued">
                        {attr.key}: {attr.value}
                      </Text>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </InlineStack>
          );
        })}
      </BlockStack>
    </Card>
  );
}

function DetailRow({ label, value }) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="200">
      <Text variant="bodySm" tone="subdued">{label}</Text>
      {typeof value === "string" ? <Text variant="bodySm" as="span">{value}</Text> : value}
    </InlineStack>
  );
}

// ─── Order detail panel ───

function OrderDetailPanel({ order, workflowData, workflowLoading, onOpenModal, onRetry, retryingType }) {
  if (!order) {
    return (
      <Card>
        <Box padding="600">
          <BlockStack gap="200" inlineAlign="center">
            <Text variant="headingMd" as="h2" alignment="center" tone="subdued">Order details</Text>
            <Text variant="bodySm" as="p" alignment="center" tone="subdued">Select an order to view details and workflow runs</Text>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  const money = order.totalPriceSet?.shopMoney;
  const hasWorkflowUrl = !!order.n8nWorkflowUrl?.value;
  const hasFinisherUrl = !!order.n8nOrderFinisherUrl?.value;

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          <Text variant="headingLg" as="h2">{order.name}</Text>

          <Divider />

          <BlockStack gap="300">
            <DetailRow label="Date" value={formatDate(order.createdAt)} />
            <DetailRow label="Total" value={money ? formatCurrency(money.amount, money.currencyCode) : "\u2014"} />
            <DetailRow label="Payment" value={<StatusBadge status={order.displayFinancialStatus} map={FINANCIAL_BADGE} />} />
            <DetailRow label="Fulfillment" value={<StatusBadge status={order.displayFulfillmentStatus} map={FULFILLMENT_BADGE} />} />
          </BlockStack>

          <Divider />

          <BlockStack gap="300">
            <Text variant="headingSm" as="h3">Workflow Executions</Text>
            <WorkflowSection
              label="Workflow"
              data={hasWorkflowUrl ? workflowData?.workflow : null}
              isLoading={hasWorkflowUrl && workflowLoading}
              onClick={() => onOpenModal("workflow")}
              onRetry={hasWorkflowUrl ? () => onRetry("workflow") : null}
              isRetrying={retryingType === "workflow"}
            />
            <WorkflowSection
              label="Order Finisher"
              data={hasFinisherUrl ? workflowData?.finisher : null}
              isLoading={hasFinisherUrl && workflowLoading}
              onClick={() => onOpenModal("finisher")}
              onRetry={hasFinisherUrl ? () => onRetry("finisher") : null}
              isRetrying={retryingType === "finisher"}
            />
          </BlockStack>
        </BlockStack>
      </Box>
    </Card>
  );
}

// ─── Softr results section ───

const MAX_VALUE_LENGTH = 80;

function SoftrFieldValue({ fieldName, value, fieldId, tableId, recordId }) {
  // mode: "viewing" | "editing" | "confirming" | "saving"
  const [mode, setMode] = useState("viewing");
  const [expanded, setExpanded] = useState(false);
  const [editValue, setEditValue] = useState("");
  const fetcher = useFetcher();
  const inputRef = useRef(null);
  const shopify = useAppBridge();
  const isEmpty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
  const str = isEmpty ? "" : String(value);
  const isLong = str.length > MAX_VALUE_LENGTH;
  const popoverOpen = mode !== "viewing";

  const isAttachment = !isEmpty && Array.isArray(value) && value[0]?.url;

  function startEditing() {
    if (isAttachment || !fieldId) return;
    setEditValue(str);
    setMode("editing");
  }

  function cancel() {
    setMode("viewing");
    setEditValue("");
  }

  function handleSave() {
    if (editValue === str) {
      cancel();
      return;
    }
    setMode("confirming");
  }

  function confirmSave() {
    setMode("saving");
    fetcher.submit(
      { _action: "update", tableId, recordId, fieldId, value: editValue },
      { method: "POST", action: "/app/softr-search" },
    );
  }

  function backToEditing() {
    setMode("editing");
  }

  useEffect(() => {
    if (mode === "editing" && inputRef.current) {
      inputRef.current.querySelector("input")?.focus({ preventScroll: true });
    }
  }, [mode]);

  // After successful save → back to viewing + toast
  useEffect(() => {
    if (mode === "saving" && fetcher.state === "idle" && fetcher.data?.ok) {
      setMode("viewing");
      setEditValue("");
      shopify.toast.show("Field updated");
    }
  }, [mode, fetcher.state, fetcher.data]);

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      cancel();
    }
  }

  // ── Attachment (non-editable) ──
  if (isAttachment) {
    return (
      <InlineStack gap="200">
        {value.map((att, i) => (
          <Button key={i} size="slim" variant="plain" url={att.url} target="_blank">
            {att.filename}
          </Button>
        ))}
      </InlineStack>
    );
  }

  // ── Popover content by mode ──
  let popoverContent = null;
  if (mode === "saving") {
    popoverContent = (
      <Box padding="300">
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text variant="bodySm" as="span" tone="subdued">Saving…</Text>
        </InlineStack>
      </Box>
    );
  } else if (mode === "confirming") {
    popoverContent = (
      <Box padding="300">
        <BlockStack gap="200">
          <Text variant="bodySm" as="span" tone="subdued">
            {isEmpty ? (
              <span style={{ fontStyle: "italic" }}>Empty</span>
            ) : (
              <span style={{ textDecoration: "line-through" }}>
                {str.length > 60 ? `${str.slice(0, 60)}…` : str}
              </span>
            )}
          </Text>
          <InlineStack gap="100" blockAlign="center">
            <Text variant="bodySm" as="span">→</Text>
            <Text variant="bodySm" as="span" fontWeight="semibold">
              {editValue.length > 60 ? `${editValue.slice(0, 60)}…` : editValue}
            </Text>
          </InlineStack>
          <InlineStack gap="200">
            <Button size="micro" variant="primary" onClick={confirmSave}>Confirm</Button>
            <Button size="micro" onClick={backToEditing}>Back</Button>
          </InlineStack>
        </BlockStack>
      </Box>
    );
  } else if (mode === "editing") {
    popoverContent = (
      <Box padding="300">
        <BlockStack gap="200">
          <div ref={inputRef}>
            <TextField
              value={editValue}
              onChange={setEditValue}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              size="slim"
              label={fieldName}
              labelHidden
            />
          </div>
          <InlineStack gap="200">
            <Button size="micro" variant="primary" onClick={handleSave}>Save</Button>
            <Button size="micro" onClick={cancel}>Cancel</Button>
          </InlineStack>
        </BlockStack>
      </Box>
    );
  }

  // ── Activator (always the value text) ──
  const activator = isEmpty ? (
    <span
      onClick={startEditing}
      style={{ cursor: fieldId ? "pointer" : "default", borderBottom: fieldId ? "1px dashed var(--p-color-border)" : "none" }}
    >
      <Text variant="bodySm" as="span" tone="subdued" fontStyle="italic">
        {fieldId ? "Empty – click to add" : "—"}
      </Text>
    </span>
  ) : isLong ? (
    <div style={{ minWidth: 0, flex: 1 }}>
      <span
        onClick={startEditing}
        style={{ cursor: fieldId ? "pointer" : "default", borderBottom: fieldId ? "1px dashed var(--p-color-border)" : "none" }}
      >
        <Text variant="bodySm" as="span">
          {expanded ? str : `${str.slice(0, MAX_VALUE_LENGTH)}…`}
        </Text>
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          marginLeft: 4,
          color: "var(--p-color-text-emphasis)",
          cursor: "pointer",
          fontSize: "12px",
        }}
      >
        {expanded ? "less" : "more"}
      </button>
    </div>
  ) : (
    <span
      onClick={startEditing}
      style={{ cursor: fieldId ? "pointer" : "default", borderBottom: fieldId ? "1px dashed var(--p-color-border)" : "none" }}
    >
      <Text variant="bodySm" as="span" truncate>
        {str}
      </Text>
    </span>
  );

  if (!fieldId) return activator;

  return (
    <Popover
      active={popoverOpen}
      activator={activator}
      onClose={cancel}
      preferredAlignment="left"
      autofocusTarget="none"
    >
      {popoverContent}
    </Popover>
  );
}

function SoftrRecordCard({ record, tableId }) {
  const fetcher = useFetcher();
  const isDeleting = fetcher.state !== "idle";
  const isDeleted = fetcher.data?.ok;

  if (isDeleted) return null;

  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <InlineStack align="space-between" blockAlign="start" wrap={false}>
        <BlockStack gap="100">
          {Object.entries(record.fields).map(([fieldName, value]) => (
            <InlineStack key={fieldName} gap="200" wrap={false}>
              <Text variant="bodySm" tone="subdued" as="span">
                {fieldName}:
              </Text>
              <SoftrFieldValue
                fieldName={fieldName}
                value={value}
                fieldId={record.fieldIds?.[fieldName]}
                tableId={tableId}
                recordId={record.id}
              />
            </InlineStack>
          ))}
        </BlockStack>
        <fetcher.Form method="post" action="/app/softr-search">
          <input type="hidden" name="tableId" value={tableId} />
          <input type="hidden" name="recordId" value={record.id} />
          <Button
            size="slim"
            tone="critical"
            variant="plain"
            loading={isDeleting}
            submit
          >
            Delete
          </Button>
        </fetcher.Form>
      </InlineStack>
    </Box>
  );
}

function SoftrResultsSection({ results, query }) {
  const [openTables, setOpenTables] = useState({});

  function toggleTable(tableId) {
    setOpenTables((prev) => ({ ...prev, [tableId]: !prev[tableId] }));
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingSm" as="h3">Softr Records</Text>
        {results.length === 0 && (
          <Text variant="bodySm" tone="subdued">
            No Softr records found for "{query}"
          </Text>
        )}
        {results.map((group) => {
          const isOpen = openTables[group.tableId] !== false; // default open
          return (
            <div key={group.tableId}>
              <div
                onClick={() => toggleTable(group.tableId)}
                style={{ cursor: "pointer", padding: "8px 0" }}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon
                      source={isOpen ? ChevronDownIcon : ChevronRightIcon}
                      tone="subdued"
                    />
                    <Text variant="bodySm" fontWeight="semibold">
                      {group.tableName}
                    </Text>
                  </InlineStack>
                  <Badge tone="info">
                    {group.total} {group.total === 1 ? "record" : "records"}
                  </Badge>
                </InlineStack>
              </div>
              <Collapsible open={isOpen} transition={{ duration: "200ms" }}>
                <BlockStack gap="200">
                  {group.records.map((record) => (
                    <SoftrRecordCard
                      key={record.id}
                      record={record}
                      tableId={group.tableId}
                    />
                  ))}
                </BlockStack>
              </Collapsible>
            </div>
          );
        })}
      </BlockStack>
    </Card>
  );
}

// ─── Main page ───

export default function OrderSearch() {
  const { orders, query, selectedOrder, error, softrResults } = useLoaderData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const workflowFetcher = useFetcher();

  const isNavigating = navigation.state === "loading";
  const [searchInput, setSearchInput] = useState(query || "");
  const [modalType, setModalType] = useState(null); // "workflow" | "finisher"

  const selected = selectedOrder
    ? orders.find((o) => o.name === selectedOrder || o.id === selectedOrder)
    : orders.length === 1
      ? orders[0]
      : null;

  useEffect(() => {
    setSearchInput(query || "");
  }, [query]);

  // Auto-select when there is exactly one result
  useEffect(() => {
    if (orders.length === 1 && !selectedOrder) {
      const params = new URLSearchParams(searchParams);
      params.set("selected", orders[0].name);
      setSearchParams(params, { replace: true });
    }
  }, [orders]);

  // Fetch execution status for both URLs when an order is selected
  useEffect(() => {
    if (!selected) return;

    const workflowUrl = selected.n8nWorkflowUrl?.value || "";
    const finisherUrl = selected.n8nOrderFinisherUrl?.value || "";

    if (!workflowUrl && !finisherUrl) return;

    const params = new URLSearchParams();
    if (workflowUrl) params.set("workflowUrl", workflowUrl);
    if (finisherUrl) params.set("finisherUrl", finisherUrl);

    workflowFetcher.load(`/app/order-workflow-detail?${params.toString()}`);
  }, [selected?.id]);

  const debounceRef = useRef(null);

  // Debounced search: fires 500ms after the user stops typing
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const trimmed = searchInput.trim();

    if (trimmed === query) return; // nothing changed

    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (trimmed) {
        params.set("q", trimmed);
      } else {
        params.delete("q");
      }
      params.delete("selected");
      setSearchParams(params);
    }, 800);

    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // True when the user has typed something different from the loaded results
  const isPendingSearch = searchInput.trim() !== (query || "") && searchInput.trim().length > 0;

  const handleOpenModal = useCallback(
    (type) => {
      setModalType(type);
      shopify.modal.show("workflow-modal");
    },
    [shopify],
  );

  const handleClearSearch = useCallback(() => {
    setSearchInput("");
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const handleSelectOrder = useCallback(
    (value) => {
      const params = new URLSearchParams(searchParams);
      params.set("selected", value);
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const retryFetcher = useFetcher();
  const [retryingType, setRetryingType] = useState(null);

  const handleRetry = useCallback(
    (type) => {
      if (!selected) return;
      const url = type === "workflow"
        ? selected.n8nWorkflowUrl?.value
        : selected.n8nOrderFinisherUrl?.value;
      if (!url) return;

      setRetryingType(type);
      retryFetcher.submit(
        { url },
        { method: "POST", action: "/app/order-workflow-detail" },
      );
    },
    [selected, retryFetcher],
  );

  // Re-fetch execution data after a successful retry
  useEffect(() => {
    if (retryFetcher.state === "idle" && retryFetcher.data?.ok && retryingType) {
      setRetryingType(null);
      // Refresh workflow data after a short delay to let n8n start the execution
      setTimeout(() => {
        if (!selected) return;
        const workflowUrl = selected.n8nWorkflowUrl?.value || "";
        const finisherUrl = selected.n8nOrderFinisherUrl?.value || "";
        const params = new URLSearchParams();
        if (workflowUrl) params.set("workflowUrl", workflowUrl);
        if (finisherUrl) params.set("finisherUrl", finisherUrl);
        workflowFetcher.load(`/app/order-workflow-detail?${params.toString()}`);
      }, 2000);
    }
    if (retryFetcher.state === "idle" && retryFetcher.data && !retryFetcher.data.ok) {
      setRetryingType(null);
    }
  }, [retryFetcher.state, retryFetcher.data]);

  const workflowLoading = workflowFetcher.state === "loading";
  const workflowData = workflowFetcher.data ?? null;

  // Get the data for the currently open modal
  const modalData = modalType === "workflow" ? workflowData?.workflow : workflowData?.finisher;
  const modalTitle = modalType === "workflow" ? "Workflow" : "Order Finisher";

  return (
    <Page fullWidth>
      <TitleBar title="Orders" />

      <Modal id="workflow-modal" variant="large">
        <Box padding="400">
          <style>{`
            @keyframes skeletonPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
            .skeleton-pulse { animation: skeletonPulse 1.5s ease-in-out infinite; }
          `}</style>
          {!modalData ? (
            <Text variant="bodySm" tone="subdued">No execution data found.</Text>
          ) : (
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <BlockStack gap="050">
                  <Text variant="headingSm" as="h3">Execution #{modalData.execution.id}</Text>
                  <Text variant="bodySm" tone="subdued">
                    {formatDate(modalData.execution.startedAt)} &middot; {formatDuration(modalData.execution.startedAt, modalData.execution.stoppedAt)}
                  </Text>
                </BlockStack>
                <StatusBadge status={modalData.execution.status} map={EXEC_STATUS_BADGE} />
              </InlineStack>
              <Divider />
              <WorkflowNodes nodes={modalData.nodes} isLoading={false} />
            </BlockStack>
          )}
        </Box>
        <TitleBar title={modalTitle}>
          <button onClick={() => shopify.modal.hide("workflow-modal")}>Close</button>
        </TitleBar>
      </Modal>

      <BlockStack gap="400">
        {error && (
          <Banner tone="critical">
            <p>Failed to search orders: {error}</p>
          </Banner>
        )}

        {retryFetcher.data && !retryFetcher.data.ok && (
          <Banner tone="critical" onDismiss={() => {}}>
            <p>Retry failed: {retryFetcher.data.error}</p>
          </Banner>
        )}

        <Card padding="400">
          <TextField
            label="Search orders"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search by order number, e.g. 1234"
            clearButton
            onClearButtonClick={handleClearSearch}
            autoComplete="off"
          />
        </Card>

        {(query || isPendingSearch || isNavigating) && (
          (isPendingSearch || isNavigating) ? (
            <BlockStack gap="400">
              <Card>
                <Box padding="400">
                  <BlockStack gap="400">
                    <SkeletonBodyText lines={1} />
                    <InlineStack gap="300" blockAlign="start" wrap={false}>
                      <div style={{ width: 40, height: 40, borderRadius: 4, background: "var(--p-color-bg-fill-tertiary)" }} />
                      <BlockStack gap="100" style={{ flex: 1 }}>
                        <SkeletonBodyText lines={2} />
                      </BlockStack>
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="start" wrap={false}>
                      <div style={{ width: 40, height: 40, borderRadius: 4, background: "var(--p-color-bg-fill-tertiary)" }} />
                      <BlockStack gap="100" style={{ flex: 1 }}>
                        <SkeletonBodyText lines={2} />
                      </BlockStack>
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="start" wrap={false}>
                      <div style={{ width: 40, height: 40, borderRadius: 4, background: "var(--p-color-bg-fill-tertiary)" }} />
                      <BlockStack gap="100" style={{ flex: 1 }}>
                        <SkeletonBodyText lines={2} />
                      </BlockStack>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Card>
            </BlockStack>
          ) : orders.length === 0 ? (
            <BlockStack gap="400">
              <Card>
                <EmptyState heading="No orders found" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>No orders matched "{query}". Try a different search term.</p>
                </EmptyState>
              </Card>
              <SoftrResultsSection results={softrResults} query={query} />
            </BlockStack>
          ) : (
            <BlockStack gap="400">
              {orders.length > 1 && (
                <Card>
                  <Select
                    label="Order"
                    options={orders.map((o) => ({
                      label: `${o.name} — ${formatDate(o.createdAt)}`,
                      value: o.name,
                    }))}
                    value={selected?.name || ""}
                    onChange={handleSelectOrder}
                  />
                </Card>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" }}>
                <LineItemsPanel order={selected} />
                <div style={{ position: "sticky", top: "60px" }}>
                  <BlockStack gap="400">
                    <OrderDetailPanel
                      order={selected}
                      workflowData={workflowData}
                      workflowLoading={workflowLoading}
                      onOpenModal={handleOpenModal}
                      onRetry={handleRetry}
                      retryingType={retryingType}
                    />
                    <SoftrResultsSection results={softrResults} query={query} />
                  </BlockStack>
                </div>
              </div>
            </BlockStack>
          )
        )}
      </BlockStack>
    </Page>
  );
}
