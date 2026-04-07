import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_WEBHOOK =
  "https://voordeelgordijnen.n8n.sition.cloud/webhook/252b1295-0a82-4ce5-bfdc-8c66501fef9b";

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) {
      id
      name
      tags
      email
      createdAt
      customer {
        firstName
        lastName
        email
        phone
      }
      shippingAddress {
        firstName
        lastName
        address1
        address2
        city
        zip
        province
        country
        phone
      }
      lineItems(first: 50) {
        edges {
          node {
            id
            title
            quantity
            variant {
              id
              title
              sku
            }
            customAttributes {
              key
              value
            }
            originalUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  if (!orderId) {
    return json({ order: null, error: "Missing orderId" }, { status: 400 });
  }

  try {
    const response = await admin.graphql(ORDER_QUERY, {
      variables: { id: orderId },
    });
    const { data } = await response.json();

    if (!data?.order) {
      return json({ order: null, error: "Order niet gevonden" }, { status: 404 });
    }

    const order = data.order;
    return json({
      order: {
        id: order.id,
        name: order.name,
        tags: order.tags,
        email: order.email,
        createdAt: order.createdAt,
        customer: order.customer,
        shippingAddress: order.shippingAddress,
        lineItems: order.lineItems.edges.map((edge) => ({
          id: edge.node.id,
          title: edge.node.title,
          quantity: edge.node.quantity,
          variantId: edge.node.variant?.id || null,
          variantTitle: edge.node.variant?.title || null,
          sku: edge.node.variant?.sku || null,
          price: edge.node.originalUnitPriceSet?.shopMoney?.amount || "0",
          currency: edge.node.originalUnitPriceSet?.shopMoney?.currencyCode || "EUR",
          properties: (edge.node.customAttributes || []).map((attr) => ({
            key: attr.key,
            value: attr.value || "",
          })),
        })),
      },
    });
  } catch (e) {
    console.error("Failed to fetch order:", e.message);
    return json({ order: null, error: e.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const payload = await request.json();

  let webhookUrl = DEFAULT_WEBHOOK;
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "resubmit_webhook_url" },
    });
    if (setting?.value) webhookUrl = setting.value;
  } catch {}

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return json(
        { ok: false, error: `Webhook responded with ${res.status}` },
        { status: 502 },
      );
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e.message }, { status: 502 });
  }
};
