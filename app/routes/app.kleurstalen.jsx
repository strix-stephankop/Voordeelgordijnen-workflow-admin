import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Button,
  Tabs,
  Banner,
  Divider,
  Spinner,
  EmptyState,
  TextField,
  Icon,
  ProgressBar,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import supabase from "../supabase.server";

const PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "ready";
  const limit = parseInt(url.searchParams.get("limit") || PAGE_SIZE, 10);
  const search = url.searchParams.get("q") || "";

  const status = tab === "done" ? "Done" : "Ready for Print";

  let query = supabase
    .from("Kleurstalen")
    .select("*", { count: "exact" })
    .eq("status", status)
    .order("createdAt", { ascending: false })
    .range(0, limit - 1);

  if (search) {
    const isNumeric = /^\d+$/.test(search.trim());
    if (isNumeric) {
      query = query.eq("orderNumber", parseInt(search.trim(), 10));
    } else {
      query = query.ilike("customerName", `%${search.trim()}%`);
    }
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("Failed to fetch kleurstalen:", error.message);
    return json({ items: [], count: 0, tab, limit, search, error: error.message, printUrls: [] });
  }

  // Fetch all pdf_urls + ids for "Ready for Print" items (used by local print-all)
  let printItems = [];
  if (tab !== "done") {
    const { data: urlData } = await supabase
      .from("Kleurstalen")
      .select("id, pdf_url, orderNumber")
      .eq("status", "Ready for Print")
      .not("pdf_url", "is", null)
      .order("orderNumber", { ascending: false });
    printItems = (urlData || []).filter((r) => r.pdf_url);
  }

  return json({
    items: data ?? [],
    count,
    tab,
    limit,
    search,
    error: null,
    printItems,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY,
  });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const body = await request.json();

  if (body.action === "updateStatus") {
    const { id, status } = body;
    const { error } = await supabase
      .from("Kleurstalen")
      .update({ status })
      .eq("id", id);

    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true });
  }

  if (body.action === "updateStatusBulk") {
    const { ids, status } = body;
    const { error } = await supabase
      .from("Kleurstalen")
      .update({ status })
      .in("id", ids);

    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
};

