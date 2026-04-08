import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import { useState, useCallback, useMemo } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Select,
  DataTable,
  Spinner,
  Banner,
  Box,
  Button,
  Modal,
} from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { queryLinesForMonth } from "../supabase.server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const MONTH_NAMES = [
  "Januari", "Februari", "Maart", "April", "Mei", "Juni",
  "Juli", "Augustus", "September", "Oktober", "November", "December",
];

function getMonthOptions() {
  return MONTH_NAMES.map((name, i) => ({
    label: name,
    value: String(i + 1),
  }));
}

function getYearOptions() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current; y >= current - 3; y--) {
    years.push({ label: String(y), value: String(y) });
  }
  return years;
}

function calculateMeters(line) {
  const cutLeft = Number(line.cutSizeLeftInMm) || 0;
  const cutRight = Number(line.cutSizeRightInMm) || 0;
  const totalMm = cutLeft + cutRight;
  const qty = Number(line.quantity) || 1;
  return (totalMm / 1000) * qty;
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);

  const now = new Date();
  const month = parseInt(url.searchParams.get("month") || String(now.getMonth() + 1));
  const year = parseInt(url.searchParams.get("year") || String(now.getFullYear()));

  try {
    const lines = await queryLinesForMonth(year, month);

    const fabricMap = {};
    let totalMeters = 0;

    for (const line of lines) {
      const fabric = line.productTitle || "Onbekend";
      const meters = calculateMeters(line);
      if (!fabricMap[fabric]) {
        fabricMap[fabric] = { meters: 0, lines: 0 };
      }
      fabricMap[fabric].meters += meters;
      fabricMap[fabric].lines += 1;
      totalMeters += meters;
    }

    const fabrics = Object.entries(fabricMap)
      .map(([name, { meters, lines }]) => ({ name, meters, lines }))
      .sort((a, b) => b.meters - a.meters);

    return json({
      fabrics,
      totalMeters,
      totalLines: lines.length,
      month,
      year,
      error: null,
    });
  } catch (e) {
    console.error("Failed to load fabric usage:", e.message);
    return json({
      fabrics: [],
      totalMeters: 0,
      totalLines: 0,
      month,
      year,
      error: e.message,
    });
  }
};

