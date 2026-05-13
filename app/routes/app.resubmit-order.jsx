import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DEFAULT_WEBHOOK =
  "https://voordeelgordijnen.n8n.sition.cloud/webhook/b16cf368-ecf4-414a-89bb-f5387ca2ffd0";

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

async function fetchOrderPayload(admin, orderId) {
  const response = await admin.graphql(ORDER_QUERY, { variables: { id: orderId } });
  const { data } = await response.json();
  if (!data?.order) return null;
  const order = data.order;
  return {
    orderId: order.id,
    orderName: order.name,
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
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let admin;
  try {
    ({ admin } = await authenticate.admin(request));
  } catch (authResponse) {
    if (authResponse instanceof Response) {
      return json(
        { order: null, error: "Authentication failed" },
        { status: 401, headers: CORS_HEADERS },
      );
    }
    throw authResponse;
  }

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  if (!orderId) {
    return json({ order: null, error: "Missing orderId" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const payload = await fetchOrderPayload(admin, orderId);
    if (!payload) {
      return json({ order: null, error: "Order niet gevonden" }, { status: 404, headers: CORS_HEADERS });
    }
    // Keep the loader's response shape (id/name) for the admin extension.
    return json({
      order: {
        id: payload.orderId,
        name: payload.orderName,
        tags: payload.tags,
        email: payload.email,
        createdAt: payload.createdAt,
        customer: payload.customer,
        shippingAddress: payload.shippingAddress,
        lineItems: payload.lineItems,
      },
    }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("Failed to fetch order:", e.message);
    return json({ order: null, error: e.message }, { status: 500, headers: CORS_HEADERS });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let admin;
  try {
    ({ admin } = await authenticate.admin(request));
  } catch (authResponse) {
    if (authResponse instanceof Response) {
      return json(
        { ok: false, error: "Authentication failed" },
        { status: 401, headers: CORS_HEADERS },
      );
    }
    throw authResponse;
  }

  let payload = await request.json();

  // Shorthand for in-app pages: when only orderId is given, fetch the order
  // server-side and build the full payload so callers don't need two round trips.
  if (payload?.orderId && !payload.lineItems) {
    const built = await fetchOrderPayload(admin, payload.orderId);
    if (!built) {
      return json(
        { ok: false, error: "Order niet gevonden" },
        { status: 404, headers: CORS_HEADERS },
      );
    }
    payload = built;
  }

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
        { status: 502, headers: CORS_HEADERS },
      );
    }
    return json({ ok: true }, { headers: CORS_HEADERS });
  } catch (e) {
    return json({ ok: false, error: e.message }, { status: 502, headers: CORS_HEADERS });
  }
};
