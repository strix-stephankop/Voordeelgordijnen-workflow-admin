/**
 * Append an entry to the custom.change_log JSON metafield on a Shopify order.
 *
 * @param {object} admin - Shopify Admin GraphQL client (from authenticate.admin)
 * @param {string} orderGid - Shopify order GID, e.g. "gid://shopify/Order/123"
 * @param {object} entry - Change entry (action, field, oldValue, newValue, table, recordId, etc.)
 */
export async function appendChangeLog(admin, orderGid, entry) {
  if (!orderGid) {
    console.warn("[changelog] Skipped — no orderGid provided");
    return;
  }

  console.log("[changelog] Appending to", orderGid, "entry:", JSON.stringify(entry));

  // 1. Read current value
  const result = await admin.graphql(
    `#graphql
    query getChangeLog($id: ID!) {
      order(id: $id) {
        metafield(namespace: "custom", key: "change_log") { value }
      }
    }`,
    { variables: { id: orderGid } },
  ).then((r) => r.json());

  const existing = JSON.parse(result.data?.order?.metafield?.value || "[]");
  existing.push({ ...entry, timestamp: new Date().toISOString() });

  // 2. Write back
  const writeResult = await admin.graphql(
    `#graphql
    mutation setChangeLog($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [{
          ownerId: orderGid,
          namespace: "custom",
          key: "change_log",
          type: "json",
          value: JSON.stringify(existing),
        }],
      },
    },
  ).then((r) => r.json());

  const userErrors = writeResult.data?.metafieldsSet?.userErrors;
  if (userErrors?.length > 0) {
    console.error("[changelog] metafieldsSet userErrors:", JSON.stringify(userErrors));
  } else {
    console.log("[changelog] Successfully written, total entries:", existing.length);
  }
}
