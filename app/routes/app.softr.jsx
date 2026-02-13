import { useState } from "react";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Banner,
  Collapsible,
  Icon,
  Divider,
  Button,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ListBulletedIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getCachedTables, hasCachedData, syncSoftrData } from "../softr.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  try {
    const hasData = await hasCachedData();

    // Auto-sync on first load if no data exists
    if (!hasData) {
      const count = await syncSoftrData();
      console.log(`[softr] Initial sync: ${count} tables`);
    }

    const tables = await getCachedTables();
    return json({ tables, error: null, synced: !hasData });
  } catch (e) {
    return json({ tables: [], error: e.message, synced: false });
  }
};

export const action = async ({ request }) => {
  await authenticate.admin(request);

  try {
    const count = await syncSoftrData();
    const tables = await getCachedTables();
    return json({ tables, error: null, synced: true, message: `Synced ${count} tables` });
  } catch (e) {
    const tables = await getCachedTables().catch(() => []);
    return json({ tables, error: e.message, synced: false });
  }
};

export default function SoftrPage() {
  const loaderData = useLoaderData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isRefreshing = navigation.state === "submitting";

  const { tables, error } = loaderData;

  const handleRefresh = () => {
    submit(null, { method: "post" });
  };

  return (
    <Page
      title="Softr Database"
      primaryAction={{
        content: "Refresh",
        icon: RefreshIcon,
        loading: isRefreshing,
        onAction: handleRefresh,
      }}
    >
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        {tables.length === 0 && !error && (
          <Card>
            <Box padding="600">
              <BlockStack gap="200" inlineAlign="center">
                <Text alignment="center" tone="subdued">
                  No tables found. Click Refresh to sync from Softr.
                </Text>
              </BlockStack>
            </Box>
          </Card>
        )}

        {tables.map((table) => (
          <TableCard key={table.id} table={table} />
        ))}
      </BlockStack>
    </Page>
  );
}

// ─── Table Card ───

function TableCard({ table }) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const fields = table.fields ?? [];

  return (
    <Card>
      <BlockStack gap="200">
        <div
          onClick={() => setFieldsOpen((prev) => !prev)}
          style={{ cursor: "pointer" }}
        >
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={ListBulletedIcon} tone="base" />
              <Text variant="headingSm" as="h3">{table.name}</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">{fields.length} {fields.length === 1 ? "field" : "fields"}</Badge>
              <Icon source={fieldsOpen ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
            </InlineStack>
          </InlineStack>
        </div>

        {table.description && (
          <Text variant="bodySm" tone="subdued">{table.description}</Text>
        )}

        <Collapsible open={fieldsOpen} transition={{ duration: "200ms" }}>
          {fields.length > 0 && (
            <Box paddingBlockStart="200">
              <BlockStack gap="0">
                {/* Header */}
                <Box padding="200" background="bg-surface-tertiary" borderRadius="200 200 0 0">
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: "30%" }}><Text variant="bodySm" fontWeight="semibold">Name</Text></div>
                    <div style={{ width: "20%" }}><Text variant="bodySm" fontWeight="semibold">Type</Text></div>
                    <div style={{ width: "25%" }}><Text variant="bodySm" fontWeight="semibold">ID</Text></div>
                    <div style={{ width: "25%" }}><Text variant="bodySm" fontWeight="semibold">Properties</Text></div>
                  </div>
                </Box>
                <Divider />
                {/* Rows */}
                {fields.map((field, i) => (
                  <Box
                    key={field.id}
                    padding="200"
                    borderRadius={i === fields.length - 1 ? "0 0 200 200" : undefined}
                  >
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ width: "30%", textAlign: "left" }}>
                        <Text variant="bodySm">{field.name}</Text>
                      </div>
                      <div style={{ width: "20%" }}>
                        <Badge tone="info">{field.type}</Badge>
                      </div>
                      <div style={{ width: "25%", overflow: "hidden" }}>
                        <Text variant="bodySm" tone="subdued" truncate>{field.id}</Text>
                      </div>
                      <div style={{ width: "25%", display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {field.required && <Badge tone="warning">Required</Badge>}
                        {field.readonly && <Badge>Readonly</Badge>}
                        {field.locked && <Badge tone="attention">Locked</Badge>}
                      </div>
                    </div>
                  </Box>
                ))}
              </BlockStack>
            </Box>
          )}
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
