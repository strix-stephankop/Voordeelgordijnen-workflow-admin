import { extension } from "@shopify/ui-extensions/admin";

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

const WEBHOOK_URL =
  "https://voordeelgordijnen.n8n.sition.cloud/webhook/252b1295-0a82-4ce5-bfdc-8c66501fef9b";

export default extension("admin.order-details.action.render", async (root, api) => {
  const close = api.close || (() => {});
  const orderId = shopify.data?.selected?.[0]?.id || api.data?.selected?.[0]?.id;

  const action = root.createComponent("AdminAction", {
    title: "Bied opnieuw aan",
  });
  const loadingStack = root.createComponent("BlockStack", {
    inlineAlignment: "center",
    padding: "large400",
  });
  loadingStack.appendChild(
    root.createComponent("ProgressIndicator", { size: "small-200" }),
  );
  action.appendChild(loadingStack);
  root.appendChild(action);
  root.mount();

  if (!orderId) {
    action.removeChild(loadingStack);
    action.appendChild(
      root.createComponent("Banner", { tone: "warning" }, "Geen order ID gevonden."),
    );
    return;
  }

  let order = null;
  let lineItems = [];

  try {
    const res = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      body: JSON.stringify({ query: ORDER_QUERY, variables: { id: orderId } }),
    });
    const json = await res.json();
    order = json.data?.order;

    if (!order) {
      throw new Error(
        "Geen toegang tot orders. Ga naar Settings > Apps > Vogo workflow admin en herinstalleer om scopes bij te werken.",
      );
    }

    lineItems = order.lineItems.edges.map((edge, i) => ({
      _key: i,
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
    }));

    renderUI();
  } catch (e) {
    action.removeChild(loadingStack);
    action.appendChild(
      root.createComponent("Banner", { tone: "critical" }, e.message),
    );
  }

  // ── Main overview ──
  function renderUI() {
    action.replaceChildren();

    action.updateProps({
      title: `Bied opnieuw aan — ${order.name}`,
      primaryAction: root.createComponent(
        "Button",
        {
          onPress: handleSubmit,
          disabled: lineItems.length === 0,
        },
        "Bevestig & bied aan",
      ),
      secondaryAction: root.createComponent(
        "Button",
        { onPress: close },
        "Annuleren",
      ),
    });

    const container = root.createComponent("BlockStack", { gap: "large" });

    // Summary banner
    const summaryText = `${lineItems.length} item${lineItems.length !== 1 ? "s" : ""} — Totaal: ${formatTotal()} ${lineItems[0]?.currency || "EUR"}`;
    container.appendChild(
      root.createComponent("Banner", { tone: "info" }, summaryText),
    );

    if (lineItems.length === 0) {
      container.appendChild(
        root.createComponent(
          "Banner",
          { tone: "warning" },
          "Alle line items zijn verwijderd. Voeg items toe of annuleer.",
        ),
      );
    }

    // Line items
    for (const item of lineItems) {
      container.appendChild(renderLineItem(item));
    }

    action.appendChild(container);
  }

  function formatTotal() {
    const total = lineItems.reduce(
      (sum, item) => sum + parseFloat(item.price || 0) * item.quantity,
      0,
    );
    return total.toFixed(2);
  }

  // ── Single line item card ──
  function renderLineItem(item) {
    const section = root.createComponent("Section", {
      heading: item.title,
    });
    const stack = root.createComponent("BlockStack", { gap: "base" });

    // Variant + SKU + Price summary line
    const metaLine = [
      item.variantTitle,
      item.sku && `SKU: ${item.sku}`,
      `€${item.price}`,
    ]
      .filter(Boolean)
      .join("  ·  ");

    stack.appendChild(root.createComponent("Text", { tone: "subdued" }, metaLine));

    // Quantity row
    const qtyRow = root.createComponent("InlineStack", {
      gap: "base",
      blockAlignment: "center",
      inlineAlignment: "space-between",
    });

    qtyRow.appendChild(
      root.createComponent("NumberField", {
        label: "Aantal",
        value: item.quantity,
        min: 1,
        onChange: (val) => {
          item.quantity = Math.max(1, val);
        },
      }),
    );

    qtyRow.appendChild(
      root.createComponent(
        "Button",
        {
          tone: "critical",
          variant: "tertiary",
          onPress: () => {
            lineItems = lineItems.filter((li) => li._key !== item._key);
            renderUI();
          },
        },
        "Verwijder item",
      ),
    );

    stack.appendChild(qtyRow);

    // Properties
    if (item.properties.length > 0) {
      stack.appendChild(root.createComponent("Divider", {}));

      const propsHeadRow = root.createComponent("InlineStack", {
        gap: "base",
        blockAlignment: "center",
        inlineAlignment: "space-between",
      });
      propsHeadRow.appendChild(
        root.createComponent("Text", { fontWeight: "bold" }, "Eigenschappen"),
      );
      propsHeadRow.appendChild(
        root.createComponent(
          "Button",
          {
            variant: "tertiary",
            onPress: () => renderEditProperties(item),
          },
          "Bewerken",
        ),
      );
      stack.appendChild(propsHeadRow);

      const propsGrid = root.createComponent("BlockStack", { gap: "extraTight" });
      for (const prop of item.properties) {
        if (!prop.key) continue;
        const propRow = root.createComponent("InlineStack", {
          gap: "tight",
          blockAlignment: "center",
        });
        propRow.appendChild(
          root.createComponent("Text", { fontWeight: "bold" }, `${prop.key}:`),
        );
        propRow.appendChild(root.createComponent("Text", {}, prop.value));
        propsGrid.appendChild(propRow);
      }
      stack.appendChild(propsGrid);
    } else {
      stack.appendChild(root.createComponent("Divider", {}));
      const noPropsRow = root.createComponent("InlineStack", {
        gap: "base",
        blockAlignment: "center",
        inlineAlignment: "space-between",
      });
      noPropsRow.appendChild(
        root.createComponent("Text", { tone: "subdued" }, "Geen eigenschappen"),
      );
      noPropsRow.appendChild(
        root.createComponent(
          "Button",
          {
            variant: "tertiary",
            onPress: () => renderEditProperties(item),
          },
          "+ Toevoegen",
        ),
      );
      stack.appendChild(noPropsRow);
    }

    section.appendChild(stack);
    return section;
  }

  // ── Edit properties view ──
  function renderEditProperties(item) {
    action.replaceChildren();

    action.updateProps({
      title: `Eigenschappen — ${item.title}`,
      primaryAction: root.createComponent(
        "Button",
        { onPress: () => renderUI() },
        "Klaar",
      ),
      secondaryAction: root.createComponent(
        "Button",
        { onPress: close },
        "Annuleren",
      ),
    });

    const container = root.createComponent("BlockStack", { gap: "base" });

    container.appendChild(
      root.createComponent(
        "Banner",
        { tone: "info" },
        "Bewerk de eigenschappen van dit item. Klik 'Klaar' om terug te gaan.",
      ),
    );

    function renderPropertyRows() {
      // Remove all children except the banner
      while (container.children.length > 1) {
        container.removeChild(container.children[container.children.length - 1]);
      }

      if (item.properties.length === 0) {
        container.appendChild(
          root.createComponent("Text", { tone: "subdued" }, "Nog geen eigenschappen."),
        );
      }

      for (let pi = 0; pi < item.properties.length; pi++) {
        const prop = item.properties[pi];
        const propIdx = pi;

        const card = root.createComponent("Section", {});
        const row = root.createComponent("BlockStack", { gap: "tight" });

        const fields = root.createComponent("InlineStack", {
          gap: "base",
          blockAlignment: "end",
        });
        fields.appendChild(
          root.createComponent("TextField", {
            label: "Naam",
            value: prop.key,
            onChange: (val) => {
              item.properties[propIdx].key = val;
            },
          }),
        );
        fields.appendChild(
          root.createComponent("TextField", {
            label: "Waarde",
            value: prop.value,
            onChange: (val) => {
              item.properties[propIdx].value = val;
            },
          }),
        );
        fields.appendChild(
          root.createComponent(
            "Button",
            {
              tone: "critical",
              variant: "tertiary",
              onPress: () => {
                item.properties.splice(propIdx, 1);
                renderPropertyRows();
              },
            },
            "Verwijder",
          ),
        );

        row.appendChild(fields);
        card.appendChild(row);
        container.appendChild(card);
      }

      container.appendChild(
        root.createComponent(
          "Button",
          {
            variant: "secondary",
            onPress: () => {
              item.properties.push({ key: "", value: "" });
              renderPropertyRows();
            },
          },
          "+ Eigenschap toevoegen",
        ),
      );
    }

    renderPropertyRows();
    action.appendChild(container);
  }

  // ── Submit to webhook ──
  function handleSubmit() {
    if (lineItems.length === 0) return;

    action.replaceChildren();
    action.updateProps({
      title: `Verzenden — ${order.name}`,
      primaryAction: null,
      secondaryAction: null,
    });

    const sendingStack = root.createComponent("BlockStack", {
      inlineAlignment: "center",
      padding: "large400",
      gap: "base",
    });
    sendingStack.appendChild(
      root.createComponent("ProgressIndicator", { size: "small-200" }),
    );
    sendingStack.appendChild(
      root.createComponent("Text", { tone: "subdued" }, "Order wordt verzonden..."),
    );
    action.appendChild(sendingStack);

    const payload = {
      orderId: order.id,
      orderName: order.name,
      tags: order.tags,
      email: order.email,
      createdAt: order.createdAt,
      customer: order.customer,
      shippingAddress: order.shippingAddress,
      lineItems: lineItems.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        variantId: item.variantId,
        variantTitle: item.variantTitle,
        sku: item.sku,
        price: item.price,
        currency: item.currency,
        properties: item.properties.filter((p) => p.key.trim() !== ""),
      })),
    };

    fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Webhook error: ${res.status}`);
        action.replaceChildren();
        action.updateProps({
          title: `Verzonden — ${order.name}`,
          primaryAction: null,
          secondaryAction: root.createComponent(
            "Button",
            { onPress: close },
            "Sluiten",
          ),
        });
        action.appendChild(
          root.createComponent(
            "Banner",
            { tone: "success" },
            `Order ${order.name} is succesvol opnieuw aangeboden met ${lineItems.length} item(s).`,
          ),
        );
      })
      .catch((e) => {
        action.replaceChildren();
        action.updateProps({
          title: `Fout — ${order.name}`,
          primaryAction: root.createComponent(
            "Button",
            { onPress: handleSubmit },
            "Opnieuw proberen",
          ),
          secondaryAction: root.createComponent(
            "Button",
            { onPress: () => renderUI() },
            "Terug",
          ),
        });
        action.appendChild(
          root.createComponent(
            "Banner",
            { tone: "critical" },
            `Verzenden mislukt: ${e.message}`,
          ),
        );
      });
  }
});
