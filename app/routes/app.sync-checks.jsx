import { useLoaderData, useSearchParams, useRevalidator, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/node";
import { useState, useEffect } from "react";
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
  List,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon, InfoIcon, ExportIcon } from "@shopify/polaris-icons";
import { TitleBar, Modal, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { querySyncChecks, getSyncCheck, updateSyncCheckReport } from "../supabase.server";

/* ── Loader / Action ── */

const PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const date = url.searchParams.get("date") || "";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count } = await querySyncChecks({ from, to, date });
    return json({
      checks: data, total: count, page, date, error: null, shop,
    });
  } catch (e) {
    console.error("Failed to load sync checks:", e.message);
    return json({
      checks: [], total: 0, page, date, error: e.message, shop,
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

/* ── PDF export ── */

async function exportSyncCheckPdf(report, date) {
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
    primaryDark: rgb(150 / 255, 30 / 255, 30 / 255),
    dark: rgb(20 / 255, 20 / 255, 20 / 255),          // #141414
    mid: rgb(84 / 255, 84 / 255, 84 / 255),           // #545454
    light: rgb(140 / 255, 140 / 255, 140 / 255),
    line: rgb(0.85, 0.85, 0.88),
    bg: rgb(0.965, 0.965, 0.97),
    red: rgb(192 / 255, 43 / 255, 43 / 255),
    redBg: rgb(1, 0.94, 0.93),
    green: rgb(52 / 255, 125 / 255, 84 / 255),        // #347D54
    greenBg: rgb(0.92, 0.97, 0.92),
    orange: rgb(252 / 255, 162 / 255, 26 / 255),      // #FCA21A
    orangeBg: rgb(1, 0.96, 0.91),
    white: rgb(1, 1, 1),
  };

  function newPage() {
    page = pdf.addPage([W, H]);
    y = H - margin;
  }

  function ensureSpace(needed) {
    if (y - needed < margin) newPage();
  }

  // Draw text at absolute position — does NOT move y
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

  function drawDivider() {
    page.drawLine({
      start: { x: margin, y },
      end: { x: W - margin, y },
      thickness: 0.5,
      color: c.line,
    });
    y -= 16;
  }

  function pill(label, px, py, { bg, fg, size = 7.5 } = {}) {
    const tw = fontBold.widthOfTextAtSize(safe(label), size);
    const pw = tw + 14;
    const ph = size + 10;
    drawRect(px, py - 3, pw, ph, bg);
    draw(label, px + 7, py + 1, { size, bold: true, color: fg });
    return pw;
  }

  // ── Header bar (brand red) ──
  const headerH = 52;
  drawRect(0, H - headerH, W, headerH, c.primary);
  draw("VOORDEEL", margin + 6, H - 22, { size: 10, bold: true, color: c.white });
  draw("GORDIJNEN", margin + 6, H - 34, { size: 10, bold: true, color: c.white });
  draw("Sync Check Rapport", margin + 80, H - 30, { size: 16, bold: true, color: c.white });
  const dateStr = safe(date);
  const dateW = font.widthOfTextAtSize(dateStr, 9);
  draw(dateStr, W - margin - dateW, H - 28, { size: 9, color: rgb(1, 0.85, 0.85) });
  y = H - headerH - 20;

  // ── Data ──
  const failures = report.failures || [];
  const possibleWaIssues = report.possibleWaIssues || [];
  const noTag = failures.filter((f) => f.category === "no_tag");
  const supabaseIssues = failures.filter((f) => f.category === "supabase");
  const totalIssues = failures.length + possibleWaIssues.length;
  const totalUnresolved = [...failures, ...possibleWaIssues].filter((f) => !f.resolved).length;
  const totalResolved = totalIssues - totalUnresolved;

  // ── Stats row ──
  const statsH = 56;
  drawRect(margin, y - statsH, contentW, statsH, c.bg);

  const statItems = [
    { label: "Gecontroleerd", value: String(report.totalChecked || 0), color: c.dark },
    { label: "Issues", value: String(totalIssues), color: c.dark },
    { label: "Open", value: String(totalUnresolved), color: totalUnresolved > 0 ? c.primary : c.dark },
    { label: "Afgevinkt", value: String(totalResolved), color: totalResolved > 0 ? c.green : c.dark },
  ];
  const colW = contentW / statItems.length;
  statItems.forEach((s, i) => {
    const sx = margin + i * colW + 16;
    draw(s.value, sx, y - 22, { size: 20, bold: true, color: s.color });
    draw(s.label, sx, y - 36, { size: 8, color: c.light });
  });
  y -= statsH + 14;

  // ── Category pills ──
  let px = margin;
  if (noTag.length > 0) {
    px += pill(`${noTag.length} missende tag`, px, y, { bg: c.orangeBg, fg: c.orange }) + 8;
  }
  if (supabaseIssues.length > 0) {
    px += pill(`${supabaseIssues.length} missend in Supabase`, px, y, { bg: c.redBg, fg: c.red }) + 8;
  }
  if (possibleWaIssues.length > 0) {
    pill(`${possibleWaIssues.length} mogelijke WA issues`, px, y, { bg: c.orangeBg, fg: c.orange });
  }
  y -= 28;
  drawDivider();

  // ── Issue sections ──
  const colOrder = margin + 8;
  const colIssue = margin + 105;
  const colStatus = W - margin - 65;

  function drawIssueSection(title, items, sectionColor) {
    if (items.length === 0) return;
    ensureSpace(80);

    // Section header
    drawRect(margin, y - 3, 3, 15, sectionColor);
    draw(title, margin + 12, y, { size: 11, bold: true });
    y -= 26;

    // Column headers
    draw("ORDER", colOrder, y, { size: 7, bold: true, color: c.light });
    draw("ISSUE", colIssue, y, { size: 7, bold: true, color: c.light });
    draw("STATUS", colStatus, y, { size: 7, bold: true, color: c.light });
    y -= 10;
    page.drawLine({
      start: { x: margin, y: y + 2 },
      end: { x: W - margin, y: y + 2 },
      thickness: 0.3,
      color: c.line,
    });
    y -= 6;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const hasMeta = item.createdAt || item.destinations?.length || item.tags?.length;
      const rowH = hasMeta ? 42 : 28;
      ensureSpace(rowH + 4);

      // Alternating row bg
      if (i % 2 === 0) {
        drawRect(margin, y - rowH + 10, contentW, rowH, c.bg);
      }

      // Order number
      const orderNum = (item.orderName || "?").replace("#", "");
      draw(`#${orderNum}`, colOrder, y, { size: 13, bold: true, color: c.primaryDark });

      // Issue on same line, right of order
      if (item.issue) {
        draw(item.issue, colIssue, y + 1, { size: 8.5, color: c.mid, maxWidth: colStatus - colIssue - 12 });
      }

      // Status pill
      if (item.resolved) {
        pill("OPGELOST", colStatus, y - 1, { bg: c.greenBg, fg: c.green, size: 6.5 });
      } else {
        pill("OPEN", colStatus + 10, y - 1, { bg: c.redBg, fg: c.red, size: 6.5 });
      }

      // Meta line below
      if (hasMeta) {
        const meta = [
          item.createdAt && formatDate(item.createdAt),
          item.destinations?.length && `-> ${item.destinations.join(", ")}`,
          item.tags?.length && item.tags.join(", "),
        ].filter(Boolean).join("  |  ");
        draw(meta, colOrder, y - 16, { size: 7, color: c.light, maxWidth: contentW - 16 });
      }

      y -= rowH;
    }
    y -= 10;
    drawDivider();
  }

  drawIssueSection("Missende Completed tag", noTag, c.orange);
  drawIssueSection("Missende Supabase records", supabaseIssues, c.red);
  drawIssueSection("Mogelijke WA problemen", possibleWaIssues, c.orange);

  // ── Footer on every page ──
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: margin, y: 42 }, end: { x: W - margin, y: 42 }, thickness: 0.5, color: c.line });
    const ft = `Pagina ${i + 1} van ${pages.length}`;
    const ftw = font.widthOfTextAtSize(ft, 7);
    p.drawText(ft, { x: W - margin - ftw, y: 28, size: 7, font, color: c.light });
    p.drawText("Voordeelgordijnen  |  Sync Check", { x: margin, y: 28, size: 7, font, color: c.light });
  });

  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sync-check-${date.replace(/[^0-9]/g, "-")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
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
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text variant="bodySm" as="span" tone="subdued">
                {report.totalChecked} orders
              </Text>
              {hasIssues && (
                <Button
                  size="micro"
                  icon={ExportIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    exportSyncCheckPdf(report, date);
                  }}
                  accessibilityLabel="Export als PDF"
                >
                  Export PDF
                </Button>
              )}
            </InlineStack>
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

