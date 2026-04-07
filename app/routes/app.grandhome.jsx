import { useLoaderData, useSearchParams, useRevalidator, useNavigation } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useState, useCallback, useEffect, useRef } from "react";
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
  Icon,
  Button,
  Collapsible,
  Divider,
  Modal,
} from "@shopify/polaris";
import { SearchIcon, ChevronDownIcon, ChevronUpIcon, ExportIcon, CalendarIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { queryGrandHome } from "../supabase.server";

const PAGE_SIZE = 20;

/* ── Loader ── */

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("q") || "";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count } = await queryGrandHome({ from, to, search });
    return json({
      orders: data,
      total: count,
      page,
      search,
      error: null,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  } catch (e) {
    console.error("Failed to load grandhome orders:", e.message);
    return json({
      orders: [],
      total: 0,
      page,
      search,
      error: e.message,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  }
};

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

    let channel = client.channel("realtime-grandhome");
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

/* ── Helpers ── */

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("nl-NL", {
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

function formatXml(xml) {
  if (!xml) return "";
  let formatted = "";
  let indent = 0;
  const parts = xml.replace(/(>)(<)/g, "$1\n$2").split("\n");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("</")) indent = Math.max(0, indent - 1);
    formatted += "  ".repeat(indent) + trimmed + "\n";
    if (trimmed.startsWith("<") && !trimmed.startsWith("</") && !trimmed.startsWith("<?") && !trimmed.endsWith("/>") && !/<\/[^>]+>$/.test(trimmed)) {
      indent++;
    }
  }
  return formatted.trim();
}

/* ── Order card ── */

function GrandHomeCard({ order }) {
  const [open, setOpen] = useState(false);
  const hasXml = !!order.orderxml;

  return (
    <Card padding="0">
      <Box padding="400">
        <div
          onClick={() => hasXml && setOpen((o) => !o)}
          style={{ cursor: hasXml ? "pointer" : "default", userSelect: "none" }}
        >
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              {hasXml && (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
                </div>
              )}
              <Text variant="headingMd" as="h3" fontWeight="bold">
                {order.ordernumber || "—"}
              </Text>
              {hasXml ? (
                <Badge tone="info" size="small">XML</Badge>
              ) : (
                <Badge tone="attention" size="small">Geen XML</Badge>
              )}
            </InlineStack>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text variant="bodySm" as="span" tone="subdued">
                {formatDate(order.created_at)}
              </Text>
              {hasXml && (
                <Button
                  size="micro"
                  icon={ExportIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    const blob = new Blob([order.orderxml], { type: "application/xml" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${order.ordernumber || "order"}.xml`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  accessibilityLabel="Download XML"
                >
                  Download XML
                </Button>
              )}
            </InlineStack>
          </InlineStack>
        </div>
      </Box>

      <Collapsible open={open} id={`gh-${order.id}`}>
        <Divider />
        <Box padding="400" paddingBlockStart="300">
          <div style={{
            backgroundColor: "#f7f7f8",
            borderRadius: "8px",
            padding: "12px 16px",
            overflow: "auto",
            maxHeight: "500px",
          }}>
            <pre style={{
              margin: 0,
              fontSize: "12px",
              lineHeight: "1.5",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              color: "#303030",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {formatXml(order.orderxml)}
            </pre>
          </div>
        </Box>
      </Collapsible>
    </Card>
  );
}

/* ── Date range PDF export ── */

async function fetchOrdersByDateRange(supabaseUrl, supabaseKey, dateFrom, dateTo) {
  const client = createClient(supabaseUrl, supabaseKey);
  const from = new Date(dateFrom);
  from.setHours(0, 0, 0, 0);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  const { data, error } = await client
    .from("grandhome")
    .select("id, ordernumber, created_at")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

function formatDateShort(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("nl-NL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function generateDateRangePdf(orders, dateFrom, dateTo) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  function safe(str) {
    return String(str).replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
  }

  const W = 595;
  const H = 842;
  const margin = 48;
  const contentW = W - margin * 2;
  let page = pdf.addPage([W, H]);
  let y;

  // Voordeelgordijnen brand colors
  const c = {
    primary: rgb(192 / 255, 43 / 255, 43 / 255),     // #C02B2B — brand red
    primaryDark: rgb(150 / 255, 30 / 255, 30 / 255),  // darker red for text on white
    green: rgb(52 / 255, 125 / 255, 84 / 255),        // #347D54 — accent green
    yellow: rgb(252 / 255, 162 / 255, 26 / 255),      // #FCA21A — accent yellow
    dark: rgb(20 / 255, 20 / 255, 20 / 255),          // #141414 — body text
    mid: rgb(84 / 255, 84 / 255, 84 / 255),           // #545454
    light: rgb(140 / 255, 140 / 255, 140 / 255),      // #8C8C8C
    line: rgb(0.85, 0.85, 0.88),
    bg: rgb(0.965, 0.965, 0.97),
    white: rgb(1, 1, 1),
  };

  function ensureSpace(needed) {
    if (y - needed < margin) {
      page = pdf.addPage([W, H]);
      y = H - margin;
    }
  }

  function draw(str, x, yPos, { size = 9.5, bold = false, color = c.dark, maxWidth } = {}) {
    const f = bold ? fontBold : font;
    let t = safe(str);
    if (maxWidth) {
      while (f.widthOfTextAtSize(t, size) > maxWidth && t.length > 3) {
        t = t.slice(0, -4) + "...";
      }
    }
    page.drawText(t, { x, y: yPos, size, font: f, color });
  }

  function drawRect(x, yPos, w, h, color) {
    page.drawRectangle({ x, y: yPos, width: w, height: h, color });
  }

  // ── Header bar (brand red) ──
  const headerH = 52;
  drawRect(0, H - headerH, W, headerH, c.primary);
  draw("VOORDEEL", margin + 6, H - 22, { size: 10, bold: true, color: c.white });
  draw("GORDIJNEN", margin + 6, H - 34, { size: 10, bold: true, color: c.white });
  draw("Grand Home - Order Rapport", margin + 80, H - 30, { size: 16, bold: true, color: c.white });
  const dateStr = safe(formatDateShort(dateFrom) + " t/m " + formatDateShort(dateTo));
  const dateW = font.widthOfTextAtSize(dateStr, 9);
  draw(dateStr, W - margin - dateW, H - 28, { size: 9, color: rgb(1, 0.85, 0.85) });
  y = H - headerH - 20;

  // ── Stats row ──
  const statsH = 48;
  drawRect(margin, y - statsH, contentW, statsH, c.bg);
  const fromStr = formatDateShort(dateFrom);
  const toStr = formatDateShort(dateTo);

  // Total count — big number
  draw(String(orders.length), margin + 20, y - 20, { size: 22, bold: true, color: c.primary });
  draw("orders in periode", margin + 20 + fontBold.widthOfTextAtSize(String(orders.length), 22) + 8, y - 16, { size: 10, color: c.mid });
  draw(`${fromStr}  -  ${toStr}`, margin + 20 + fontBold.widthOfTextAtSize(String(orders.length), 22) + 8, y - 30, { size: 9, color: c.light });
  y -= statsH + 16;

  // ── Divider ──
  page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.5, color: c.line });
  y -= 20;

  // ── Table header ──
  const colNum = margin + 8;
  const colOrder = margin + 50;
  const colDate = W - margin - 100;

  drawRect(margin, y - 4, contentW, 18, c.primary);
  draw("#", colNum, y, { size: 8, bold: true, color: c.white });
  draw("ORDERNUMMER", colOrder, y, { size: 8, bold: true, color: c.white });
  draw("DATUM", colDate, y, { size: 8, bold: true, color: c.white });
  y -= 22;

  // ── Rows ──
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const rowH = 22;
    ensureSpace(rowH + 4);

    if (i % 2 === 0) {
      drawRect(margin, y - 6, contentW, rowH, c.bg);
    }

    draw(String(i + 1), colNum, y, { size: 9, color: c.light });
    draw(order.ordernumber || "---", colOrder, y, { size: 11, bold: true, color: c.primaryDark });
    draw(formatDateShort(order.created_at), colDate, y, { size: 9, color: c.mid });
    y -= rowH;
  }

  // ── Footer on every page ──
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    // Bottom line
    p.drawLine({ start: { x: margin, y: 42 }, end: { x: W - margin, y: 42 }, thickness: 0.5, color: c.line });
    const ft = `Pagina ${i + 1} van ${pages.length}`;
    const ftw = font.widthOfTextAtSize(ft, 7);
    p.drawText(ft, { x: W - margin - ftw, y: 28, size: 7, font, color: c.light });
    p.drawText(safe("Voordeelgordijnen  |  Grand Home"), { x: margin, y: 28, size: 7, font, color: c.light });
  });

  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grandhome-${dateFrom}-${dateTo}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportModal({ open, onClose, supabaseUrl, supabaseKey }) {
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [loading, setLoading] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [preview, setPreview] = useState(null);

  async function handleExport() {
    setLoading(true);
    setExportError(null);
    try {
      const orders = await fetchOrdersByDateRange(supabaseUrl, supabaseKey, dateFrom, dateTo);
      if (orders.length === 0) {
        setExportError("Geen orders gevonden in deze periode.");
        setLoading(false);
        return;
      }
      await generateDateRangePdf(orders, dateFrom, dateTo);
      onClose();
    } catch (e) {
      setExportError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview() {
    setLoading(true);
    setExportError(null);
    setPreview(null);
    try {
      const orders = await fetchOrdersByDateRange(supabaseUrl, supabaseKey, dateFrom, dateTo);
      setPreview(orders);
    } catch (e) {
      setExportError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exporteer orders als PDF"
      primaryAction={{
        content: loading ? "Bezig..." : "Download PDF",
        onAction: handleExport,
        disabled: loading,
      }}
      secondaryActions={[
        {
          content: "Voorbeeld",
          onAction: handlePreview,
          disabled: loading,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            Selecteer een periode om een PDF rapport te genereren van alle Grand Home orders.
          </Text>
          <InlineStack gap="300" blockAlign="end">
            <Box minWidth="200px">
              <TextField
                label="Van"
                type="date"
                value={dateFrom}
                onChange={setDateFrom}
                autoComplete="off"
              />
            </Box>
            <Box minWidth="200px">
              <TextField
                label="Tot en met"
                type="date"
                value={dateTo}
                onChange={setDateTo}
                autoComplete="off"
              />
            </Box>
          </InlineStack>

          {exportError && (
            <Banner tone="critical">
              <p>{exportError}</p>
            </Banner>
          )}

          {preview && (
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">
                {preview.length} order{preview.length !== 1 ? "s" : ""} gevonden
              </Text>
              <Box
                paddingBlockStart="200"
                paddingBlockEnd="200"
                paddingInlineStart="300"
                paddingInlineEnd="300"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <BlockStack gap="100">
                  {preview.slice(0, 20).map((o) => (
                    <InlineStack key={o.id} align="space-between">
                      <Text variant="bodySm" as="span" fontWeight="semibold">{o.ordernumber}</Text>
                      <Text variant="bodySm" as="span" tone="subdued">{formatDateShort(o.created_at)}</Text>
                    </InlineStack>
                  ))}
                  {preview.length > 20 && (
                    <Text variant="bodySm" as="p" tone="subdued">
                      ... en {preview.length - 20} meer
                    </Text>
                  )}
                </BlockStack>
              </Box>
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/* ── Page ── */

export default function GrandHome() {
  const { orders, total, page, search, error, supabaseUrl, supabaseKey } = useLoaderData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(search || "");
  const [exportOpen, setExportOpen] = useState(false);

  const handleRealtimeEvent = useCallback(() => {
    if (revalidator.state === "idle") {
      revalidator.revalidate();
    }
  }, [revalidator]);

  const realtimeStatus = useSupabaseRealtime(
    supabaseUrl,
    supabaseKey,
    ["grandhome"],
    handleRealtimeEvent,
  );

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
      <TitleBar title="Grand Home" />
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        supabaseUrl={supabaseUrl}
        supabaseKey={supabaseKey}
      />
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text variant="headingXl" as="h1">Grand Home</Text>
            <Text variant="bodyMd" as="p" tone="subdued">
              Overzicht van alle Grand Home orders en hun XML data
            </Text>
          </BlockStack>
          <Button
            icon={CalendarIcon}
            onClick={() => setExportOpen(true)}
          >
            Exporteer periode
          </Button>
        </InlineStack>

        <InlineStack align="space-between" blockAlign="end">
          <Box minWidth="400px" maxWidth="600px">
            <div onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}>
              <TextField
                placeholder="Zoek op ordernummer"
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
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodySm" as="span" tone="subdued">
              {total} orders
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
                <Text variant="headingMd" as="h3">Geen orders gevonden</Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  {search
                    ? `Geen resultaten voor "${search}"`
                    : "Orders verschijnen hier zodra ze worden toegevoegd."}
                </Text>
              </BlockStack>
            </Box>
          </Card>
        ) : (
          <BlockStack gap="300">
            {orders.map((order) => (
              <GrandHomeCard key={order.id} order={order} />
            ))}
          </BlockStack>
        )}

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
