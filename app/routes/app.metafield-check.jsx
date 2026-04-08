import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
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

const ORDERS_QUERY = `
  query MetafieldCheck($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
        }
        cursor
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const search = url.searchParams.get("q") || "";

  let query = "-metafield:custom.n8n_workflow_url:*";
  if (search) {
    query = `${search} ${query}`;
  }

  try {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: PAGE_SIZE, after, query },
    });
    const { data } = await response.json();

    const orders = data.orders.edges.map(({ node, cursor }) => ({
      id: node.id,
      name: node.name,
      cursor,
    }));

    return json({
      orders,
      pageInfo: data.orders.pageInfo,
      search,
      error: null,
    });
  } catch (e) {
    console.error("Failed to fetch missing orders:", e.message);
    return json({
      orders: [],
      pageInfo: { hasNextPage: false },
      search,
      error: e.message,
    });
  }
};

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
                  placeholder="Zoek op ordernummer..."
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
              <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                Geen orders gevonden zonder metafield.
              </Text>
            </Box>
          ) : (
            <BlockStack>
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
                    <Button
                      variant="plain"
                      url={`shopify://admin/orders/${numericId}`}
                      target="_top"
                    >
                      {order.name}
                    </Button>
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
