import { useEffect, useState, useCallback } from "react";
import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Box,
  Divider,
  Heading,
  Icon,
  Link,
  ProgressIndicator,
} from "@shopify/ui-extensions-react/admin";

const TARGET = "admin.order-details.action.render";

export default reactExtension(TARGET, () => <App />);

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) {
      name
      n8nWorkflowUrl: metafield(namespace: "custom", key: "n8n_workflow_url") { value }
      n8nOrderFinisherUrl: metafield(namespace: "custom", key: "n8n_order_finisher_url") { value }
    }
  }
`;

const STATUS_CONFIG = {
  success: { tone: "success", label: "Success", icon: "CheckCircleFill" },
  error: { tone: "critical", label: "Error", icon: "XCircleFill" },
  canceled: { tone: "warning", label: "Canceled", icon: "CancelMajor" },
  waiting: { tone: "attention", label: "Waiting", icon: "ClockFill" },
  running: { tone: "info", label: "Running", icon: "PlayCircleFill" },
};

function formatDate(dateString) {
  if (!dateString) return null;
  return new Date(dateString).toLocaleString();
}

function formatDuration(startedAt, stoppedAt) {
  if (!startedAt || !stoppedAt) return null;
  const ms = new Date(stoppedAt) - new Date(startedAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

// ─── Main App ───

function App() {
  const { close, data } = useApi(TARGET);
  const orderId = data.selected?.[0]?.id;

  const [order, setOrder] = useState(null);
  const [workflowData, setWorkflowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryError, setRetryError] = useState(null);
  const [retryingType, setRetryingType] = useState(null);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      try {
        const res = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify({ query: ORDER_QUERY, variables: { id: orderId } }),
        });
        const json = await res.json();
        const orderData = json.data?.order;
        if (!orderData) throw new Error("Order not found");
        setOrder(orderData);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  const fetchWorkflows = useCallback(() => {
    if (!order) return;
    const workflowUrl = order.n8nWorkflowUrl?.value || "";
    const finisherUrl = order.n8nOrderFinisherUrl?.value || "";
    if (!workflowUrl && !finisherUrl) return;

    setWorkflowLoading(true);
    const params = new URLSearchParams();
    if (workflowUrl) params.set("workflowUrl", workflowUrl);
    if (finisherUrl) params.set("finisherUrl", finisherUrl);

    fetch(`/app/order-workflow-detail?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Backend returned ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
      })
      .then(setWorkflowData)
      .catch((e) => setError(`Workflow fetch failed: ${e.message}`))
      .finally(() => setWorkflowLoading(false));
  }, [order]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleRetry = useCallback(
    async (type) => {
      if (!order) return;
      const url =
        type === "workflow"
          ? order.n8nWorkflowUrl?.value
          : order.n8nOrderFinisherUrl?.value;
      if (!url) return;

      setRetryingType(type);
      setRetryError(null);

      try {
        const body = new FormData();
        body.append("url", url);
        const res = await fetch("/app/order-workflow-detail", {
          method: "POST",
          body,
        });
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || "Retry failed");
        setTimeout(fetchWorkflows, 2000);
      } catch (e) {
        setRetryError(e.message);
      } finally {
        setRetryingType(null);
      }
    },
    [order, fetchWorkflows],
  );

  if (loading) {
    return (
      <AdminAction title="Workflow Status">
        <BlockStack inlineAlignment="center" padding="large400">
          <ProgressIndicator size="small-200" />
        </BlockStack>
      </AdminAction>
    );
  }

  if (error || !order) {
    return (
      <AdminAction
        title="Workflow Status"
        secondaryAction={<Button onPress={close}>Close</Button>}
      >
        <Banner tone="critical">{error || "Order not found"}</Banner>
      </AdminAction>
    );
  }

  const hasWorkflowUrl = !!order.n8nWorkflowUrl?.value;
  const hasFinisherUrl = !!order.n8nOrderFinisherUrl?.value;

  if (!hasWorkflowUrl && !hasFinisherUrl) {
    return (
      <AdminAction
        title={`${order.name} — Workflows`}
        secondaryAction={<Button onPress={close}>Close</Button>}
      >
        <Text appearance="subdued">
          No workflow URLs configured for this order.
        </Text>
      </AdminAction>
    );
  }

  return (
    <AdminAction
      title={`${order.name} — Workflows`}
      secondaryAction={<Button onPress={close}>Close</Button>}
    >
      <BlockStack gap="large200">
        {retryError && (
          <Banner tone="critical">Retry failed: {retryError}</Banner>
        )}

        {workflowLoading ? (
          <BlockStack inlineAlignment="center" padding="large400">
            <ProgressIndicator size="small-200" />
          </BlockStack>
        ) : (
          <BlockStack gap="large200">
            {hasWorkflowUrl && (
              <WorkflowCard
                label="Workflow"
                executionUrl={order.n8nWorkflowUrl?.value}
                data={workflowData?.workflow}
                onRetry={() => handleRetry("workflow")}
                isRetrying={retryingType === "workflow"}
                onRefresh={fetchWorkflows}
              />
            )}
            {hasFinisherUrl && (
              <WorkflowCard
                label="Order Finisher"
                executionUrl={order.n8nOrderFinisherUrl?.value}
                data={workflowData?.finisher}
                onRetry={() => handleRetry("finisher")}
                isRetrying={retryingType === "finisher"}
                onRefresh={fetchWorkflows}
              />
            )}
          </BlockStack>
        )}
      </BlockStack>
    </AdminAction>
  );
}