function KleurstaalCard({ item, activeTab, onPrint, onUpdate }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="400" blockAlign="center">
            <Text variant="headingMd" as="span" fontWeight="bold">
              {item.customerName}
            </Text>
            <Text variant="bodyMd" as="span" tone="subdued">
              {item.orderNumber}
            </Text>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={activeTab === "ready" ? "success" : undefined}>
              {item.status}
            </Badge>
            {activeTab === "ready" && (
              <Button variant="primary" tone="critical" onClick={() => onPrint(item)}>
                PRINT
              </Button>
            )}
            <Button onClick={() => onUpdate(item)}>
              {activeTab === "ready" ? "Update" : "Revert"}
            </Button>
          </InlineStack>
        </InlineStack>

        <Divider />

        <InlineStack gap="800" wrap={false}>
          <Box minWidth="0" width="100%">
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Kleurstalen</Text>
              <div dangerouslySetInnerHTML={{ __html: item.itemTitles || "" }} />
            </BlockStack>
          </Box>
          <Box minWidth="120px">
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Datum</Text>
              <Text variant="bodyMd">{formatDate(item.createdAt)}</Text>
            </BlockStack>
          </Box>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function Kleurstalen() {
  const { items: loaderItems, count: loaderCount, tab, limit, search, error, printItems, supabaseUrl, supabaseKey } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const [searchValue, setSearchValue] = useState(search || "");
  const [printingAll, setPrintingAll] = useState(false);
  const [printProgress, setPrintProgress] = useState({ step: "", current: 0, total: 0 });
  const [printMode, setPrintMode] = useState("n8n");
  const [liveItems, setLiveItems] = useState(loaderItems);
  const [liveCount, setLiveCount] = useState(loaderCount);
  const debounceRef = useRef(null);
  const clientRef = useRef(null);

  // Sync loader data into live state when loader refreshes
  useEffect(() => {
    setLiveItems(loaderItems);
    setLiveCount(loaderCount);
  }, [loaderItems, loaderCount]);

  useEffect(() => {
    const stored = localStorage.getItem("kleurstalen_print_mode");
    if (stored) setPrintMode(stored);
  }, []);

  // Client-side Supabase for direct updates
  if (!clientRef.current && supabaseUrl && supabaseKey) {
    clientRef.current = createClient(supabaseUrl, supabaseKey);
  }

  // Realtime subscription for Kleurstalen table
  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) return;

    const client = createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 2 } },
    });

    const channel = client
      .channel("realtime-kleurstalen")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Kleurstalen" },
        (payload) => {
          const activeStatus = tab === "done" ? "Done" : "Ready for Print";

          if (payload.eventType === "UPDATE") {
            const updated = payload.new;
            if (updated.status !== activeStatus) {
              // Item moved away from current tab — remove it
              setLiveItems((prev) => prev.filter((item) => item.id !== updated.id));
              setLiveCount((prev) => Math.max(0, prev - 1));
            } else {
              // Item updated but still in current tab — update in place
              setLiveItems((prev) =>
                prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
              );
            }
          } else if (payload.eventType === "INSERT") {
            const newItem = payload.new;
            if (newItem.status === activeStatus) {
              setLiveItems((prev) => [newItem, ...prev]);
              setLiveCount((prev) => prev + 1);
            }
          } else if (payload.eventType === "DELETE") {
            setLiveItems((prev) => prev.filter((item) => item.id !== payload.old.id));
            setLiveCount((prev) => Math.max(0, prev - 1));
          }
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      client.removeAllChannels();
    };
  }, [supabaseUrl, supabaseKey, tab]);

  const activeTab = tab;
  const hasMore = liveCount > liveItems.length;
  const selectedTabIndex = activeTab === "done" ? 1 : 0;

  const tabs = [
    { id: "ready", content: "Ready for Print" },
    { id: "done", content: "Done" },
  ];

  const handleTabChange = (index) => {
    setSearchValue("");
    setSearchParams({ tab: tabs[index].id });
  };

  const handleSearchChange = useCallback((value) => {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = { tab: activeTab };
      if (value) params.q = value;
      setSearchParams(params);
    }, 400);
  }, [activeTab, setSearchParams]);

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    setSearchParams({ tab: activeTab });
  }, [activeTab, setSearchParams]);

  const loadMore = () => {
    const params = { tab: activeTab, limit: String(limit + PAGE_SIZE) };
    if (search) params.q = search;
    setSearchParams(params);
  };

  const handlePrint = (item) => {
    if (item.pdf_url) {
      window.open(item.pdf_url, "_blank");
    }
  };

  const handlePrintAll = async () => {
    setPrintingAll(true);
    setPrintProgress({ step: "start", current: 0, total: 0 });
    try {
      if (printMode === "local") {
        console.log("Print items:", printItems);
        if (!printItems?.length) {
          console.error("No PDFs found");
          return;
        }

        const total = printItems.length;

        // Merge PDFs locally using pdf-lib
        setPrintProgress({ step: "download", current: 0, total });
        const { PDFDocument } = await import("pdf-lib");
        const mergedPdf = await PDFDocument.create();

        for (let i = 0; i < printItems.length; i++) {
          setPrintProgress({ step: "download", current: i + 1, total });
          try {
            const pdfRes = await fetch(printItems[i].pdf_url);
            const pdfBytes = await pdfRes.arrayBuffer();
            const doc = await PDFDocument.load(pdfBytes);
            const pages = await mergedPdf.copyPages(doc, doc.getPageIndices());
            pages.forEach((page) => mergedPdf.addPage(page));
          } catch (e) {
            console.error("Failed to load PDF:", printItems[i].pdf_url, e);
          }
        }

        setPrintProgress({ step: "merge", current: 0, total: 0 });
        const mergedBytes = await mergedPdf.save();
        const blob = new Blob([mergedBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");

        // Mark all printed items as Done via client-side Supabase (batched to avoid URL length limits)
        const ids = printItems.map((item) => item.id);
        if (clientRef.current) {
          const BATCH_SIZE = 100;
          const totalBatches = Math.ceil(ids.length / BATCH_SIZE);
          for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            setPrintProgress({ step: "status", current: batchNum, total: totalBatches });
            const batch = ids.slice(i, i + BATCH_SIZE);
            const { error: updateError } = await clientRef.current
              .from("Kleurstalen")
              .update({ status: "Done" })
              .in("id", batch);
            if (updateError) {
              console.error(`Batch update failed (${i}-${i + batch.length}):`, updateError);
            }
          }
        }
      } else {
        // N8N webhook mode
        setPrintProgress({ step: "webhook", current: 0, total: 0 });
        const res = await fetch(
          "https://voordeelgordijnen.n8n.sition.cloud/webhook/abbffa92-b0ab-409c-a0bd-c615224aad22",
          { method: "POST" },
        );
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      }
    } catch (e) {
      console.error("Failed to fetch print PDF:", e);
    } finally {
      setPrintingAll(false);
      setPrintProgress({ step: "", current: 0, total: 0 });
    }
  };

  const handleUpdate = async (item) => {
    const newStatus = activeTab === "ready" ? "Done" : "Ready for Print";
    if (clientRef.current) {
      await clientRef.current
        .from("Kleurstalen")
        .update({ status: newStatus })
        .eq("id", item.id);
    }
  };

  const primaryAction = activeTab === "ready"
    ? { content: printingAll ? "PDF genereren..." : "Alles Printen", onAction: handlePrintAll, loading: printingAll, disabled: printingAll }
    : undefined;

  const subtitle = `${liveCount} ${activeTab === "ready" ? "nog niet geprint" : "afgerond"}`;

  return (
    <Page fullWidth title="KLEURSTALEN" subtitle={subtitle} primaryAction={primaryAction}>
      <BlockStack gap="400">
        <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={handleTabChange} />

        {printingAll && (
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" fontWeight="semibold">
                {printProgress.step === "download" && `PDF's downloaden... (${printProgress.current}/${printProgress.total})`}
                {printProgress.step === "merge" && "PDF's samenvoegen..."}
                {printProgress.step === "status" && `Status bijwerken... (${printProgress.current}/${printProgress.total})`}
                {printProgress.step === "webhook" && "Wachten op n8n webhook..."}
                {printProgress.step === "start" && "Starten..."}
              </Text>
              <ProgressBar
                progress={
                  printProgress.total > 0
                    ? Math.round((printProgress.current / printProgress.total) * 100)
                    : 0
                }
                size="small"
                tone="primary"
              />
            </BlockStack>
          </Card>
        )}

        <TextField
          placeholder="Zoek op ordernummer of klantnaam..."
          value={searchValue}
          onChange={handleSearchChange}
          clearButton
          onClearButtonClick={handleSearchClear}
          prefix={<Icon source={SearchIcon} />}
          autoComplete="off"
        />

        {error && (
          <Banner tone="critical">
            <p>{error}</p>
          </Banner>
        )}

        <div style={{ opacity: isLoading ? 0.5 : 1, transition: "opacity 0.15s" }}>
          <BlockStack gap="400">
            {liveItems.map((item) => (
              <KleurstaalCard
                key={item.id}
                item={item}
                activeTab={activeTab}
                onPrint={handlePrint}
                onUpdate={handleUpdate}
              />
            ))}
          </BlockStack>
        </div>

        {liveItems.length === 0 && !error && (
          <Card>
            <EmptyState
              heading="Geen kleurstalen gevonden"
              image=""
            >
              <p>Er zijn geen kleurstalen in deze categorie.</p>
            </EmptyState>
          </Card>
        )}

        {hasMore && (
          <InlineStack align="center">
            <Button onClick={loadMore} loading={isLoading}>
              Meer laden ({liveItems.length} van {liveCount})
            </Button>
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