async function generatePdf(fabrics, totalMeters, totalLines, month, year) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const colWidths = [250, 70, 100, 75];
  const rowHeight = 20;

  function addPage() {
    const page = doc.addPage([pageWidth, pageHeight]);
    return { page, y: pageHeight - margin };
  }

  let { page, y } = addPage();

  // Title
  page.drawText(`Stofverbruik - ${MONTH_NAMES[month - 1]} ${year}`, {
    x: margin, y, size: 18, font: fontBold, color: rgb(0, 0, 0),
  });
  y -= 30;

  // Summary
  const summaryLines = [
    `Totaal meters: ${totalMeters.toFixed(2)} m`,
    `Aantal lijnen: ${totalLines}`,
    `Unieke producten: ${fabrics.length}`,
  ];
  for (const text of summaryLines) {
    page.drawText(text, { x: margin, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 16;
  }
  y -= 10;

  // Table header
  const headers = ["Product", "Lijnen", "Meters", "% totaal"];
  const headerColor = rgb(0.15, 0.15, 0.15);
  let xPos = margin;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i], { x: xPos, y, size: 9, font: fontBold, color: headerColor });
    xPos += colWidths[i];
  }
  y -= 6;

  // Header underline
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= rowHeight;

  // Table rows
  for (const f of fabrics) {
    if (y < margin + 40) {
      ({ page, y } = addPage());
    }

    const rowData = [
      f.name.length > 40 ? f.name.substring(0, 37) + "..." : f.name,
      String(f.lines),
      `${f.meters.toFixed(2)} m`,
      `${((f.meters / totalMeters) * 100).toFixed(1)}%`,
    ];

    xPos = margin;
    for (let i = 0; i < rowData.length; i++) {
      page.drawText(rowData[i], { x: xPos, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
      xPos += colWidths[i];
    }
    y -= rowHeight;
  }

  // Totals row
  if (y < margin + 40) {
    ({ page, y } = addPage());
  }
  y -= 4;
  page.drawLine({
    start: { x: margin, y: y + 14 },
    end: { x: pageWidth - margin, y: y + 14 },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });

  const totalsData = ["Totaal", String(totalLines), `${totalMeters.toFixed(2)} m`, "100%"];
  xPos = margin;
  for (let i = 0; i < totalsData.length; i++) {
    page.drawText(totalsData[i], { x: xPos, y, size: 9, font: fontBold, color: rgb(0, 0, 0) });
    xPos += colWidths[i];
  }

  return doc.save();
}

function getBarColor(index, total) {
  const darkest = [23, 78, 166];   // #174EA6
  const lightest = [173, 209, 249]; // #ADD1F9
  const t = total <= 1 ? 0 : index / (total - 1);
  const r = Math.round(darkest[0] + (lightest[0] - darkest[0]) * t);
  const g = Math.round(darkest[1] + (lightest[1] - darkest[1]) * t);
  const b = Math.round(darkest[2] + (lightest[2] - darkest[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function FabricChart({ fabrics, totalMeters }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const items = fabrics.slice(0, 15);
  const maxMeters = items.length > 0 ? items[0].meters : 0;

  return (
    <div style={{ overflowX: "auto", position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "6px",
          height: "360px",
          padding: "0 8px",
          minWidth: `${items.length * 56}px`,
        }}
      >
        {items.map((f, i) => {
          const pct = maxMeters > 0 ? (f.meters / maxMeters) * 100 : 0;
          const color = getBarColor(i, items.length);
          const isHovered = hoveredIndex === i;

          return (
            <div
              key={f.name}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{
                flex: 1,
                minWidth: "40px",
                maxWidth: "80px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                height: "100%",
                justifyContent: "flex-end",
              }}
            >
              {/* Value label on top */}
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: isHovered ? "#333" : "#888",
                  marginBottom: "4px",
                  whiteSpace: "nowrap",
                  transition: "color 0.2s ease",
                }}
              >
                {f.meters.toFixed(1)}m
              </div>
              {/* Bar */}
              <div
                style={{
                  width: "100%",
                  height: `${Math.max(pct, 2)}%`,
                  backgroundColor: color,
                  borderRadius: "4px 4px 0 0",
                  transition: "height 0.4s ease, opacity 0.2s ease",
                  opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1,
                  cursor: "default",
                }}
              />
            </div>
          );
        })}
      </div>
      {/* Tooltip bar below chart */}
      <div
        style={{
          borderTop: "1px solid #e1e3e5",
          minHeight: "36px",
          padding: "8px 8px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {hoveredIndex !== null && items[hoveredIndex] && (
          <div
            style={{
              fontSize: "13px",
              color: "#333",
              display: "flex",
              gap: "8px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontWeight: 600 }}>{items[hoveredIndex].name}</span>
            <span style={{ color: "#555" }}>
              {items[hoveredIndex].meters.toFixed(2)} m — {totalMeters > 0 ? ((items[hoveredIndex].meters / totalMeters) * 100).toFixed(1) : 0}%
            </span>
          </div>
        )}
      </div>
      {/* X-axis labels */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          padding: "4px 8px 0 8px",
          minWidth: `${items.length * 56}px`,
        }}
      >
        {items.map((f) => (
          <div
            key={f.name}
            style={{
              flex: 1,
              minWidth: "40px",
              maxWidth: "80px",
              fontSize: "10px",
              color: "#555",
              textAlign: "center",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={f.name}
          >
            {f.name}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FabricUsage() {
  const { fabrics, totalMeters, totalLines, month, year, error } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [infoOpen, setInfoOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const toggleInfo = useCallback(() => setInfoOpen((v) => !v), []);

  function handleMonthChange(value) {
    const params = new URLSearchParams(searchParams);
    params.set("month", value);
    setSearchParams(params);
  }

  function handleYearChange(value) {
    const params = new URLSearchParams(searchParams);
    params.set("year", value);
    setSearchParams(params);
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      const bytes = await generatePdf(fabrics, totalMeters, totalLines, month, year);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stofverbruik-${MONTH_NAMES[month - 1].toLowerCase()}-${year}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PDF export failed:", e);
    } finally {
      setExporting(false);
    }
  }

  const rows = fabrics.map((f) => [
    f.name,
    f.lines,
    `${f.meters.toFixed(2)} m`,
    `${((f.meters / totalMeters) * 100).toFixed(1)}%`,
  ]);

  return (
    <Page
      title="Stofverbruik per maand"
      primaryAction={{
        content: "Exporteer PDF",
        onAction: handleExportPdf,
        loading: exporting,
        disabled: fabrics.length === 0,
      }}
      secondaryActions={[
        {
          content: "Berekening info",
          icon: InfoIcon,
          onAction: toggleInfo,
        },
      ]}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical">
            <p>{error}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="400" blockAlign="center">
              <Box minWidth="160px">
                <Select
                  label="Maand"
                  options={getMonthOptions()}
                  value={String(month)}
                  onChange={handleMonthChange}
                />
              </Box>
              <Box minWidth="120px">
                <Select
                  label="Jaar"
                  options={getYearOptions()}
                  value={String(year)}
                  onChange={handleYearChange}
                />
              </Box>
              {isLoading && <Spinner size="small" />}
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="800">
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3">Totaal meters</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold">
                  {totalMeters.toFixed(2)} m
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3">Aantal lijnen</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold">
                  {totalLines}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3">Unieke producten</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold">
                  {fabrics.length}
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {fabrics.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingSm" as="h3">Top producten</Text>
              <FabricChart fabrics={fabrics} totalMeters={totalMeters} />
            </BlockStack>
          </Card>
        )}

        <Card>
          {fabrics.length === 0 ? (
            <Text variant="bodyMd" as="p" tone="subdued">
              Geen data gevonden voor {MONTH_NAMES[month - 1]} {year}.
            </Text>
          ) : (
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "numeric"]}
              headings={["Product", "Lijnen", "Meters", "% van totaal"]}
              rows={rows}
              totals={["", totalLines, `${totalMeters.toFixed(2)} m`, "100%"]}
              showTotalsInFooter
              sortable={[true, true, true, true]}
              defaultSortDirection="descending"
              initialSortColumnIndex={2}
            />
          )}
        </Card>
      </BlockStack>

      <Modal
        open={infoOpen}
        onClose={toggleInfo}
        title="Hoe wordt het stofverbruik berekend?"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">Databron</Text>
              <Text variant="bodyMd" as="p">
                Alle data komt uit de tabel "Webattelier - lines" in Supabase. Lijnen worden gefilterd op de <strong>created_at</strong> datum van de geselecteerde maand.
              </Text>
            </BlockStack>

            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">Meters per lijn</Text>
              <Text variant="bodyMd" as="p">
                Per orderlijn wordt het stofverbruik als volgt berekend:
              </Text>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  (cutSizeLeftInMm + cutSizeRightInMm) / 1000 x quantity = meters
                </Text>
              </Box>
              <Text variant="bodyMd" as="p">
                De knipmaat links en rechts (in millimeters) worden opgeteld, omgerekend naar meters, en vermenigvuldigd met het aantal (quantity) van de lijn.
              </Text>
            </BlockStack>

            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">Groepering</Text>
              <Text variant="bodyMd" as="p">
                Lijnen worden gegroepeerd op <strong>productTitle</strong> (productnaam). Alle lijnen met dezelfde productnaam worden samengeteld tot een totaal aantal meters.
              </Text>
            </BlockStack>

            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">Kolommen in de tabel</Text>
              <Text variant="bodyMd" as="p">
                <strong>Product</strong> — De productnaam (productTitle) waarop gegroepeerd wordt.
              </Text>
              <Text variant="bodyMd" as="p">
                <strong>Lijnen</strong> — Het aantal orderlijnen voor dit product in de geselecteerde maand.
              </Text>
              <Text variant="bodyMd" as="p">
                <strong>Meters</strong> — Het totaal aantal meters stof verbruikt voor dit product.
              </Text>
              <Text variant="bodyMd" as="p">
                <strong>% van totaal</strong> — Het percentage van dit product ten opzichte van het totale stofverbruik van de maand.
              </Text>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
