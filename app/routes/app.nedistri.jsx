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
  Select,
  Tabs,
  Divider,
  Icon,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import supabase from "../supabase.server";

const PAGE_SIZE = 50;

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("q") || "";
  const tab = url.searchParams.get("tab") || "pending";

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    let query = supabase
      .from("nedistri")
      .select("*", { count: "exact" })
      .order("id", { ascending: false })
      .range(from, to);

    if (search.trim()) {
      const isNumeric = /^\d+$/.test(search.trim());
      const filters = [`customerName.ilike.%${search}%`];
      if (isNumeric) {
        filters.push(`orderNumber.eq.${search.trim()}`);
        filters.push(`orderId.eq.${search.trim()}`);
      }
      query = query.or(filters.join(","));
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return json({
      orders: data ?? [],
      total: count,
      page,
      search,
      tab,
      error: null,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  } catch (e) {
    console.error("Failed to load nedistri orders:", e.message);
    return json({
      orders: [],
      total: 0,
      page,
      search,
      tab,
      error: e.message,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  }
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const body = await request.json();

  if (body._action === "updateBundles") {
    const { id, HAN, BNL, BNK } = body;
    const { data, error } = await supabase
      .from("nedistri")
      .update({ HAN, BNL, BNK, status: "Print labels" })
      .eq("id", id)
      .select()
      .single();

    if (error) return json({ ok: false, error: error.message });
    return json({ ok: true, order: data });
  }

  return json({ ok: false, error: "Unknown action" });
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

    let channel = client.channel("realtime-nedistri");
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

function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

/* ── Order Card ── */

function NedistriCard({ order, readOnly = false }) {
  const fetcher = useFetcher();
  const [values, setValues] = useState({
    HAN: order.HAN ?? 0,
    BNL: order.BNL ?? 0,
    BNK: order.BNK ?? 0,
  });
  const [dirty, setDirty] = useState(false);

  const isSaving = fetcher.state === "submitting";
  const saveError = fetcher.data?.ok === false ? fetcher.data.error : null;

  useEffect(() => {
    if (!dirty) {
      setValues({
        HAN: order.HAN ?? 0,
        BNL: order.BNL ?? 0,
        BNK: order.BNK ?? 0,
      });
    }
  }, [order.HAN, order.BNL, order.BNK]);

  useEffect(() => {
    if (fetcher.data?.ok) {
      setDirty(false);
      if (fetcher.data.order) {
        setValues({
          HAN: fetcher.data.order.HAN ?? 0,
          BNL: fetcher.data.order.BNL ?? 0,
          BNK: fetcher.data.order.BNK ?? 0,
        });
      }
    }
  }, [fetcher.data]);

  function handleChange(field) {
    return (val) => {
      setDirty(true);
      setValues((prev) => ({ ...prev, [field]: val }));
    };
  }

  function handleSave() {
    fetcher.submit(
      {
        _action: "updateBundles",
        id: order.id,
        HAN: values.HAN === "" ? 0 : Number(values.HAN),
        BNL: values.BNL === "" ? 0 : Number(values.BNL),
        BNK: values.BNK === "" ? 0 : Number(values.BNK),
      },
      { method: "POST", encType: "application/json" },
    );

    // Send order number to n8n webhook
    fetch("https://voordeelgordijnen.n8n.sition.cloud/webhook/13ac60c2-2f3e-4652-9f54-9c425c3605ac", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: order.orderNumber }),
    }).catch((e) => console.error("Webhook failed:", e));
  }

  function handleCancel() {
    setDirty(false);
    setValues({
      HAN: order.HAN ?? 0,
      BNL: order.BNL ?? 0,
      BNK: order.BNK ?? 0,
    });
  }

  // Parse itemTitles (stored as JSON string or plain text)
  let items = [];
  if (order.itemTitles) {
    try {
      const parsed = JSON.parse(order.itemTitles);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      items = order.itemTitles.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header row */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="800" blockAlign="center" wrap={false}>
            <Text variant="headingMd" as="h3" fontWeight="bold">
              {order.orderNumber ?? "—"}
            </Text>
            <Text variant="bodyMd" as="span">
              {order.customerName ?? "—"}
            </Text>
          </InlineStack>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Badge tone={order.status === "Label not made" ? "attention" : "success"}>
              {order.status ?? "—"}
            </Badge>
            {readOnly && order.labels_pdf && (
              <button
                onClick={() => window.open(order.labels_pdf, "_blank")}
                style={{
                  backgroundColor: "#8B2500",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: "12px",
                }}
              >
                Print
              </button>
            )}
          </InlineStack>
        </InlineStack>

        <Divider />

        {/* Products + Bundles row */}
        <InlineStack gap="400" wrap={false}>
          {/* Products list */}
          <Box minWidth="30%">
            <BlockStack gap="200">
              <Text variant="headingSm" as="h4">Producten</Text>
              {items.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: "1.2rem", listStyle: "disc" }}>
                  {items.map((item, i) => (
                    <li key={i}>
                      <Text variant="bodySm" as="span">{String(item)}</Text>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text variant="bodySm" as="span" tone="subdued">Geen producten</Text>
              )}
            </BlockStack>
          </Box>

          {/* Bundels Kort */}
          <Box minWidth="15%">
            <BlockStack gap="200">
              <Text variant="headingSm" as="h4">Bundels Kort</Text>
              <Box maxWidth="80px">
                <TextField
                  value={String(values.BNK)}
                  onChange={handleChange("BNK")}
                  type="number"
                  autoComplete="off"
                  label=""
                  labelHidden
                  disabled={readOnly}
                />
              </Box>
            </BlockStack>
          </Box>

          {/* Bundels Lang */}
          <Box minWidth="15%">
            <BlockStack gap="200">
              <Text variant="headingSm" as="h4">Bundels Lang</Text>
              <Box maxWidth="80px">
                <TextField
                  value={String(values.BNL)}
                  onChange={handleChange("BNL")}
                  type="number"
                  autoComplete="off"
                  label=""
                  labelHidden
                  disabled={readOnly}
                />
              </Box>
            </BlockStack>
          </Box>

          {/* Hangers */}
          <Box minWidth="15%">
            <BlockStack gap="200">
              <Text variant="headingSm" as="h4">Hangers</Text>
              <Box maxWidth="80px">
                <TextField
                  value={String(values.HAN)}
                  onChange={handleChange("HAN")}
                  type="number"
                  autoComplete="off"
                  label=""
                  labelHidden
                  disabled={readOnly}
                />
              </Box>
            </BlockStack>
          </Box>
        </InlineStack>

        {/* Save/Cancel buttons */}
        {!readOnly && saveError && (
          <Banner tone="critical">
            <p>{saveError}</p>
          </Banner>
        )}
        {!readOnly && dirty && (
          <InlineStack gap="200">
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                backgroundColor: "#8B2500",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "6px 16px",
                cursor: isSaving ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              {isSaving ? "Opslaan..." : "Pas aan en zet klaar voor printen"}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              style={{
                backgroundColor: "#e5e5e5",
                color: "#333",
                border: "none",
                borderRadius: "8px",
                padding: "6px 16px",
                cursor: isSaving ? "not-allowed" : "pointer",
              }}
            >
              Annuleren
            </button>
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}

/* ── Main Page ── */

export default function NeDistri() {
  const { orders, total, page, search, tab, error, supabaseUrl, supabaseKey } = useLoaderData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(search || "");
  const [selectedTab, setSelectedTab] = useState(tab === "ready" ? 1 : 0);

  const handleRealtimeEvent = useCallback(
    (payload) => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    },
    [revalidator],
  );

  const realtimeTables = ["nedistri"];
  const realtimeStatus = useSupabaseRealtime(
    supabaseUrl,
    supabaseKey,
    realtimeTables,
    handleRealtimeEvent,
  );

  const STATUS_TABS = [
    { id: "pending", content: "Nog te bewerken" },
    { id: "ready", content: "Klaar om te printen" },
  ];

  const filteredOrders = selectedTab === 0
    ? orders.filter((o) => o.status !== "Print labels" && o.status !== "Done")
    : orders.filter((o) => o.status === "Print labels" || o.status === "Done");

  const isLoading = navigation.state === "loading";
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Week number filter
  const weekOptions = [{ label: "Week nummer", value: "" }];
  const currentWeek = getWeekNumber(new Date());
  for (let w = currentWeek; w >= Math.max(1, currentWeek - 10); w--) {
    weekOptions.push({ label: `Week ${w}`, value: String(w) });
  }
  const [weekFilter, setWeekFilter] = useState("");

  const displayOrders = weekFilter
    ? filteredOrders.filter((o) => String(o.Batch) === weekFilter)
    : filteredOrders;

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

  function handleTabChange(index) {
    setSelectedTab(index);
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
    <Page fullWidth>
      <TitleBar title="NE Distri" />
      <BlockStack gap="400">
        {/* Title */}
        <BlockStack gap="100">
          <Text variant="headingXl" as="h1">Ne DistriService</Text>
          <Text variant="bodyMd" as="p" tone="subdued">
            Hier vindt je alle orders met Ne DistriService
          </Text>
        </BlockStack>

        {/* Tabs */}
        <div className="nedistri-tabs">
          <style>{`.nedistri-tabs .Polaris-Tabs__Wrapper { padding: 0; } .nedistri-tabs .Polaris-Tabs__Panel { padding: 0; } .nedistri-tabs .Polaris-Tabs__Outer { border: none; }`}</style>
          <Tabs tabs={STATUS_TABS} selected={selectedTab} onSelect={handleTabChange} />
        </div>

        {/* Search + week filter + realtime status */}
        <InlineStack align="space-between" blockAlign="end">
          <InlineStack gap="300" blockAlign="end">
            <Box minWidth="400px" maxWidth="600px">
              <div onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}>
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
                  label=""
                  labelHidden
                />
              </div>
            </Box>
            <Box minWidth="160px">
              <Select
                label=""
                labelHidden
                options={weekOptions}
                value={weekFilter}
                onChange={setWeekFilter}
              />
            </Box>
          </InlineStack>
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

        {error && (
          <Banner tone="critical">
            <p>Failed to load orders: {error}</p>
          </Banner>
        )}

        {/* Orders */}
        {isLoading ? (
          <Box padding="800">
            <InlineStack align="center">
              <Spinner size="large" />
            </InlineStack>
          </Box>
        ) : displayOrders.length === 0 ? (
          <Card>
            <Box padding="800">
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd" as="h3">
                  Geen orders gevonden
                </Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  {search
                    ? `Geen resultaten voor "${search}"`
                    : "Orders verschijnen hier zodra ze worden toegevoegd."}
                </Text>
              </BlockStack>
            </Box>
          </Card>
        ) : (
          <BlockStack gap="400">
            {displayOrders.map((order) => (
              <NedistriCard key={order.id} order={order} readOnly={selectedTab === 1} />
            ))}
          </BlockStack>
        )}

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
