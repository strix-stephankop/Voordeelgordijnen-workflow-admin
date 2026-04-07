import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_WEBHOOK =
  "https://voordeelgordijnen.n8n.sition.cloud/webhook/252b1295-0a82-4ce5-bfdc-8c66501fef9b";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  let resubmitWebhookUrl = "";
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "resubmit_webhook_url" },
    });
    resubmitWebhookUrl = setting?.value || "";
  } catch {}

  return json({ resubmitWebhookUrl });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const key = formData.get("key");
  const value = formData.get("value");

  if (key === "resubmit_webhook_url") {
    await prisma.setting.upsert({
      where: { key: "resubmit_webhook_url" },
      update: { value: value || "" },
      create: { key: "resubmit_webhook_url", value: value || "" },
    });
  }

  return json({ ok: true });
};

export default function Settings() {
  const { resubmitWebhookUrl } = useLoaderData();
  const fetcher = useFetcher();

  const [selectedTab, setSelectedTab] = useState(0);
  const [printMode, setPrintMode] = useState("n8n");
  const [webhookInput, setWebhookInput] = useState(resubmitWebhookUrl);
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

  const tabs = [
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

        {selectedTab === 1 && (
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
