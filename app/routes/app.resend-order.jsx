import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { appendChangeLog } from "../changelog.server";

const WEBHOOK_URL =
  "https://voordeelgordijnen.n8n.sition.cloud/webhook/fe5da6d2-8eaf-44c8-a9e8-6550aa3404d2";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const orderGid = formData.get("orderGid");

  if (!orderGid) {
    return json({ ok: false, error: "Missing orderGid" }, { status: 400 });
  }

  try {
    // Fetch the full order via GraphQL
    const result = await admin
      .graphql(
        `#graphql
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          email
          phone
          note
          createdAt
          updatedAt
          cancelledAt
          closedAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
          currencyCode
          tags
          customer {
            id
            email
            firstName
            lastName
            phone
          }
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            country
            countryCodeV2
            phone
            company
          }
          billingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            country
            countryCodeV2
            phone
            company
          }
          lineItems(first: 50) {
            nodes {
              id
              title
              quantity
              sku
              variantTitle
              vendor
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              discountedUnitPriceSet { shopMoney { amount currencyCode } }
              customAttributes { key value }
              image { url altText }
            }
          }
          shippingLines(first: 10) {
            nodes {
              title
              code
              originalPriceSet { shopMoney { amount currencyCode } }
            }
          }
          metafields(first: 50) {
            nodes {
              namespace
              key
              value
              type
            }
          }
        }
      }`,
        { variables: { id: orderGid } },
      )
      .then((r) => r.json());

    const order = result.data?.order;
    if (!order) {
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    // POST order JSON to the webhook
    const webhookResponse = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });

    if (!webhookResponse.ok) {
      const body = await webhookResponse.text().catch(() => "");
      return json(
        {
          ok: false,
          error: `Webhook returned ${webhookResponse.status}: ${body}`,
        },
        { status: 502 },
      );
    }

    // Log to changelog
    await appendChangeLog(admin, orderGid, { action: "order_resend" });

    return json({ ok: true });
  } catch (err) {
    console.error("[resend-order] Error:", err);
    return json(
      { ok: false, error: err.message || "Unknown error" },
      { status: 500 },
    );
  }
};
