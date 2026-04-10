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
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("q") || "";
  const sortBy = url.searchParams.get("sort") || "id";
  const sortDir = url.searchParams.get("dir") || "desc";
  const status = url.searchParams.get("status") ?? "open,Creating pdf";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count } = search
      ? await searchOrders(search, { from, to, sortBy, sortDir, status })
      : await queryTable("Webattelier - orders", { from, to, sortBy, sortDir, status });

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
      status,
      shop,
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

  return { status, clientRef };
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

const DIVISION_NL = {
  "1 part left": "1 deel links",
  "1 part right": "1 deel rechts",
  "2 equal parts": "2 gelijke delen",
  "2 unequal parts": "2 ongelijke delen",
};

function translateDivision(value) {
  if (!value) return value;
  return DIVISION_NL[value.toLowerCase()] || value;
}

function parseLineDetails(line) {
  let details = [];
  try {
    const json = typeof line.orderJson === "string" ? JSON.parse(line.orderJson) : line.orderJson;
    if (json?.orderLineDetails) details = json.orderLineDetails;
  } catch {}

  const codes = details.map((d) => d.finishCode || "");

  // Hanging system
  const hasRing = codes.some((c) => c.includes("RING") || c.includes("ARTRNG"));
  const hangingSystem = hasRing ? "Ringensysteem" : "Railsysteem";

  // Plooi type
  let plooiName = "Geen plooi";
  if (codes.some((c) => c.includes("BEVWAVE"))) plooiName = "Waveplooi";
  else if (codes.some((c) => c.includes("AFWPPL3"))) plooiName = "Driedubbele plooi";
  else if (codes.some((c) => c.includes("AFWPPL2"))) plooiName = "Dubbele plooi";
  else if (codes.some((c) => c.includes("AFWPPL1"))) plooiName = "Enkele plooi";
  else if (codes.some((c) => c.includes("BEVRAIL"))) plooiName = "Enkele plooi";
  else if (codes.some((c) => c.includes("BEVRING"))) plooiName = "Enkele plooi";

  // Ring type
  const ringCode = details.find((d) => d.productCode?.includes("ARTRNG"))?.productCode || "";
  const RING_NAMES = {
    "ARTRNG_CH25": "25mm chroom",
    "ARTRNG_CH40": "40mm chroom",
    "ARTRNG_ZW25": "25mm zwart",
    "ARTRNG_ZW40": "40mm zwart",
    "ARTRNG_MS25": "25mm messing",
    "ARTRNG_MS40": "40mm messing",
    "ARTRNG_OZ25": "25mm zilver",
    "ARTRNG_OZ40": "40mm zilver",
  };
  const ringName = RING_NAMES[ringCode] || "Geen ringen";

  // Lining
  const liningCode = line.liningFabricCode;
  const lining = liningCode && liningCode.trim() ? liningCode : "Geen Voeringsstof";

  // Dimensions
  const widthMm = (line.finishedWidthLeftInMm || 0) + (line.finishedWidthRightInMm || 0);
  const heightMm = line.finishedHeightInMm || 0;
  const dimensions = `${(widthMm / 10).toFixed(1).replace(/\.0$/, "")}cm x ${(heightMm / 10).toFixed(1).replace(/\.0$/, "")}cm`;

  return { hangingSystem, plooiName, ringName, lining, dimensions };
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
    const roundedLeft = Math.ceil((line.panelsLeft || 0) * 2) / 2;
    const roundedRight = Math.ceil((line.panelsRight || 0) * 2) / 2;
    const totalPanels = roundedLeft + roundedRight;
    const knipmaat = totalPanels > 0 ? Math.round(((heightMm + 250) * totalPanels) / 10) : 0;
    const divRight = (line.panelDivision || "").toLowerCase().includes("right");
    knipmaatLeft = divRight ? 0 : knipmaat;
    knipmaatRight = divRight ? knipmaat : 0;
  } else {
    knipmaatLeft = plooiFactor
      ? Math.round(((line.finishedWidthLeftInMm || 0) * plooiFactor) / 10)
      : (line.cutSizeLeftInMm || 0);
    knipmaatRight = plooiFactor
      ? Math.round(((line.finishedWidthRightInMm || 0) * plooiFactor) / 10)
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

  let finWidthLeft, finWidthRight, cutLeft, cutRight;
  if (isOG) {
    // For OG: cutSize is per-panel (heightMm + 250) stored in cm — don't overwrite with total knipmaat
    finWidthLeft = line.finishedWidthLeftInMm;
    finWidthRight = line.finishedWidthRightInMm;
    cutLeft = line.cutSizeLeftInMm;
    cutRight = line.cutSizeRightInMm;
  } else if (plooiFactor > 0) {
    finWidthLeft = knipmaatLeftCm != null ? Math.round((knipmaatLeftCm * 10) / plooiFactor) : null;
    finWidthRight = knipmaatRightCm != null ? Math.round((knipmaatRightCm * 10) / plooiFactor) : null;
    cutLeft = knipmaatLeftCm;
    cutRight = knipmaatRightCm;
  } else {
    finWidthLeft = line.finishedWidthLeftInMm;
    finWidthRight = line.finishedWidthRightInMm;
    cutLeft = knipmaatLeftCm;
    cutRight = knipmaatRightCm;
  }

  return {
    finishedWidthLeftInMm: finWidthLeft,
    finishedWidthRightInMm: finWidthRight,
    panelsLeft: pLeft,
    panelsRight: pRight,
    cutSizeLeftInMm: cutLeft,
    cutSizeRightInMm: cutRight,
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
            const roundedLeft = Math.ceil(newLeft * 2) / 2;
            const roundedRight = Math.ceil(newRight * 2) / 2;
            const knipmaat = (roundedLeft + roundedRight) * perPanel;

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

  const { hangingSystem, plooiName, ringName, lining, dimensions } = parseLineDetails(line);

  return (
    <Box paddingBlockStart="300" paddingBlockEnd="300">
      <InlineStack gap="800" wrap={false}>
        <Box minWidth="50%">
          <BlockStack gap="100">
            <Text variant="headingSm" as="h4">Lijn info</Text>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", listStyle: "disc" }}>
              <li><Text variant="bodySm" as="span">Hoeveelheid: {line.quantity ?? "—"}</Text></li>
              <li><Text variant="bodySm" as="span">{line.productTitle ?? "—"}</Text></li>
              <li><Text variant="bodySm" as="span">{dimensions}</Text></li>
              {line.panelDivision && (
                <li><Text variant="bodySm" as="span">{translateDivision(line.panelDivision)}</Text></li>
              )}
              <li><Text variant="bodySm" as="span">{hangingSystem}</Text></li>
              <li><Text variant="bodySm" as="span">{plooiName}</Text></li>
              <li><Text variant="bodySm" as="span">{ringName}</Text></li>
              <li><Text variant="bodySm" as="span">{lining}</Text></li>
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

function OrderCard({ order, lines, shop, highlighted, errorExit, readOnly, supabaseUrl, supabaseKey }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [actionDone, setActionDone] = useState(null); // "print" | "archive" | "error" | null
  const cardRef = useRef(null);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlighted]);

  useEffect(() => {
    if (errorExit && !actionDone) {
      setActionDone("Error");
      setTimeout(() => setExiting(true), 600);
    }
  }, [errorExit]);

  const orderId = order.id != null ? String(order.id) : "—";
  const customerName = order["customer name"] || "—";
  const status = order.status || "—";
  const date = formatDate(order.created_at);

  function triggerExit(label) {
    setActionDone(label);
    setTimeout(() => setExiting(true), 600);
  }

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
      const resData = await res.json().catch(() => null);
      console.log("Print & verstuur response:", res.status, resData);
      if (!res.ok || resData?.status === "error" || resData?.error) throw new Error(resData?.message || resData?.error || `HTTP ${res.status}`);
      triggerExit("Verstuurd");
    } catch (e) {
      console.error("Print & verstuur failed:", e);
      triggerExit("Error");
    } finally {
      setPrinting(false);
    }
  }

  async function handlePrintReady() {
    setPrinting(true);
    try {
      if (order.pdf_url) {
        window.open(order.pdf_url, "_blank");
      }
      if (status !== "Done") {
        const client = createClient(supabaseUrl, supabaseKey);
        await client
          .from("Webattelier - orders")
          .update({ status: "Done" })
          .eq("id", orderId);
        triggerExit("Geprint & afgerond");
      }
    } catch (e) {
      console.error("Print ready failed:", e);
      triggerExit("Error");
    } finally {
      setPrinting(false);
    }
  }

  async function handleArchiveAndSend() {
    setArchiving(true);
    try {
      const res = await fetch(
        "https://voordeelgordijnen.n8n.sition.cloud/webhook/7e0022e4-630d-4f0d-99aa-efc0864457c1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      triggerExit("Gearchiveerd & verstuurd");
    } catch (e) {
      console.error("Verstuur & markeer voor bulk failed:", e);
      triggerExit("Error");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div
      ref={cardRef}
      style={{
        borderRadius: "12px",
        transition: "box-shadow 0.3s ease, outline 0.3s ease, opacity 0.5s ease, transform 0.5s ease, max-height 0.5s ease",
        boxShadow: highlighted
          ? "0 0 0 3px rgba(192, 43, 43, 0.35)"
          : actionDone
            ? actionDone === "Error"
              ? "0 0 0 3px rgba(192, 43, 43, 0.35)"
              : "0 0 0 3px rgba(52, 125, 84, 0.35)"
            : "none",
        outline: highlighted
          ? "2px solid rgba(192, 43, 43, 0.6)"
          : actionDone
            ? actionDone === "Error"
              ? "2px solid rgba(192, 43, 43, 0.6)"
              : "2px solid rgba(52, 125, 84, 0.6)"
            : "2px solid transparent",
        opacity: exiting ? 0 : 1,
        transform: exiting ? "translateX(40px)" : "translateX(0)",
        maxHeight: exiting ? "0px" : "2000px",
        overflow: "hidden",
      }}
    >
    {actionDone && (
      <div style={{
        background: actionDone === "Error"
          ? "linear-gradient(90deg, rgba(192, 43, 43, 0.08), transparent)"
          : "linear-gradient(90deg, rgba(52, 125, 84, 0.08), transparent)",
        padding: "8px 16px",
        borderRadius: "12px 12px 0 0",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}>
        <span style={{ color: actionDone === "Error" ? "#C02B2B" : "#347D54", fontWeight: 600, fontSize: "13px" }}>
          {actionDone === "Error" ? "✕" : "✓"} {actionDone}
        </span>
      </div>
    )}
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
              {readOnly ? (
                order.pdf_url ? (
                  <Button variant="primary" onClick={handlePrintReady} loading={printing}>
                    {printing ? "Printen..." : "Print"}
                  </Button>
                ) : null
              ) : (
                <>
                  <Button variant="primary" tone="critical" onClick={handlePrintAndSend} loading={printing}>
                    {printing ? "Versturen..." : "Print & verstuur"}
                  </Button>
                  <Button onClick={handleArchiveAndSend} loading={archiving}>Archiveer &amp; verstuur</Button>
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
                        { content: "Bekijk details", onAction: () => window.open(`https://${shop}/admin/orders?query=name%3A%23${orderId}`, '_blank') },
                        { content: "Verwijder", destructive: true, onAction: async () => {
                          try {
                            const client = createClient(supabaseUrl, supabaseKey);
                            await client
                              .from("Webattelier - orders")
                              .update({ status: "Deleted" })
                              .eq("id", orderId);
                            triggerExit("Verwijderd");
                          } catch (e) {
                            console.error("Delete failed:", e);
                            triggerExit("Error");
                          }
                        }},
                      ]}
                      onActionAnyItem={() => setMenuOpen(false)}
                    />
                  </Popover>
                </>
              )}
            </InlineStack>
          </InlineStack>
        </Box>

        {/* Error message */}
        {order.error_message && (
          <Box paddingBlockEnd="300">
            <Banner tone="critical">
              <p>{order.error_message}</p>
            </Banner>
          </Box>
        )}

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
    </div>
  );
}

