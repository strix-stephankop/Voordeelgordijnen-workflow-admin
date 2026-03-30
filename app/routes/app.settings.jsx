import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Tabs,
  Select,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({});
};

export default function Settings() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [printMode, setPrintMode] = useState("n8n");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("kleurstalen_print_mode");
    if (stored) setPrintMode(stored);
  }, []);

  const handlePrintModeChange = (value) => {
    setPrintMode(value);
    localStorage.setItem("kleurstalen_print_mode", value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const tabs = [{ id: "kleurstalen", content: "Kleurstalen" }];

  return (
    <Page title="Instellingen">
      <BlockStack gap="400">
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

        {selectedTab === 0 && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Print instellingen
              </Text>
              <Select
                label="Alles Printen methode"
                options={[
                  {
                    label: "N8N Server (webhook)",
                    value: "n8n",
                  },
                  {
                    label: "Lokaal (PDF's mergen in browser)",
                    value: "local",
                  },
                ]}
                value={printMode}
                onChange={handlePrintModeChange}
                helpText={
                  printMode === "local"
                    ? "PDF's worden opgehaald uit Supabase (pdf_url) voor items met status 'Ready for Print', samengevoegd in de browser met pdf-lib, en geopend."
                    : "PDF wordt gegenereerd via de n8n webhook en geopend."
                }
              />
              {saved && (
                <Banner tone="success" onDismiss={() => setSaved(false)}>
                  Instelling opgeslagen
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
