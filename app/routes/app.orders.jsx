import { useLoaderData, useNavigation, useSearchParams, useRevalidator, useFetcher } from "@remix-run/react";
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
  Spinner,
  Pagination,
  Banner,
  TextField,
  Button,
  Popover,
  ActionList,
  Divider,
  Icon,
  Tabs,
  Select,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { queryTable, queryLinesByOrderNumbers, searchOrders } from "../supabase.server";

const PAGE_SIZE = 50;

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("q") || "";
  const sortBy = url.searchParams.get("sort") || "id";
  const sortDir = url.searchParams.get("dir") || "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count } = search
      ? await searchOrders(search, { from, to, sortBy, sortDir })
      : await queryTable("Webattelier - orders", { from, to, sortBy, sortDir });

    const orderIds = data.map((o) => String(o.id)).filter(Boolean);
    const linesByOrder = await queryLinesByOrderNumbers(orderIds);

    return json({
      orders: data,
      linesByOrder,
      total: count,
      page,
      search,
      error: null,
      sortBy,
      sortDir,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  } catch (e) {
    console.error("Failed to load Supabase orders:", e.message);
    return json({
      orders: [],
      linesByOrder: {},
      total: 0,
      page,
      search,
      error: e.message,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  }
};

/* ── Realtime hook ── */

function useSupabaseRealtime(supabaseUrl, supabaseKey, tables, onEvent) {
  const [status, setStatus] = useState("connecting");
  const clientRef = useRef(null);
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
    clientRef.current = client;

    let channel = client.channel("realtime-orders-and-lines");
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          onEventRef.current(payload);
        },
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

function mmToCm(mm) {
  if (mm == null || mm === "") return "—";
  const num = Number(mm);
  if (isNaN(num)) return String(mm);
  return `${(num / 10).toFixed(1)}cm`;
}

function statusTone(status) {
  if (!status) return undefined;
  const s = String(status).toLowerCase();
  if (s === "open") return "attention";
  if (s === "done" || s === "completed" || s === "archived") return "success";
  if (s === "cancelled" || s === "error") return "critical";
  return "info";
}

/* ── Order Line ── */

function toDisplayValues(line) {
  const isOG = line.productGroupCode === "OG";
  const plooiFactor = line.plooiFactor || 0;
  const heightMm = line.finishedHeightInMm || 0;

  let knipmaatLeft, knipmaatRight;
  if (isOG) {
    const totalPanels = (line.panelsLeft || 0) + (line.panelsRight || 0);
    const knipmaat = totalPanels > 0 ? ((heightMm + 250) * totalPanels) / 10 : 0;
    const divRight = (line.panelDivision || "").toLowerCase().includes("right");
    knipmaatLeft = divRight ? 0 : knipmaat;
    knipmaatRight = divRight ? knipmaat : 0;
  } else {
    knipmaatLeft = plooiFactor
      ? ((line.finishedWidthLeftInMm || 0) * plooiFactor) / 10
      : (line.cutSizeLeftInMm || 0);
    knipmaatRight = plooiFactor
      ? ((line.finishedWidthRightInMm || 0) * plooiFactor) / 10
      : (line.cutSizeRightInMm || 0);
  }

  return {
    knipmaatLeft: knipmaatLeft || "",
    knipmaatRight: knipmaatRight || "",
    panelsLeft: line.panelsLeft ?? "",
    panelsRight: line.panelsRight ?? "",
  };
}

function reverseCalculateFields(values, line) {
  const isOG = line.productGroupCode === "OG";
  const plooiFactor = line.plooiFactor || 0;

  const knipmaatLeftCm = values.knipmaatLeft === "" ? null : Number(values.knipmaatLeft);
  const knipmaatRightCm = values.knipmaatRight === "" ? null : Number(values.knipmaatRight);
  const pLeft = values.panelsLeft === "" ? null : Number(values.panelsLeft);
  const pRight = values.panelsRight === "" ? null : Number(values.panelsRight);

  let finWidthLeft, finWidthRight;
  if (isOG) {
    finWidthLeft = line.finishedWidthLeftInMm;
    finWidthRight = line.finishedWidthRightInMm;
  } else if (plooiFactor > 0) {
    finWidthLeft = knipmaatLeftCm != null ? Math.round((knipmaatLeftCm * 10) / plooiFactor) : null;
    finWidthRight = knipmaatRightCm != null ? Math.round((knipmaatRightCm * 10) / plooiFactor) : null;
  } else {
    finWidthLeft = line.finishedWidthLeftInMm;
    finWidthRight = line.finishedWidthRightInMm;
  }

  return {
    finishedWidthLeftInMm: finWidthLeft,
    finishedWidthRightInMm: finWidthRight,
    panelsLeft: pLeft,
    panelsRight: pRight,
    cutSizeLeftInMm: knipmaatLeftCm,
    cutSizeRightInMm: knipmaatRightCm,
  };
}

function OrderLine({ line }) {
  const fetcher = useFetcher();
  const [dirty, setDirty] = useState(false);
  const [values, setValues] = useState(() => toDisplayValues(line));

  const isOG = line.productGroupCode === "OG";
  const heightMm = line.finishedHeightInMm || 0;

  const isSaving = fetcher.state === "submitting";
  const saveError = fetcher.data?.ok === false ? fetcher.data.error : null;

  // Sync from line prop on revalidation/realtime, but only when user isn't editing
  useEffect(() => {
    if (!dirty) {
      setValues(toDisplayValues(line));
    }
  }, [line.finishedWidthLeftInMm, line.finishedWidthRightInMm, line.panelsLeft, line.panelsRight, line.cutSizeLeftInMm, line.cutSizeRightInMm]);

  // After successful save, immediately reflect saved values from server response
  useEffect(() => {
    if (fetcher.data?.ok) {
      setDirty(false);
      if (fetcher.data.line) {
        setValues(toDisplayValues(fetcher.data.line));
      }
    }
  }, [fetcher.data]);

  function handleChange(field) {
    return (val) => {
      setDirty(true);
      setValues((prev) => {
        const next = { ...prev, [field]: val };

        // For OG: keep knipmaat and panels in sync
        if (isOG && heightMm > 0) {
          const perPanel = (heightMm + 250) / 10; // cm per panel

          if (field === "knipmaatLeft" || field === "knipmaatRight") {
            const knipmaatCm = Number(val) || 0;
            const totalPanels = perPanel > 0 ? Math.round(knipmaatCm / perPanel) : 0;

            const curLeft = Number(prev.panelsLeft) || 0;
            const curRight = Number(prev.panelsRight) || 0;
            const curTotal = curLeft + curRight;

            if (curTotal > 0 && curLeft > 0 && curRight > 0) {
              const ratio = curLeft / curTotal;
              next.panelsLeft = Math.round(totalPanels * ratio);
              next.panelsRight = totalPanels - Math.round(totalPanels * ratio);
            } else if (curRight > 0 && curLeft === 0) {
              next.panelsLeft = 0;
              next.panelsRight = totalPanels;
            } else {
              next.panelsLeft = totalPanels;
              next.panelsRight = 0;
            }
          } else if (field === "panelsLeft" || field === "panelsRight") {
            const newLeft = field === "panelsLeft" ? (Number(val) || 0) : (Number(prev.panelsLeft) || 0);
            const newRight = field === "panelsRight" ? (Number(val) || 0) : (Number(prev.panelsRight) || 0);
            const knipmaat = (newLeft + newRight) * perPanel;

            const divRight = (line.panelDivision || "").toLowerCase().includes("right");
            next.knipmaatLeft = divRight ? 0 : knipmaat;
            next.knipmaatRight = divRight ? knipmaat : 0;
          }
        }

        return next;
      });
    };
  }

  function handleSave() {
    const fields = reverseCalculateFields(values, line);
    fetcher.submit(
      { lineId: line.id, fields },
      { method: "POST", action: "/app/order-lines", encType: "application/json" },
    );
  }

  function handleCancel() {
    setDirty(false);
    setValues(toDisplayValues(line));
  }

  return (
    <Box paddingBlockStart="300" paddingBlockEnd="300">
      <InlineStack gap="800" wrap={false}>
        <Box minWidth="50%">
          <BlockStack gap="100">
            <Text variant="headingSm" as="h4">Lijn info</Text>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", listStyle: "disc" }}>
              <li><Text variant="bodySm" as="span">Hoeveelheid: {line.quantity ?? "—"}</Text></li>
              <li><Text variant="bodySm" as="span">{line.productTitle ?? "—"}</Text></li>
              {line.panelDivision && (
                <li><Text variant="bodySm" as="span">{line.panelDivision}</Text></li>
              )}
            </ul>
          </BlockStack>
        </Box>
        <Box minWidth="40%">
          <BlockStack gap="200">
            <Text variant="headingSm" as="h4">Paneel info</Text>
            <BlockStack gap="200">
              <InlineStack gap="300" wrap={false}>
                <TextField
                  label="Knipmaat links (cm)"
                  value={String(values.knipmaatLeft)}
                  onChange={handleChange("knipmaatLeft")}
                  type="number"
                  autoComplete="off"
                  size="slim"
                />
                <TextField
                  label="Knipmaat rechts (cm)"
                  value={String(values.knipmaatRight)}
                  onChange={handleChange("knipmaatRight")}
                  type="number"
                  autoComplete="off"
                  size="slim"
                />
              </InlineStack>
              <InlineStack gap="300" wrap={false}>
                <TextField
                  label="Banen links"
                  value={String(values.panelsLeft)}
                  onChange={handleChange("panelsLeft")}
                  type="number"
                  autoComplete="off"
                  size="slim"
                />
                <TextField
                  label="Banen rechts"
                  value={String(values.panelsRight)}
                  onChange={handleChange("panelsRight")}
                  type="number"
                  autoComplete="off"
                  size="slim"
                />
              </InlineStack>
              {saveError && (
                <Banner tone="critical" onDismiss={() => {}}>
                  <p>{saveError}</p>
                </Banner>
              )}
              {dirty && (
                <InlineStack gap="200">
                  <Button variant="primary" onClick={handleSave} loading={isSaving}>
                    Opslaan
                  </Button>
                  <Button onClick={handleCancel} disabled={isSaving}>
                    Annuleren
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </BlockStack>
        </Box>
      </InlineStack>
    </Box>
  );
}

/* ── Order Card ── */

function OrderCard({ order, lines }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  const orderId = order.id != null ? String(order.id) : "—";
  const customerName = order["customer name"] || "—";
  const status = order.status || "—";
  const date = formatDate(order.created_at);

  async function handlePrintAndSend() {
    setPrinting(true);
    try {
      const res = await fetch(
        "https://voordeelgordijnen.n8n.sition.cloud/webhook/377b0505-2c7c-4808-8643-eb74796f1449",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error("Print & verstuur failed:", e);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Card>
      <BlockStack gap="0">
        {/* Header */}
        <Box paddingBlockEnd="300">
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <InlineStack gap="600" blockAlign="center" wrap={false}>
              <Text variant="headingMd" as="h3" fontWeight="bold">
                {customerName}
              </Text>
              <Text variant="headingMd" as="span" tone="subdued">
                #{orderId}
              </Text>
              <Badge tone={statusTone(status)}>{status}</Badge>
              <Text variant="bodySm" as="span" tone="subdued">
                {date}
              </Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <Button variant="primary" tone="critical" onClick={handlePrintAndSend} loading={printing}>
                Print &amp; verstuur
              </Button>
              <Button>Archiveer &amp; verstuur</Button>
              <Popover
                active={menuOpen}
                onClose={() => setMenuOpen(false)}
                activator={
                  <Button
                    onClick={() => setMenuOpen((o) => !o)}
                    accessibilityLabel="More actions"
                    icon={<span style={{ fontSize: "1.2em" }}>···</span>}
                  />
                }
              >
                <ActionList
                  items={[
                    { content: "Bekijk details" },
                    { content: "Bewerk order" },
                    { content: "Verwijder", destructive: true },
                  ]}
                  onActionAnyItem={() => setMenuOpen(false)}
                />
              </Popover>
            </InlineStack>
          </InlineStack>
        </Box>

        {/* Lines */}
        {lines && lines.length > 0 ? (
          <BlockStack gap="0">
            {lines.map((line, i) => (
              <div key={line.id ?? i}>
                <Divider />
                <OrderLine line={line} />
              </div>
            ))}
          </BlockStack>
        ) : (
          <Box paddingBlockStart="300">
            <Divider />
            <Box paddingBlockStart="300">
              <Text variant="bodySm" as="span" tone="subdued">
                Geen lijnen gevonden voor deze order.
              </Text>
            </Box>
          </Box>
        )}
      </BlockStack>
    </Card>
  );
}

/* ── Main Page ── */

export default function Orders() {
  const { orders, linesByOrder, total, page, search, error, sortBy, sortDir, supabaseUrl, supabaseKey } =
    useLoaderData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lastEvent, setLastEvent] = useState(null);
  const [searchValue, setSearchValue] = useState(search || "");

  const handleRealtimeEvent = useCallback(
    (payload) => {
      setLastEvent({ type: payload.eventType, at: Date.now() });
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    },
    [revalidator],
  );

  const realtimeTables = ["Webattelier - orders", "Webattelier - lines"];
  const realtimeStatus = useSupabaseRealtime(
    supabaseUrl,
    supabaseKey,
    realtimeTables,
    handleRealtimeEvent,
  );

  // Polling fallback: refresh data every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [revalidator]);

  const [selectedTab, setSelectedTab] = useState(0);

  const STATUS_TABS = [
    { id: "all", content: "Alle", filter: null },
    { id: "open", content: "Open", filter: "open" },
    { id: "ready-for-print", content: "Ready for print", filter: "ready for print" },
    { id: "archived", content: "Archived", filter: "archived" },
    { id: "deleted", content: "Deleted", filter: "deleted" },
  ];

  const activeFilter = STATUS_TABS[selectedTab].filter;
  const filteredOrders = activeFilter
    ? orders.filter((o) => String(o.status || "").toLowerCase() === activeFilter)
    : orders;

  const isLoading = navigation.state === "loading";
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleSearch() {
    const params = new URLSearchParams(searchParams);
    params.delete("page");
    if (searchValue.trim()) {
      params.set("q", searchValue.trim());
    } else {
      params.delete("q");
    }
    setSearchParams(params);
  }

  const SORT_OPTIONS = [
    { label: "Order nr (nieuwste eerst)", value: "id__desc" },
    { label: "Order nr (oudste eerst)", value: "id__asc" },
    { label: "Datum (nieuwste eerst)", value: "created_at__desc" },
    { label: "Datum (oudste eerst)", value: "created_at__asc" },
    { label: "Klant (A-Z)", value: "customer name__asc" },
    { label: "Klant (Z-A)", value: "customer name__desc" },
  ];

  function handleSortChange(val) {
    const [newSort, newDir] = val.split("__");
    const params = new URLSearchParams(searchParams);
    params.set("sort", newSort);
    params.set("dir", newDir);
    params.delete("page");
    setSearchParams(params);
  }

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
    <Page fullWidth title="Webatelier orders">
      <TitleBar title="Webatelier orders" />
      <BlockStack gap="400">
        {/* Top bar: search + status */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="end">
            <Box minWidth="400px" maxWidth="600px">
              <TextField
              placeholder="Search"
              value={searchValue}
              onChange={setSearchValue}
              onClearButtonClick={() => {
                setSearchValue("");
                const params = new URLSearchParams(searchParams);
                params.delete("q");
                params.delete("page");
                setSearchParams(params);
              }}
              clearButton
              autoComplete="off"
              prefix={<Icon source={SearchIcon} />}
              onBlur={handleSearch}
              connectedRight={
                <Button onClick={handleSearch} variant="primary">
                  Search
                </Button>
              }
              />
            </Box>
            <Box minWidth="220px">
              <Select
                label="Sorteer op"
                labelInline
                options={SORT_OPTIONS}
                value={`${sortBy}__${sortDir}`}
                onChange={handleSortChange}
              />
            </Box>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodySm" as="span" tone="subdued">
              {total} orders
            </Text>
            {lastEvent && (
              <Text variant="bodySm" as="span" tone="subdued">
                · {lastEvent.type}
              </Text>
            )}
            <Badge
              tone={
                realtimeStatus === "connected"
                  ? "success"
                  : realtimeStatus === "error"
                    ? "critical"
                    : "attention"
              }
            >
              {realtimeStatus === "connected"
                ? "Live"
                : realtimeStatus === "connecting"
                  ? "Connecting..."
                  : realtimeStatus === "error"
                    ? "Realtime error"
                    : "Disconnected"}
            </Badge>
          </InlineStack>
        </InlineStack>

        {error && (
          <Banner tone="critical">
            <p>Failed to load orders: {error}</p>
          </Banner>
        )}

        <Tabs tabs={STATUS_TABS} selected={selectedTab} onSelect={setSelectedTab}>
          {/* Orders */}
          {isLoading ? (
            <Box padding="800">
              <InlineStack align="center">
                <Spinner size="large" />
              </InlineStack>
            </Box>
          ) : filteredOrders.length === 0 ? (
            <Card>
              <Box padding="800">
                <BlockStack gap="200" inlineAlign="center">
                  <Text variant="headingMd" as="h3">
                    Geen orders gevonden
                  </Text>
                  <Text variant="bodySm" as="span" tone="subdued">
                    {search
                      ? `Geen resultaten voor "${search}"`
                      : activeFilter
                        ? `Geen orders met status "${STATUS_TABS[selectedTab].content}"`
                        : "Orders uit de Webattelier - orders tabel verschijnen hier."}
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          ) : (
            <BlockStack gap="400">
              {filteredOrders.map((order, i) => {
                const orderId = order.id != null ? String(order.id) : null;
                const lines = orderId ? linesByOrder[orderId] || [] : [];
                return <OrderCard key={orderId ?? i} order={order} lines={lines} />;
              })}
            </BlockStack>
          )}
        </Tabs>

        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
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