/* ── Main Page ── */

export default function Orders() {
  const { orders, linesByOrder, total, page, search, error, sortBy, sortDir, status, shop, supabaseUrl, supabaseKey } =
    useLoaderData();
  const [bulkPrinting, setBulkPrinting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ step: "", current: 0, total: 0 });
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lastEvent, setLastEvent] = useState(null);
  const [searchValue, setSearchValue] = useState(search || "");

  const [changedIds, setChangedIds] = useState(new Set());
  const [errorExitIds, setErrorExitIds] = useState(new Set());
  const changedTimers = useRef({});

  const handleRealtimeEvent = useCallback(
    (payload) => {
      setLastEvent({ type: payload.eventType, at: Date.now() });

      // Track which order changed for highlight animation
      const record = payload.new || payload.old || {};
      const changedId = record.id ?? record.orderId;
      if (changedId != null) {
        const key = String(changedId);
        const newStatus = (record.status || "").toLowerCase();
        if (newStatus === "error") {
          setErrorExitIds((prev) => new Set(prev).add(key));
        } else {
          setChangedIds((prev) => new Set(prev).add(key));
          clearTimeout(changedTimers.current[key]);
          changedTimers.current[key] = setTimeout(() => {
            setChangedIds((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
          }, 2000);
        }
      }

      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    },
    [revalidator],
  );

  const realtimeTables = ["Webattelier - orders", "Webattelier - lines"];
  const { status: realtimeStatus, clientRef } = useSupabaseRealtime(
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

  const STATUS_TABS = [
    { id: "open", content: "Open", filter: "open,Creating pdf" },
    { id: "ready-for-print", content: "Ready for print", filter: "ready for print" },
    { id: "done", content: "Done", filter: "done" },
    { id: "deleted", content: "Deleted", filter: "deleted" },
    { id: "errors", content: "Errors", filter: "error" },
  ];

  const selectedTab = Math.max(0, STATUS_TABS.findIndex((t) => t.filter === status));

  function handleTabChange(index) {
    const params = new URLSearchParams(searchParams);
    const filter = STATUS_TABS[index].filter;
    params.set("status", filter);
    params.delete("page");
    setSearchParams(params);
  }

  async function handleBulkPrint() {
    if (orders.length === 0) return;
    setBulkPrinting(true);

    try {
      // Step 1: Collect PDF URLs directly from loaded order data (no webhook calls needed)
      let pdfUrls = orders
        .map((o) => o.pdf_url)
        .filter(Boolean);

      // Fallback: if no pdf_urls in data, fetch from webhook (sequential, slower)
      if (pdfUrls.length === 0) {
        const orderIds = orders.map((o) => String(o.id)).filter(Boolean);
        setBulkProgress({ step: "fetch", current: 0, total: orderIds.length });
        for (let i = 0; i < orderIds.length; i++) {
          setBulkProgress({ step: "fetch", current: i + 1, total: orderIds.length });
          try {
            const res = await fetch(
              "https://voordeelgordijnen.n8n.sition.cloud/webhook/377b0505-2c7c-4808-8643-eb74796f1449",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: orderIds[i] }),
              },
            );
            if (!res.ok) continue;
            const data = await res.json();
            if (data.pdf_url) pdfUrls.push(data.pdf_url);
          } catch (e) {
            console.error("Failed to get PDF for order", orderIds[i], e);
          }
        }
      }

      // Step 2: Download PDFs in parallel batches and merge
      if (pdfUrls.length > 0) {
        setBulkProgress({ step: "download", current: 0, total: pdfUrls.length });
        const { PDFDocument } = await import("pdf-lib");
        const mergedPdf = await PDFDocument.create();

        // Download in parallel batches of 6
        const BATCH = 6;
        const pdfBuffers = new Array(pdfUrls.length);
        for (let i = 0; i < pdfUrls.length; i += BATCH) {
          const batch = pdfUrls.slice(i, i + BATCH);
          const results = await Promise.allSettled(
            batch.map((url) => fetch(url).then((r) => r.arrayBuffer())),
          );
          results.forEach((result, j) => {
            if (result.status === "fulfilled") {
              pdfBuffers[i + j] = result.value;
            } else {
              console.error("Failed to load PDF:", pdfUrls[i + j], result.reason);
            }
          });
          setBulkProgress({ step: "download", current: Math.min(i + BATCH, pdfUrls.length), total: pdfUrls.length });
        }

        // Merge all downloaded PDFs
        setBulkProgress({ step: "merge", current: 0, total: 0 });
        for (const bytes of pdfBuffers) {
          if (!bytes) continue;
          try {
            const doc = await PDFDocument.load(bytes);
            const pages = await mergedPdf.copyPages(doc, doc.getPageIndices());
            pages.forEach((p) => mergedPdf.addPage(p));
          } catch (e) {
            console.error("Failed to parse PDF:", e);
          }
        }

        const mergedBytes = await mergedPdf.save();
        const blob = new Blob([mergedBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      }

      // Step 3: Set all orders to Done
      if (clientRef.current) {
        const uuids = orders.map((o) => o.uuid).filter(Boolean);
        const BATCH_SIZE = 100;
        const totalBatches = Math.ceil(uuids.length / BATCH_SIZE);
        for (let i = 0; i < uuids.length; i += BATCH_SIZE) {
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          setBulkProgress({ step: "status", current: batchNum, total: totalBatches });
          const batch = uuids.slice(i, i + BATCH_SIZE);
          await clientRef.current
            .from("Webattelier - orders")
            .update({ status: "Done" })
            .in("uuid", batch);
        }
      }
    } catch (e) {
      console.error("Bulk print failed:", e);
    } finally {
      setBulkPrinting(false);
      setBulkProgress({ step: "", current: 0, total: 0 });
    }
  }

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
    <Page fullWidth title="Webattelier">
      <TitleBar title="Webattelier" />
      <style>{`
        @keyframes cardSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .order-card-enter {
          animation: cardSlideIn 0.3s ease both;
        }
      `}</style>
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

        <Tabs tabs={STATUS_TABS} selected={selectedTab} onSelect={handleTabChange}>
          {status === "ready for print" && orders.length > 0 && (
            <Box paddingBlockStart="300" paddingBlockEnd="300">
              <InlineStack gap="300" blockAlign="center">
                <Button variant="primary" onClick={handleBulkPrint} loading={bulkPrinting}>
                  Print alle ({orders.length})
                </Button>
                {bulkPrinting && bulkProgress.step && (
                  <Text variant="bodySm" as="span" tone="subdued">
                    {bulkProgress.step === "fetch" && `PDF's ophalen... (${bulkProgress.current}/${bulkProgress.total})`}
                    {bulkProgress.step === "download" && `PDF's downloaden... (${bulkProgress.current}/${bulkProgress.total})`}
                    {bulkProgress.step === "merge" && "PDF's samenvoegen..."}
                    {bulkProgress.step === "status" && `Status bijwerken... (${bulkProgress.current}/${bulkProgress.total})`}
                  </Text>
                )}
              </InlineStack>
            </Box>
          )}
          {isLoading ? (
            <Box padding="800">
              <InlineStack align="center">
                <Spinner size="large" />
              </InlineStack>
            </Box>
          ) : orders.length === 0 ? (
            <Card>
              <Box padding="800">
                <BlockStack gap="200" inlineAlign="center">
                  <Text variant="headingMd" as="h3">
                    Geen orders gevonden
                  </Text>
                  <Text variant="bodySm" as="span" tone="subdued">
                    {search
                      ? `Geen resultaten voor "${search}"`
                      : status
                        ? `Geen orders met status "${STATUS_TABS[selectedTab].content}"`
                        : "Orders uit de Webattelier - orders tabel verschijnen hier."}
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          ) : (
            <BlockStack gap="400">
              {orders.map((order, i) => {
                const orderId = order.id != null ? String(order.id) : null;
                const lines = orderId ? linesByOrder[orderId] || [] : [];
                const highlighted = orderId ? changedIds.has(orderId) : false;
                const isReadOnly = status === "done" || status === "ready for print";
                const errorExit = orderId ? errorExitIds.has(orderId) : false;
                return (
                  <div key={orderId ?? i} className="order-card-enter" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                    <OrderCard order={order} lines={lines} shop={shop} highlighted={highlighted} errorExit={errorExit} readOnly={isReadOnly} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} />
                  </div>
                );
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
        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}
