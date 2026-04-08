import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Spinner,
  Pagination,
  Banner,
  TextField,
  Button,
  Box,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const PAGE_SIZE = 50;

/* ── GraphQL ── */

const ORDERS_QUERY = `
  query MetafieldCheck($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            firstName
            lastName
            email
          }
          tags
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
      }
    }
  }
`;

/* ── Loader ── */

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const search = url.searchParams.get("q") || "";

  // Query: orders missing the n8n_workflow_url metafield
  let query = "-metafield:custom.n8n_workflow_url:*";
  if (search) {
    query = `${search} ${query}`;
  }

  try {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: {
        first: PAGE_SIZE,
        after,
        query,
      },
    });
    const { data } = await response.json();

    const orders = data.orders.edges.map(({ node, cursor }) => ({
      id: node.id,
      name: node.name,
      createdAt: node.createdAt,
      financialStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus,
      total: node.totalPriceSet?.shopMoney?.amount || "0",
      currency: node.totalPriceSet?.shopMoney?.currencyCode || "EUR",
      customer: node.customer
        ? `${node.customer.firstName || ""} ${node.customer.lastName || ""}`.trim()
        : "Geen klant",
      email: node.customer?.email || "",
      tags: node.tags || [],
      cursor,
    }));

    return json({
      orders,
      pageInfo: data.orders.pageInfo,
      after,
      search,
      error: null,
    });
  } catch (e) {
    console.error("Failed to fetch missing orders:", e.message);
    return json({
      orders: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      after: null,
      search,
      error: e.message,
    });
  }
};

/* ── Helpers ── */

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function financialBadge(status) {
  const map = {
    PAID: { tone: "success", label: "Betaald" },
    PENDING: { tone: "attention", label: "In afwachting" },
    REFUNDED: { tone: "info", label: "Terugbetaald" },
    PARTIALLY_REFUNDED: { tone: "info", label: "Deels terugbetaald" },
    VOIDED: { tone: "critical", label: "Geannuleerd" },
    AUTHORIZED: { tone: "warning", label: "Geautoriseerd" },
  };
  const m = map[status] || { tone: undefined, label: status || "Onbekend" };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

function fulfillmentBadge(status) {
  const map = {
    FULFILLED: { tone: "success", label: "Vervuld" },
    UNFULFILLED: { tone: "attention", label: "Niet vervuld" },
    PARTIALLY_FULFILLED: { tone: "warning", label: "Deels vervuld" },
    IN_PROGRESS: { tone: "info", label: "In behandeling" },
  };
  const m = map[status] || { tone: undefined, label: status || "Onbekend" };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/* ── Component ── */

export default function MetafieldCheck() {
  const { orders, pageInfo, search, error } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [searchValue, setSearchValue] = useState(search || "");

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set("q", searchValue);
    setSearchParams(params);
  }, [searchValue, setSearchParams]);

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
  );

  const handleNextPage = useCallback(() => {
    if (orders.length === 0) return;
    const lastCursor = orders[orders.length - 1].cursor;
    const params = new URLSearchParams(searchParams);
    params.set("after", lastCursor);
    setSearchParams(params);
  }, [orders, searchParams, setSearchParams]);

  const handleClear = useCallback(() => {
    setSearchValue("");
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  return (
    <Page>
      <TitleBar title="Metafield Check" />
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical">
            <p>{error}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" align="start" blockAlign="end">
              <Box minWidth="300px">
                <TextField
                  label=""
                  value={searchValue}
                  onChange={setSearchValue}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Zoek op ordernummer, klant..."
                  prefix={<SearchIcon />}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={handleClear}
                />
              </Box>
              <Button onClick={handleSearch} variant="primary">
                Zoeken
              </Button>
            </InlineStack>

            <Text as="p" variant="bodySm" tone="subdued">
              Orders zonder <code>custom.n8n_workflow_url</code> metafield
            </Text>
          </BlockStack>
        </Card>

        <Card padding="0">
          {isLoading ? (
            <Box padding="800">
              <InlineStack align="center">
                <Spinner size="large" />
              </InlineStack>
            </Box>
          ) : orders.length === 0 ? (
            <Box padding="800">
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Geen orders gevonden zonder metafield.
                </Text>
              </BlockStack>
            </Box>
          ) : (
            <BlockStack>
              <Box padding="300" paddingInlineStart="400" paddingInlineEnd="400">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                    Order
                  </Text>
                  <InlineStack gap="800">
                    <Box minWidth="140px">
                      <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                        Klant
                      </Text>
                    </Box>
                    <Box minWidth="100px">
                      <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                        Betaling
                      </Text>
                    </Box>
                    <Box minWidth="100px">
                      <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                        Fulfillment
                      </Text>
                    </Box>
                    <Box minWidth="80px">
                      <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued" alignment="end">
                        Totaal
                      </Text>
                    </Box>
                    <Box minWidth="130px">
                      <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                        Datum
                      </Text>
                    </Box>
                  </InlineStack>
                </InlineStack>
              </Box>

              {orders.map((order) => {
                const numericId = order.id.replace("gid://shopify/Order/", "");
                return (
                  <Box
                    key={order.id}
                    padding="300"
                    paddingInlineStart="400"
                    paddingInlineEnd="400"
                    borderBlockStartWidth="025"
                    borderColor="border"
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Button
                          variant="plain"
                          url={`shopify://admin/orders/${numericId}`}
                          target="_top"
                        >
                          {order.name}
                        </Button>
                        {order.tags.length > 0 && (
                          <InlineStack gap="100">
                            {order.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} tone="info">
                                {tag}
                              </Badge>
                            ))}
                            {order.tags.length > 3 && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                +{order.tags.length - 3}
                              </Text>
                            )}
                          </InlineStack>
                        )}
                      </BlockStack>
                      <InlineStack gap="800" blockAlign="center">
                        <Box minWidth="140px">
                          <Text as="span" variant="bodySm">
                            {order.customer}
                          </Text>
                        </Box>
                        <Box minWidth="100px">{financialBadge(order.financialStatus)}</Box>
                        <Box minWidth="100px">{fulfillmentBadge(order.fulfillmentStatus)}</Box>
                        <Box minWidth="80px">
                          <Text as="span" variant="bodySm" alignment="end">
                            €{parseFloat(order.total).toFixed(2)}
                          </Text>
                        </Box>
                        <Box minWidth="130px">
                          <Text as="span" variant="bodySm">
                            {formatDate(order.createdAt)}
                          </Text>
                        </Box>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
          )}
        </Card>

        <InlineStack align="center">
          <Pagination
            hasPrevious={!!searchParams.get("after")}
            onPrevious={() => {
              const params = new URLSearchParams(searchParams);
              params.delete("after");
              setSearchParams(params);
            }}
            hasNext={pageInfo.hasNextPage}
            onNext={handleNextPage}
          />
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
