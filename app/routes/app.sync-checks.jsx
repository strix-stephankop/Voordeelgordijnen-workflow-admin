import { useLoaderData, useSearchParams, useRevalidator, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Pagination,
  Banner,
  Button,
  Link,
  Checkbox,
  Collapsible,
  Divider,
  Icon,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { querySyncChecks, getSyncCheck, updateSyncCheckReport } from "../supabase.server";

/* ── Realtime ── */

function useSupabaseRealtime(supabaseUrl, supabaseKey, tables, onEvent) {
  const [status, setStatus] = useState("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setStatus("error");
      return;
    }

    const client = createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 2 } },
    });

    let channel = client.channel("realtime-sync-checks");
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => onEventRef.current(payload),
      );
    }

    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") setStatus("connected");
      else if (state === "CLOSED") setStatus("disconnected");
      else if (state === "CHANNEL_ERROR") setStatus("error");
    });

    return () => {
      channel.unsubscribe();
      client.removeAllChannels();
    };
  }, [supabaseUrl, supabaseKey, tables.join(",")]);

  return status;
}

/* ── Loader / Action ── */

const PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count } = await querySyncChecks({ from, to });
    return json({
      checks: data, total: count, page, error: null, shop,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  } catch (e) {
    console.error("Failed to load sync checks:", e.message);
    return json({
      checks: [], total: 0, page, error: e.message, shop,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  }
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const { checkId, listKey, index, resolved } = await request.json();

  if (checkId == null || !listKey || index == null) {
    return json({ ok: false, error: "Missing fields" }, { status: 400 });
  }

  try {
    const check = await getSyncCheck(checkId);
    if (!check) return json({ ok: false, error: "Check not found" }, { status: 404 });

    const report = typeof check.report === "string" ? JSON.parse(check.report) : check.report;

    if (report[listKey] && report[listKey][index]) {
      report[listKey][index].resolved = resolved;
    }

    await updateSyncCheckReport(checkId, JSON.stringify(report));
    return json({ ok: true });
  } catch (e) {
    console.error("Failed to toggle resolved:", e.message);
    return json({ ok: false, error: e.message }, { status: 500 });
  }
};

/* ── Helpers ── */

function formatDate(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    return d.toLocaleString("nl-NL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

/* ── Issue row ── */

function IssueItem({ item, checkId, listKey, index, shop }) {
  const fetcher = useFetcher();
  const optimistic = fetcher.json?.resolved ?? item.resolved;
  const checked = !!optimistic;

  function handleToggle() {
    fetcher.submit(
      { checkId, listKey, index, resolved: !checked },
      { method: "POST", encType: "application/json" },
    );
  }

  const orderNumber = item.orderName?.replace("#", "") || item.orderName;
  const orderUrl = item.orderId
    ? `https://${shop}/admin/orders/${item.orderId}`
    : `https://${shop}/admin/orders?query=name%3A%23${orderNumber}`;

  return (
    <Box paddingBlockStart="100" paddingBlockEnd="100">
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <Checkbox label="" labelHidden checked={checked} onChange={handleToggle} />
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Link url={orderUrl} target="_blank">
            #{orderNumber}
          </Link>
          {item.issue && (
            <Text variant="bodySm" as="span" tone={checked ? "subdued" : undefined}>
              <span style={checked ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                {item.issue}
              </span>
            </Text>
          )}
          {item.tags && (
            <Text variant="bodySm" as="span" tone="subdued">
              <span style={checked ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                {item.tags.join(", ")}
              </span>
            </Text>
          )}
        </InlineStack>
      </InlineStack>
    </Box>
  );
}

/* ── Issue group ── */

function IssueGroup({ title, items, tone, shop, checkId, listKey, originalIndices }) {
  if (!items || items.length === 0) return null;
  const unresolvedCount = items.filter((i) => !i.resolved).length;

  return (
    <Box paddingBlockStart="300" paddingBlockEnd="100">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center">
          <Text variant="headingSm" as="h4">{title}</Text>
          <Badge tone={unresolvedCount > 0 ? tone : "success"} size="small">
            {unresolvedCount > 0 ? `${unresolvedCount} open` : "Klaar"}
          </Badge>
        </InlineStack>
        <Divider />
        <BlockStack gap="0">
          {items.map((item, i) => (
            <IssueItem
              key={i}
              item={item}
              checkId={checkId}
              listKey={listKey}
              index={originalIndices[i]}
              shop={shop}
            />
          ))}
        </BlockStack>
      </BlockStack>
    </Box>
  );
}

/* ── Check card ── */

function SyncCheckCard({ check, shop }) {
  const [open, setOpen] = useState(false);
  const raw = check.report;
  const report = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
  const date = formatDate(check.created_at);
  const failures = report.failures || [];
  const possibleWaIssues = report.possibleWaIssues || [];

  const noTagIssues = [];
  const noTagIndices = [];
  const supabaseIssues = [];
  const supabaseIndices = [];
  failures.forEach((f, i) => {
    if (f.category === "no_tag") { noTagIssues.push(f); noTagIndices.push(i); }
    else if (f.category === "supabase") { supabaseIssues.push(f); supabaseIndices.push(i); }
  });
  const waIndices = possibleWaIssues.map((_, i) => i);

  const totalUnresolved =
    failures.filter((f) => !f.resolved).length +
    possibleWaIssues.filter((f) => !f.resolved).length;
  const totalIssues = failures.length + possibleWaIssues.length;
  const hasIssues = totalIssues > 0;
  const resolvedCount = totalIssues - totalUnresolved;

  return (
    <Card padding="0">
      <Box padding="400">
        <div
          onClick={() => hasIssues && setOpen((o) => !o)}
          style={{ cursor: hasIssues ? "pointer" : "default", userSelect: "none" }}
        >
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              {hasIssues && (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
                </div>
              )}
              <Text variant="headingSm" as="h3">{date}</Text>
              {hasIssues ? (
                <Badge tone={totalUnresolved > 0 ? "critical" : "success"} size="small">
                  {totalUnresolved > 0 ? `${totalUnresolved} open` : "Alles afgevinkt"}
                </Badge>
              ) : (
                <Badge tone="success" size="small">Geen problemen</Badge>
              )}
              {hasIssues && resolvedCount > 0 && totalUnresolved > 0 && (
                <Text variant="bodySm" as="span" tone="subdued">
                  {resolvedCount}/{totalIssues} afgevinkt
                </Text>
              )}
            </InlineStack>
            <Text variant="bodySm" as="span" tone="subdued">
              {report.totalChecked} orders
            </Text>
          </InlineStack>
        </div>
      </Box>

      <Collapsible open={open} id={`check-${check.id}`}>
        <Divider />
        <Box padding="400" paddingBlockStart="0">
          <BlockStack gap="0">
            <IssueGroup
              title="Missende Completed tag"
              items={noTagIssues}
              tone="warning"
              shop={shop}
              checkId={check.id}
              listKey="failures"
              originalIndices={noTagIndices}
            />
            <IssueGroup
              title="Missende Supabase records"
              items={supabaseIssues}
              tone="critical"
              shop={shop}
              checkId={check.id}
              listKey="failures"
              originalIndices={supabaseIndices}
            />
            <IssueGroup
              title="Mogelijke WA problemen"
              items={possibleWaIssues}
              tone="attention"
              shop={shop}
              checkId={check.id}
              listKey="possibleWaIssues"
              originalIndices={waIndices}
            />
          </BlockStack>
        </Box>
      </Collapsible>
    </Card>
  );
}

/* ── Page ── */

export default function SyncChecks() {
  const { checks, total, page, error, shop, supabaseUrl, supabaseKey } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();

  const handleRealtimeEvent = useCallback(() => {
    if (revalidator.state === "idle") {
      revalidator.revalidate();
    }
  }, [revalidator]);

  const realtimeStatus = useSupabaseRealtime(
    supabaseUrl,
    supabaseKey,
    ["sync_checks"],
    handleRealtimeEvent,
  );

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function goToPage(p) {
    const params = new URLSearchParams(searchParams);
    if (p <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(p));
    }
    setSearchParams(params);
  }

  return (
    <Page fullWidth title="Sync Checks">
      <TitleBar title="Sync Checks" />
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="bodySm" as="span" tone="subdued">
            Automatische sync controles (elk uur)
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodySm" as="span" tone="subdued">
              {total} checks
            </Text>
            <Badge
              tone={
                realtimeStatus === "connected" ? "success"
                  : realtimeStatus === "error" ? "critical"
                  : "attention"
              }
              size="small"
            >
              {realtimeStatus === "connected" ? "Live"
                : realtimeStatus === "connecting" ? "Connecting..."
                : realtimeStatus === "error" ? "Error"
                : "Offline"}
            </Badge>
          </InlineStack>
        </InlineStack>

        {error && (
          <Banner tone="critical">
            <p>Fout bij laden: {error}</p>
          </Banner>
        )}

        {checks.length === 0 && !error ? (
          <Card>
            <Box padding="800">
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd" as="h3">Geen checks gevonden</Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  Resultaten verschijnen hier zodra de workflow draait.
                </Text>
              </BlockStack>
            </Box>
          </Card>
        ) : (
          <BlockStack gap="300">
            {checks.map((check) => (
              <SyncCheckCard key={check.id} check={check} shop={shop} />
            ))}
          </BlockStack>
        )}

        {totalPages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              hasNext={page < totalPages}
              onPrevious={() => goToPage(page - 1)}
              onNext={() => goToPage(page + 1)}
              label={`Pagina ${page} van ${totalPages}`}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