/* ── Info modal (rendered inside Page) ── */

/* ── Page ── */

async function exportAllSyncChecksPdf(checks, dateLabel) {
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

  const c = {
    primary: rgb(192 / 255, 43 / 255, 43 / 255),
    primaryDark: rgb(150 / 255, 30 / 255, 30 / 255),
    dark: rgb(20 / 255, 20 / 255, 20 / 255),
    mid: rgb(84 / 255, 84 / 255, 84 / 255),
    light: rgb(140 / 255, 140 / 255, 140 / 255),
    line: rgb(0.85, 0.85, 0.88),
    bg: rgb(0.965, 0.965, 0.97),
    red: rgb(192 / 255, 43 / 255, 43 / 255),
    redBg: rgb(1, 0.94, 0.93),
    green: rgb(52 / 255, 125 / 255, 84 / 255),
    greenBg: rgb(0.92, 0.97, 0.92),
    orange: rgb(252 / 255, 162 / 255, 26 / 255),
    orangeBg: rgb(1, 0.96, 0.91),
    white: rgb(1, 1, 1),
  };

  function newPage() {
    page = pdf.addPage([W, H]);
    y = H - margin;
  }

  function ensureSpace(needed) {
    if (y - needed < margin) newPage();
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

  function pill(label, px, py, { bg, fg, size = 7.5 } = {}) {
    const tw = fontBold.widthOfTextAtSize(safe(label), size);
    const pw = tw + 14;
    const ph = size + 10;
    drawRect(px, py - 3, pw, ph, bg);
    draw(label, px + 7, py + 1, { size, bold: true, color: fg });
    return pw;
  }

  // Header
  const headerH = 52;
  drawRect(0, H - headerH, W, headerH, c.primary);
  draw("VOORDEEL", margin + 6, H - 22, { size: 10, bold: true, color: c.white });
  draw("GORDIJNEN", margin + 6, H - 34, { size: 10, bold: true, color: c.white });
  draw(`Sync Checks - ${safe(dateLabel)}`, margin + 80, H - 30, { size: 16, bold: true, color: c.white });
  y = H - headerH - 20;

  // Deduplicate issues across all checks — keep the latest status per order+category
  const issueMap = new Map(); // key: "orderName|category" -> item
  for (const check of checks) {
    const report = typeof check.report === "string" ? JSON.parse(check.report) : (check.report || {});
    for (const f of (report.failures || [])) {
      const key = `${f.orderName}|${f.category || "unknown"}`;
      const existing = issueMap.get(key);
      if (!existing || f.resolved) issueMap.set(key, { ...f, section: f.category === "no_tag" ? "Tag" : "Supabase" });
    }
    for (const f of (report.possibleWaIssues || [])) {
      const key = `${f.orderName}|wa`;
      const existing = issueMap.get(key);
      if (!existing || f.resolved) issueMap.set(key, { ...f, section: "WA" });
    }
  }

  const dedupedItems = [...issueMap.values()];
  const totalIssues = dedupedItems.length;
  const totalUnresolved = dedupedItems.filter((f) => !f.resolved).length;
  const totalResolved = totalIssues - totalUnresolved;

  const statsH = 56;
  drawRect(margin, y - statsH, contentW, statsH, c.bg);
  const statItems = [
    { label: "Checks", value: String(checks.length), color: c.dark },
    { label: "Unieke issues", value: String(totalIssues), color: c.dark },
    { label: "Open", value: String(totalUnresolved), color: totalUnresolved > 0 ? c.primary : c.dark },
    { label: "Afgevinkt", value: String(totalResolved), color: totalResolved > 0 ? c.green : c.dark },
  ];
  const colW = contentW / statItems.length;
  statItems.forEach((s, i) => {
    const sx = margin + i * colW + 12;
    draw(s.value, sx, y - 22, { size: 18, bold: true, color: s.color });
    draw(s.label, sx, y - 36, { size: 8, color: c.light });
  });
  y -= statsH + 14;

  // Group by section
  const colOrder = margin + 8;
  const colIssue = margin + 105;
  const colStatus = W - margin - 65;

  const sections = [
    { key: "Tag", title: "Missende Completed tag", sectionColor: c.orange },
    { key: "Supabase", title: "Missende Supabase records", sectionColor: c.red },
    { key: "WA", title: "Mogelijke WA problemen", sectionColor: c.orange },
  ];

  for (const { key, title, sectionColor } of sections) {
    const items = dedupedItems.filter((i) => i.section === key);
    if (items.length === 0) continue;

    ensureSpace(60);

    // Section header
    drawRect(margin, y - 3, 3, 15, sectionColor);
    draw(title, margin + 12, y, { size: 11, bold: true });
    y -= 26;

    // Column headers
    draw("ORDER", colOrder, y, { size: 7, bold: true, color: c.light });
    draw("ISSUE", colIssue, y, { size: 7, bold: true, color: c.light });
    draw("STATUS", colStatus, y, { size: 7, bold: true, color: c.light });
    y -= 10;
    page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: W - margin, y: y + 2 }, thickness: 0.3, color: c.line });
    y -= 6;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowH = 28;
      ensureSpace(rowH + 4);

      if (i % 2 === 0) drawRect(margin, y - rowH + 10, contentW, rowH, c.bg);

      const orderNum = (item.orderName || "?").replace("#", "");
      draw(`#${orderNum}`, colOrder, y, { size: 13, bold: true, color: c.primaryDark });

      if (item.issue) {
        draw(item.issue, colIssue, y + 1, { size: 8.5, color: c.mid, maxWidth: colStatus - colIssue - 12 });
      }

      if (item.resolved) {
        pill("OPGELOST", colStatus, y - 1, { bg: c.greenBg, fg: c.green, size: 6.5 });
      } else {
        pill("OPEN", colStatus + 10, y - 1, { bg: c.redBg, fg: c.red, size: 6.5 });
      }

      y -= rowH;
    }
    y -= 10;
    page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.5, color: c.line });
    y -= 16;
  }

  // Footer
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: margin, y: 42 }, end: { x: W - margin, y: 42 }, thickness: 0.5, color: c.line });
    const ft = `Pagina ${i + 1} van ${pages.length}`;
    const ftw = font.widthOfTextAtSize(ft, 7);
    p.drawText(ft, { x: W - margin - ftw, y: 28, size: 7, font, color: c.light });
    p.drawText("Voordeelgordijnen  |  Sync Checks", { x: margin, y: 28, size: 7, font, color: c.light });
  });

  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sync-checks-${dateLabel}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SyncChecks() {
  const { checks, total, page, date, error, shop } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [exporting, setExporting] = useState(false);
  const shopify = useAppBridge();

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 60_000);
    return () => clearInterval(interval);
  }, [revalidator]);

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

  function handleDateChange(newDate) {
    const params = new URLSearchParams(searchParams);
    if (newDate) {
      params.set("date", newDate);
    } else {
      params.delete("date");
    }
    params.delete("page");
    setSearchParams(params);
  }

  async function handleExportAll() {
    if (!date) return;
    setExporting(true);
    try {
      const res = await fetch(`/app/sync-checks/export?date=${date}`);
      const allChecks = await res.json();
      await exportAllSyncChecksPdf(allChecks, date);
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page fullWidth title="Sync Checks">
      <TitleBar title="Sync Checks" />

      <Modal id="sync-check-info-modal" variant="large">
        <Box padding="400">
          <BlockStack gap="400">
            <Text variant="headingSm" as="h3">Overzicht</Text>
            <Text as="p">
              De Sync Check is een geautomatiseerde workflow (n8n) die <strong>elk uur</strong> draait.
              Het doel is om te controleren of nieuwe Shopify-orders correct zijn verwerkt door alle
              gekoppelde systemen. Elke controle kijkt naar orders van de <strong>afgelopen 2 uur</strong>.
            </Text>

            <Text variant="headingSm" as="h3">Stap 1: Orders ophalen uit Shopify</Text>
            <Text as="p">
              Alle orders die in de afgelopen 2 uur zijn aangemaakt worden opgehaald via de Shopify
              GraphQL API, inclusief tags, line items en productie-bestemming (metafield).
            </Text>

            <Text variant="headingSm" as="h3">Stap 2: Orders categoriseren</Text>
            <Text as="p">
              Elke order wordt ingedeeld op basis van tags en bestemming:
            </Text>
            <List type="bullet">
              <List.Item>
                <strong>Geen "Completed" tag</strong> — Orders ouder dan 30 minuten die nog geen
                "Completed" tag hebben.
              </List.Item>
              <List.Item>
                <strong>Kleurstalen (KL)</strong> — Orders met de tag "kleurstaal". Moeten een record
                hebben in de Kleurstalen tabel in Supabase.
              </List.Item>
              <List.Item>
                <strong>NE-Distriservice (NE)</strong> — Orders met de tag "ne-distriservice". Moeten
                een record hebben in de nedistri tabel.
              </List.Item>
              <List.Item>
                <strong>Webattelier (WA)</strong> — Orders met productie-bestemming "WA" (geen losse stof).
                Moeten een record hebben in de Webattelier tabel.
              </List.Item>
              <List.Item>
                <strong>Overig (GH, VDG, DEC, HKL)</strong> — Geen Supabase-check nodig.
              </List.Item>
            </List>
            <Text as="p" tone="subdued">
              Orders met "vooraf betalen per factuur" worden overgeslagen.
            </Text>

            <Text variant="headingSm" as="h3">Stap 3: Supabase-records controleren</Text>
            <Text as="p">
              Voor elke categorie worden de Supabase-tabellen gecontroleerd. Ontbrekende records worden
              als probleem gerapporteerd.
            </Text>

            <Text variant="headingSm" as="h3">Stap 4: Rapport opslaan</Text>
            <Text as="p">
              Het rapport wordt opgeslagen in de sync_checks tabel. Bij problemen wordt optioneel een
              Slack-melding verstuurd.
            </Text>

            <Divider />

            <Text variant="headingSm" as="h3">Wat je ziet op deze pagina</Text>
            <Text as="p">
              Elke kaart is een sync check (een uur). Klik op een kaart om details te zien.
              Issues zijn onderverdeeld in: Missende Completed tag (oranje), Missende Supabase records
              (rood), en Mogelijke WA problemen (geel). Elk issue heeft een checkbox om het als opgelost
              te markeren. Ordernummers linken naar Shopify Admin.
            </Text>
          </BlockStack>
        </Box>
        <TitleBar title="Hoe werkt de Sync Check?">
          <button onClick={() => shopify.modal.hide("sync-check-info-modal")}>Sluiten</button>
        </TitleBar>
      </Modal>

      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodySm" as="span" tone="subdued">
              Automatische sync controles (elk uur)
            </Text>
            <Button
              variant="plain"
              icon={InfoIcon}
              onClick={() => shopify.modal.show("sync-check-info-modal")}
              accessibilityLabel="Uitleg sync checks"
            />
          </InlineStack>
          <Text variant="bodySm" as="span" tone="subdued">
            {total} checks
          </Text>
        </InlineStack>

        <InlineStack gap="300" blockAlign="center" align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <input
              type="date"
              value={date || ""}
              onChange={(e) => handleDateChange(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: "1px solid var(--p-color-border, #c9cccf)",
                background: "var(--p-color-bg-surface, #fff)",
                fontSize: "13px",
                fontFamily: "inherit",
                color: date ? "inherit" : "var(--p-color-text-subdued, #6d7175)",
                cursor: "pointer",
                outline: "none",
              }}
            />
            {date && (
              <Button
                variant="plain"
                onClick={() => handleDateChange("")}
                accessibilityLabel="Filter wissen"
              >
                Wissen
              </Button>
            )}
          </InlineStack>
          {date && (
            <Button
              icon={ExportIcon}
              onClick={handleExportAll}
              loading={exporting}
            >
              Export alles ({date})
            </Button>
          )}
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
