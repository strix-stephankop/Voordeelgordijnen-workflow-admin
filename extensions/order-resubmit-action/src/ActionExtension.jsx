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
        "Geen toegang tot orders. Ga naar Shopify Admin > Settings > Apps > Vogo workflow admin en klik 'Herinstalleren' om scopes bij te werken.",
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

  function renderUI() {
    action.replaceChildren();

    action.updateProps({
      title: `Bied opnieuw aan — ${order.name}`,
      primaryAction: root.createComponent(
        "Button",
        { onPress: handleSubmit, disabled: lineItems.length === 0 },
        "Bevestig & bied aan",
      ),
      secondaryAction: root.createComponent(
        "Button",
        { onPress: close },
        "Annuleren",
      ),
    });

    const container = root.createComponent("BlockStack", { gap: "base" });

    if (lineItems.length === 0) {
      container.appendChild(
        root.createComponent(
          "Banner",
          { tone: "warning" },
          "Alle line items zijn verwijderd.",
        ),
      );
    }

    for (const item of lineItems) {
      const section = root.createComponent("Section", {});
      const sectionStack = root.createComponent("BlockStack", { gap: "base" });

      const headerRow = root.createComponent("InlineStack", {
        gap: "base",
        blockAlignment: "center",
        inlineAlignment: "space-between",
      });

      const titleStack = root.createComponent("BlockStack", { gap: "extraTight" });
      titleStack.appendChild(
        root.createComponent("Text", { fontWeight: "bold" }, item.title),
      );
      titleStack.appendChild(
        root.createComponent(
          "Text",
          {},
          [item.variantTitle, item.sku && `SKU: ${item.sku}`]
            .filter(Boolean)
            .join(" — ") || "Geen variant",
        ),
      );
      headerRow.appendChild(titleStack);

      headerRow.appendChild(
        root.createComponent(
          "Button",
          {
            tone: "critical",
            onPress: () => {
              lineItems = lineItems.filter((li) => li._key !== item._key);
              renderUI();
            },
          },
          "Verwijder",
        ),
      );
      sectionStack.appendChild(headerRow);

      const detailsRow = root.createComponent("InlineStack", {
        gap: "base",
        blockAlignment: "center",
      });
      detailsRow.appendChild(
        root.createComponent("NumberField", {
          label: "Aantal",
          value: item.quantity,
          min: 1,
          onChange: (val) => {
            item.quantity = Math.max(1, val);
          },
        }),
      );
      detailsRow.appendChild(
        root.createComponent("TextField", {
          label: "Prijs",
          value: item.price,
          readOnly: true,
        }),
      );
      sectionStack.appendChild(detailsRow);

      const propsStack = root.createComponent("BlockStack", { gap: "tight" });

      if (item.properties.length > 0) {
        for (const prop of item.properties.slice(0, 3)) {
          propsStack.appendChild(
            root.createComponent("Text", {}, `${prop.key}: ${prop.value}`),
          );
        }
        if (item.properties.length > 3) {
          propsStack.appendChild(
            root.createComponent("Text", {}, `+ ${item.properties.length - 3} meer...`),
          );
        }
      } else {
        propsStack.appendChild(
          root.createComponent("Text", {}, "Geen eigenschappen"),
        );
      }

      propsStack.appendChild(
        root.createComponent(
          "Button",
          { onPress: () => renderEditProperties(item) },
          `Bewerk eigenschappen (${item.properties.length})`,
        ),
      );

      sectionStack.appendChild(propsStack);
      section.appendChild(sectionStack);
      container.appendChild(section);
    }

    action.appendChild(container);
  }

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

    function renderPropertyRows() {
      container.replaceChildren();

      for (let pi = 0; pi < item.properties.length; pi++) {
        const prop = item.properties[pi];
        const propIdx = pi;

        const row = root.createComponent("InlineStack", {
          gap: "tight",
          blockAlignment: "center",
        });
        row.appendChild(
          root.createComponent("TextField", {
            label: "Naam",
            value: prop.key,
            onChange: (val) => {
              item.properties[propIdx].key = val;
            },
          }),
        );
        row.appendChild(
          root.createComponent("TextField", {
            label: "Waarde",
            value: prop.value,
            onChange: (val) => {
              item.properties[propIdx].value = val;
            },
          }),
        );
        row.appendChild(
          root.createComponent(
            "Button",
            {
              tone: "critical",
              onPress: () => {
                item.properties.splice(propIdx, 1);
                renderPropertyRows();
              },
            },
            "X",
          ),
        );
        container.appendChild(row);
      }

      container.appendChild(
        root.createComponent(
          "Button",
          {
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

  function handleSubmit() {
    if (lineItems.length === 0) return;

    action.replaceChildren();
    action.updateProps({
      title: "Verzenden...",
      primaryAction: null,
      secondaryAction: null,
    });
    const sendingStack = root.createComponent("BlockStack", {
      inlineAlignment: "center",
      padding: "large400",
    });
    sendingStack.appendChild(
      root.createComponent("ProgressIndicator", { size: "small-200" }),
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

    const webhookUrl =
      "https://voordeelgordijnen.n8n.sition.cloud/webhook/252b1295-0a82-4ce5-bfdc-8c66501fef9b";

    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Webhook error: ${res.status}`);
        action.replaceChildren();
        action.updateProps({
          title: "Bied opnieuw aan",
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
            `Order ${order.name} is opnieuw aangeboden.`,
          ),
        );
      })
      .catch((e) => {
        action.replaceChildren();
        action.updateProps({
          title: "Bied opnieuw aan",
          primaryAction: root.createComponent(
            "Button",
            { onPress: () => renderUI() },
            "Terug",
          ),
          secondaryAction: root.createComponent(
            "Button",
            { onPress: close },
            "Sluiten",
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
