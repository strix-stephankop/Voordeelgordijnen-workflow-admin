import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Tabs,
  Select,
  TextField,
  Banner,
  Button,
  InlineStack,
  Checkbox,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { NAV_PAGES } from "./app";

const DEFAULT_WEBHOOK =
  "https://voordeelgordijnen.n8n.sition.cloud/webhook/b16cf368-ecf4-414a-89bb-f5387ca2ffd0";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  let resubmitWebhookUrl = "";
  let pageVisibility = {};
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ["resubmit_webhook_url", "page_visibility"] } },
    });
    for (const s of settings) {
      if (s.key === "resubmit_webhook_url") resubmitWebhookUrl = s.value || "";
      if (s.key === "page_visibility") pageVisibility = JSON.parse(s.value || "{}");
    }
  } catch {}

  return json({ resubmitWebhookUrl, pageVisibility });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const key = formData.get("key");
  const value = formData.get("value");

  if (key === "resubmit_webhook_url" || key === "page_visibility") {
    await prisma.setting.upsert({
      where: { key },
      update: { value: value || "" },
      create: { key, value: value || "" },
    });
  }

  return json({ ok: true });
};

export default function Settings() {
  const { resubmitWebhookUrl, pageVisibility } = useLoaderData();
  const fetcher = useFetcher();

  const [selectedTab, setSelectedTab] = useState(0);
  const [printMode, setPrintMode] = useState("n8n");
  const [webhookInput, setWebhookInput] = useState(resubmitWebhookUrl);
  const [visibility, setVisibility] = useState(pageVisibility);
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

  const handleSaveWebhook = () => {
    fetcher.submit(
      { key: "resubmit_webhook_url", value: webhookInput },
      { method: "POST" },
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTogglePage = useCallback((pageKey) => {
    setVisibility((prev) => {
      const updated = { ...prev, [pageKey]: prev[pageKey] === false ? true : false };
      // Remove keys that are true (default) to keep it clean
      if (updated[pageKey] === true) delete updated[pageKey];
      fetcher.submit(
        { key: "page_visibility", value: JSON.stringify(updated) },
        { method: "POST" },
      );
      return updated;
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [fetcher]);

  const tabs = [
    { id: "pages", content: "Pagina's" },
    { id: "kleurstalen", content: "Kleurstalen" },
    { id: "resubmit", content: "Bied opnieuw aan" },
  ];

  return (
    <Page title="Instellingen">
      <BlockStack gap="400">
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

        {saved && (
          <Banner tone="success" onDismiss={() => setSaved(false)}>
            Instelling opgeslagen
          </Banner>
        )}

        {selectedTab === 0 && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Pagina zichtbaarheid
              </Text>
              <Text variant="bodySm" as="p" tone="subdued">
                Schakel pagina's in of uit in de navigatie.
              </Text>
              {NAV_PAGES.map((page) => (
                <Checkbox
                  key={page.key}
                  label={page.label}
                  checked={visibility[page.key] !== false}
                  onChange={() => handleTogglePage(page.key)}
                />
              ))}
            </BlockStack>
          </Card>
        )}

        {selectedTab === 1 && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Print instellingen
              </Text>
              <Select
                label="Alles Printen methode"
                options={[
                  { label: "N8N Server (webhook)", value: "n8n" },
                  { label: "Lokaal (PDF's mergen in browser)", value: "local" },
                ]}
                value={printMode}
                onChange={handlePrintModeChange}
                helpText={
                  printMode === "local"
                    ? "PDF's worden opgehaald uit Supabase (pdf_url) voor items met status 'Ready for Print', samengevoegd in de browser met pdf-lib, en geopend."
                    : "PDF wordt gegenereerd via de n8n webhook en geopend."
                }
              />
            </BlockStack>
          </Card>
        )}

        {selectedTab === 2 && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Bied opnieuw aan - Webhook
              </Text>
              <TextField
                label="Webhook URL"
                value={webhookInput}
                onChange={setWebhookInput}
                placeholder={DEFAULT_WEBHOOK}
                helpText="De webhook URL waar het aangepaste order JSON payload naartoe wordt gestuurd. Laat leeg voor de standaard URL."
                autoComplete="off"
              />
              {!webhookInput && (
                <Text variant="bodySm" as="span" tone="subdued">
                  Standaard: {DEFAULT_WEBHOOK}
                </Text>
              )}
              <Button onClick={handleSaveWebhook}>Opslaan</Button>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