// ─── Workflow Card ───

function WorkflowCard({ label, executionUrl, data, onRetry, isRetrying, onRefresh }) {
  const execution = data?.execution;
  const status = execution?.status;
  const config = STATUS_CONFIG[status];
  const date = formatDate(execution?.startedAt);
  const duration = formatDuration(execution?.startedAt, execution?.stoppedAt);
  const nodeCount = data?.nodes?.length ?? 0;
  const errorCount = data?.nodes?.filter((n) => n.error)?.length ?? 0;

  return (
    <Box
      padding="base"
      borderWidth="small"
      borderColor="base"
      borderRadius="large"
    >
      <BlockStack gap="base">
        {/* Header: label + status */}
        <InlineStack blockAlignment="center" gap="base">
          <BlockStack gap="none">
            <Heading>{label}</Heading>
          </BlockStack>
          {config ? (
            <Badge tone={config.tone}>{config.label}</Badge>
          ) : (
            <Badge tone="attention">No run</Badge>
          )}
        </InlineStack>

        {/* Metadata row */}
        {execution ? (
          <InlineStack gap="base" blockAlignment="center">
            {date && (
              <InlineStack gap="small100" blockAlignment="center">
                <Icon name="CalendarIcon" />
                <Text appearance="subdued">{date}</Text>
              </InlineStack>
            )}
            {duration && (
              <InlineStack gap="small100" blockAlignment="center">
                <Icon name="ClockIcon" />
                <Text appearance="subdued">{duration}</Text>
              </InlineStack>
            )}
          </InlineStack>
        ) : (
          <Text appearance="subdued">No execution data available</Text>
        )}

        {/* Stats row */}
        {execution && nodeCount > 0 && (
          <InlineStack gap="base">
            <Badge>{nodeCount} {nodeCount === 1 ? "step" : "steps"}</Badge>
            {errorCount > 0 && (
              <Badge tone="critical">{errorCount} {errorCount === 1 ? "error" : "errors"}</Badge>
            )}
          </InlineStack>
        )}

        <Divider />

        {/* Actions */}
        <InlineStack gap="base" blockAlignment="center">
          <Button onPress={onRetry} disabled={isRetrying}>
            {isRetrying ? "Retrying..." : "Retry"}
          </Button>
          <Button onPress={onRefresh}>Refresh</Button>
          {executionUrl && (
            <Link href={executionUrl} target="_blank">
              Open in n8n
            </Link>
          )}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
