import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation, useFetcher } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Spinner,
  Banner,
  TextField,
  Button,
  Box,
  Badge,
  Tabs,
  Icon,
  Select,
  Modal,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import supabase from "../supabase.server";

const PAGE_SIZE = 50;
const MAX_ORDERS = 250;
const TAG = "vooraf betalen per factuur";

const ORDERS_QUERY = `
  query VoorafBetalenCheck($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          tags
          displayFinancialStatus
          productionDestination: metafield(namespace: "custom", key: "production_destination") {
            value
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

function classifyDestinations(order) {
  const dest = order.productionDestination?.value || "";
  const tags = (order.tags || []).map((t) => t.toLowerCase());
  const out = [];
  if (dest === "WA") out.push("WA");
  if (dest === "GH") out.push("GH");
  if (dest === "HKL") out.push("HKL");
  if (tags.includes("kleurstaal")) out.push("KL");
  if (tags.includes("ne-distriservice")) out.push("NE");
  return out;
}

function parseOrderNumber(name) {
  if (!name) return null;
  const m = String(name).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

function numericGid(gid) {
  return String(gid || "").replace("gid://shopify/Order/", "");
}

async function fetchAllTaggedOrders(admin, search) {
  let query = `tag:"${TAG}"`;
  if (search) query = `${search} ${query}`;

  const collected = [];
  let after = null;
  let capped = false;

  while (collected.length < MAX_ORDERS) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: PAGE_SIZE, after, query },
    });
    const { data } = await response.json();
    const edges = data.orders.edges;
    for (const { node, cursor } of edges) {
      collected.push({ node, cursor });
      if (collected.length >= MAX_ORDERS) {
        capped = data.orders.pageInfo.hasNextPage || edges.indexOf(edges[edges.length - 1]) > 0;
        break;
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = edges.length ? edges[edges.length - 1].cursor : null;
    if (!after) break;
  }

  return { edges: collected, capped };
}

async function checkPresence(orders) {
  const waIds = [];
  const neIds = [];
  const klNumbers = [];
  const ghNumbers = [];
  const hklNumbers = [];

  for (const o of orders) {
    if (o.destinations.includes("WA")) waIds.push(o.numericId);
    if (o.destinations.includes("NE")) neIds.push(o.numericId);
    if (o.destinations.includes("KL") && o.orderNumber != null) klNumbers.push(o.orderNumber);
    if (o.destinations.includes("GH") && o.orderNumber != null) ghNumbers.push(String(o.orderNumber));
    if (o.destinations.includes("HKL") && o.orderNumber != null) hklNumbers.push(String(o.orderNumber));
  }

  const present = {
    WA: new Set(),
    NE: new Set(),
    KL: new Set(),
    GH: new Set(),
    HKL: new Set(),
  };

  const queries = [];

  if (waIds.length) {
    queries.push(
      supabase
        .from("Webattelier - lines")
        .select("orderId")
        .in("orderId", waIds)
        .then(({ data }) => {
          for (const r of data || []) present.WA.add(String(r.orderId));
        }),
    );
  }
  if (neIds.length) {
    queries.push(
      supabase
        .from("nedistri")
        .select("orderId")
        .in("orderId", neIds)
        .then(({ data }) => {
          for (const r of data || []) present.NE.add(String(r.orderId));
        }),
    );
  }
  if (klNumbers.length) {
    queries.push(
      supabase
        .from("Kleurstalen")
        .select("orderNumber")
        .in("orderNumber", klNumbers)
        .then(({ data }) => {
          for (const r of data || []) present.KL.add(String(r.orderNumber));
        }),
    );
  }
  if (ghNumbers.length) {
    queries.push(
      supabase
        .from("grandhome")
        .select("ordernumber")
        .in("ordernumber", ghNumbers)
        .then(({ data }) => {
          for (const r of data || []) present.GH.add(String(r.ordernumber));
        }),
    );
  }
  if (hklNumbers.length) {
    queries.push(
      supabase
        .from("hkl")
        .select("ordernumber")
        .in("ordernumber", hklNumbers)
        .then(({ data }) => {
          for (const r of data || []) present.HKL.add(String(r.ordernumber));
        }),
    );
  }

  await Promise.all(queries);

  return orders.map((o) => {
    const checks = o.destinations.map((d) => {
      const key = d === "WA" || d === "NE" ? String(o.numericId) : String(o.orderNumber ?? "");
      return { destination: d, found: present[d].has(key) };
    });
    return { ...o, checks };
  });
}

function bucketOrder(order) {
  // No destinations means nothing can be missing in supabase, so treat as present.
  if (order.destinations.length === 0) return "present";
  const allFound = order.checks.every((c) => c.found);
  return allFound ? "present" : "missing";
}

const FIN_STATUS_LABEL = {
  PAID: "Betaald",
  PARTIALLY_PAID: "Deels betaald",
  PENDING: "In afwachting",
  AUTHORIZED: "Geautoriseerd",
  PARTIALLY_REFUNDED: "Deels terugbetaald",
  REFUNDED: "Terugbetaald",
  VOIDED: "Geannuleerd",
  EXPIRED: "Verlopen",
};

const FIN_STATUS_OPTIONS = [
  { label: "Alle financiële statussen", value: "" },
  ...Object.entries(FIN_STATUS_LABEL).map(([value, label]) => ({ label, value })),
];

function financialStatusTone(status) {
  switch (status) {
    case "PAID":
      return "success";
    case "PENDING":
    case "AUTHORIZED":
    case "PARTIALLY_PAID":
      return "attention";
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
      return "warning";
    case "VOIDED":
    case "EXPIRED":
      return "critical";
    default:
      return undefined;
  }
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";

  try {
    const { edges, capped } = await fetchAllTaggedOrders(admin, search);

    const baseOrders = edges.map(({ node }) => {
      const numericId = numericGid(node.id);
      const orderNumber = parseOrderNumber(node.name);
      return {
        id: node.id,
        numericId,
        name: node.name,
        createdAt: node.createdAt,
        tags: node.tags || [],
        financialStatus: node.displayFinancialStatus || null,
        productionDestination: node.productionDestination?.value || null,
        orderNumber,
        destinations: classifyDestinations(node),
      };
    });

    const checked = await checkPresence(baseOrders);
    const buckets = { missing: [], present: [] };
    for (const o of checked) buckets[bucketOrder(o)].push(o);

    return json({
      buckets,
      total: checked.length,
      capped,
      search,
      shop: session.shop,
      error: null,
    });
  } catch (e) {
    console.error("Failed to load vooraf-betalen check:", e.message);
    return json({
      buckets: { missing: [], present: [] },
      total: 0,
      capped: false,
      search,
      shop: session.shop,
      error: e.message,
    });
  }
};

function StatusBadge({ destination, found }) {
  return found ? (
    <Badge tone="success">{`${destination} ✓`}</Badge>
  ) : (
    <Badge tone="critical">{`${destination} ontbreekt`}</Badge>
  );
}

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

const TAB_DEFS = [
  { id: "missing", label: "Openstaand" },
  { id: "present", label: "Afgehandeld" },
];

export default function VoorafBetalenCheck() {
  const { buckets, total, capped, search, error } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [searchValue, setSearchValue] = useState(search || "");

  const tabId = searchParams.get("tab");
  const activeTabId = TAB_DEFS.find((t) => t.id === tabId)?.id || "missing";
  const activeIndex = TAB_DEFS.findIndex((t) => t.id === activeTabId);

  const financialStatusFilter = searchParams.get("fs") || "";

  const filteredBuckets = useMemo(() => {
    if (!financialStatusFilter) return buckets;
    const match = (o) => o.financialStatus === financialStatusFilter;
    return {
      missing: (buckets.missing || []).filter(match),
      present: (buckets.present || []).filter(match),
    };
  }, [buckets, financialStatusFilter]);

  const tabs = useMemo(
    () =>
      TAB_DEFS.map((t) => ({
        id: t.id,
        content: `${t.label} (${filteredBuckets[t.id]?.length ?? 0})`,
      })),
    [filteredBuckets],
  );

  const visibleOrders = filteredBuckets[activeTabId] || [];

  const handleTabChange = useCallback(
    (index) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", TAB_DEFS[index].id);
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set("q", searchValue);
    if (activeTabId !== "missing") params.set("tab", activeTabId);
    if (financialStatusFilter) params.set("fs", financialStatusFilter);
    setSearchParams(params);
  }, [searchValue, activeTabId, financialStatusFilter, setSearchParams]);

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
  );

  const handleClear = useCallback(() => {
    setSearchValue("");
    const params = new URLSearchParams();
    if (activeTabId !== "missing") params.set("tab", activeTabId);
    if (financialStatusFilter) params.set("fs", financialStatusFilter);
    setSearchParams(params);
  }, [activeTabId, financialStatusFilter, setSearchParams]);

  const handleFinancialStatusChange = useCallback(
    (value) => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set("fs", value);
      else params.delete("fs");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const resubmitFetcher = useFetcher();
  const [confirmOrder, setConfirmOrder] = useState(null);
  const [resubmittingId, setResubmittingId] = useState(null);

  const handleResubmit = useCallback(() => {
    if (!confirmOrder) return;
    setResubmittingId(confirmOrder.id);
    resubmitFetcher.submit(
      { orderId: confirmOrder.id },
      { method: "POST", action: "/app/resubmit-order", encType: "application/json" },
    );
    setConfirmOrder(null);
  }, [confirmOrder, resubmitFetcher]);

  useEffect(() => {
    if (resubmitFetcher.state !== "idle" || !resubmitFetcher.data || !resubmittingId) return;
    if (resubmitFetcher.data.ok) {
      shopify.toast.show("Order opnieuw aangeboden");
    } else {
      shopify.toast.show(
        "Bieden mislukt: " + (resubmitFetcher.data.error || "onbekende fout"),
        { isError: true },
      );
    }
    setResubmittingId(null);
  }, [resubmitFetcher.state, resubmitFetcher.data, resubmittingId]);

  const isResubmitting = resubmitFetcher.state !== "idle";

  return (
    <Page fullWidth>
      <TitleBar title="Vooraf betalen per factuur check" />
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical">
            <p>{error}</p>
          </Banner>
        )}
        {capped && (
          <Banner tone="warning">
            <p>
              Resultaat afgekapt op {MAX_ORDERS} orders. Verfijn met de
              zoekbalk om oudere orders te zien.
            </p>
          </Banner>
        )}

        {/* Title */}
        <BlockStack gap="100">
          <Text variant="headingXl" as="h1">
            Vooraf betalen per factuur
          </Text>
          <Text variant="bodyMd" as="p" tone="subdued">
            Orders met tag <code>{TAG}</code>. Per order wordt
            gecontroleerd of een record bestaat in de juiste bestemmingstabel
            (Webattelier-lines, nedistri, Kleurstalen, grandhome, hkl).
          </Text>
        </BlockStack>

        {/* Tabs */}
        <div className="vooraf-tabs">
          <style>{`.vooraf-tabs .Polaris-Tabs__Wrapper { padding: 0; } .vooraf-tabs .Polaris-Tabs__Panel { padding: 0; } .vooraf-tabs .Polaris-Tabs__Outer { border: none; }`}</style>
          <Tabs tabs={tabs} selected={activeIndex} onSelect={handleTabChange} />
        </div>

        {/* Search + meta */}
        <InlineStack align="space-between" blockAlign="end">
          <InlineStack gap="200" blockAlign="end">
            <Box minWidth="400px" maxWidth="600px">
              <div onKeyDown={handleSearchKeyDown}>
                <TextField
                  label=""
                  labelHidden
                  value={searchValue}
                  onChange={setSearchValue}
                  placeholder="Zoek op ordernummer..."
                  prefix={<Icon source={SearchIcon} />}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={handleClear}
                />
              </div>
            </Box>
            <Button onClick={handleSearch} variant="primary">
              Zoeken
            </Button>
            <Box minWidth="220px">
              <Select
                label=""
                labelHidden
                options={FIN_STATUS_OPTIONS}
                value={financialStatusFilter}
                onChange={handleFinancialStatusChange}
              />
            </Box>
          </InlineStack>
          <InlineStack gap="200">
            <Badge>{`${total} geladen`}</Badge>
          </InlineStack>
        </InlineStack>

        {/* Order list */}
        <Card padding="0">
          {isLoading ? (
            <Box padding="800">
              <InlineStack align="center">
                <Spinner size="large" />
              </InlineStack>
            </Box>
          ) : visibleOrders.length === 0 ? (
            <Box padding="800">
              <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                Geen orders in deze categorie.
              </Text>
            </Box>
          ) : (
            <div style={{ opacity: isLoading ? 0.5 : 1, transition: "opacity 0.15s" }}>
              <BlockStack>
                {visibleOrders.map((order, idx) => (
                  <Box
                    key={order.id}
                    padding="400"
                    borderBlockStartWidth={idx === 0 ? "0" : "025"}
                    borderColor="border"
                  >
                    <InlineStack gap="400" align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Button
                            variant="plain"
                            url={`shopify://admin/orders/${order.numericId}`}
                            target="_top"
                          >
                            {order.name}
                          </Button>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {formatDate(order.createdAt)}
                          </Text>
                          {order.financialStatus && (
                            <Badge size="small" tone={financialStatusTone(order.financialStatus)}>
                              {FIN_STATUS_LABEL[order.financialStatus] || order.financialStatus}
                            </Badge>
                          )}
                          {order.productionDestination && (
                            <Badge size="small">{order.productionDestination}</Badge>
                          )}
                        </InlineStack>
                        {order.destinations.length === 0 && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            Geen bestemming (VDG/DEC of geen tag/metafield)
                          </Text>
                        )}
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <InlineStack gap="100" wrap>
                          {order.checks.map((c) => (
                            <StatusBadge
                              key={c.destination}
                              destination={c.destination}
                              found={c.found}
                            />
                          ))}
                        </InlineStack>
                        <Button
                          size="slim"
                          loading={resubmittingId === order.id}
                          disabled={isResubmitting && resubmittingId !== order.id}
                          onClick={() => setConfirmOrder(order)}
                        >
                          Bied opnieuw aan
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </div>
          )}
        </Card>
      </BlockStack>

      <Modal
        open={confirmOrder !== null}
        onClose={() => setConfirmOrder(null)}
        title={`Order ${confirmOrder?.name ?? ""} opnieuw aanbieden?`}
        primaryAction={{
          content: "Bevestig & bied aan",
          onAction: handleResubmit,
          loading: isResubmitting,
        }}
        secondaryActions={[{ content: "Annuleren", onAction: () => setConfirmOrder(null) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            De volledige order wordt opnieuw naar de webhook gestuurd. Alle line
            items en eigenschappen gaan mee, net als via de admin-actie "Bied
            opnieuw aan".
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
