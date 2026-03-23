import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import { useState, useRef, useCallback } from "react";
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
    return json({ items: [], count: 0, tab, limit, search, error: error.message });
  }

  return json({ items: data ?? [], count, tab, limit, search, error: null });
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
  const { items, count, tab, limit, search, error } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const [searchValue, setSearchValue] = useState(search || "");
  const [printingAll, setPrintingAll] = useState(false);
  const debounceRef = useRef(null);

  const activeTab = tab;
  const hasMore = count > items.length;
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
    try {
      const res = await fetch(
        "https://voordeelgordijnen.n8n.sition.cloud/webhook/abbffa92-b0ab-409c-a0bd-c615224aad22",
        { method: "POST" },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (e) {
      console.error("Failed to fetch print PDF:", e);
    } finally {
      setPrintingAll(false);
    }
  };

  const handleUpdate = async (item) => {
    const newStatus = activeTab === "ready" ? "Done" : "Ready for Print";
    await fetch(window.location.pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateStatus", id: item.id, status: newStatus }),
    });
    const params = { tab: activeTab, limit: String(limit) };
    if (search) params.q = search;
    setSearchParams(params);
  };

  const primaryAction = activeTab === "ready"
    ? { content: printingAll ? "PDF genereren..." : "Alles Printen", onAction: handlePrintAll, loading: printingAll, disabled: printingAll }
    : undefined;

  const subtitle = `${count} ${activeTab === "ready" ? "nog niet geprint" : "afgerond"}`;

  return (
    <Page title="KLEURSTALEN" subtitle={subtitle} primaryAction={primaryAction}>
      <BlockStack gap="400">
        <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={handleTabChange} />

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
            {items.map((item) => (
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

        {items.length === 0 && !error && (
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
              Meer laden ({items.length} van {count})
            </Button>
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
