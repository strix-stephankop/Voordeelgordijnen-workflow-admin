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

    // Line items
    for (let idx = 0; idx < lineItems.length; idx++) {
      if (idx > 0) container.appendChild(root.createComponent("Divider", {}));
      container.appendChild(renderLineItem(lineItems[idx]));
    }

    // Action buttons at the bottom
    const buttonRow = root.createComponent("InlineStack", {
      gap: "base",
      inlineAlignment: "end",
    });
    buttonRow.appendChild(
      root.createComponent(
        "Button",
        { onPress: close },
        "Annuleren",
      ),
    );
    buttonRow.appendChild(
      root.createComponent(
        "Button",
        {
          variant: "primary",
          onPress: handleSubmit,
          disabled: lineItems.length === 0,
        },
        "Bevestig & bied aan",
      ),
    );
    container.appendChild(buttonRow);

    action.appendChild(container);
  }

  // ── Single line item row ──
  function renderLineItem(item) {
    const wrapper = root.createComponent("BlockStack", { gap: "tight" });

    // Header: Title + Remove button
    const headerRow = root.createComponent("InlineStack", {
      gap: "base",
      blockAlignment: "center",
      inlineAlignment: "space-between",
    });
    headerRow.appendChild(
      root.createComponent("Text", { fontWeight: "bold" }, item.title),
    );
    headerRow.appendChild(
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
        "Verwijder",
      ),
    );
    wrapper.appendChild(headerRow);

    // Variant info
    const variantText = [item.variantTitle, item.sku && `SKU: ${item.sku}`]
      .filter(Boolean)
      .join(" · ");
    if (variantText) {
      wrapper.appendChild(
        root.createComponent("Text", { tone: "subdued" }, variantText),
      );
    }

    // Properties
    const visibleProps = (item.properties || []).filter((p) => p.key);
    if (visibleProps.length > 0) {
      const propsBlock = root.createComponent("BlockStack", { gap: "extraTight" });
      for (const prop of visibleProps) {
        propsBlock.appendChild(
          root.createComponent("Text", { tone: "subdued" }, `${prop.key}: ${prop.value}`),
        );
      }
      wrapper.appendChild(propsBlock);
    }

    // Action buttons: Edit properties
    const actionsRow = root.createComponent("InlineStack", {
      gap: "base",
      blockAlignment: "center",
    });
    actionsRow.appendChild(
      root.createComponent(
        "Button",
        {
          variant: "tertiary",
          onPress: () => renderEditProperties(item),
        },
        visibleProps.length > 0
          ? `Bewerk eigenschappen (${visibleProps.length})`
          : "+ Eigenschappen toevoegen",
      ),
    );
    wrapper.appendChild(actionsRow);

    return wrapper;
  }

  // ── Edit properties view ──
  function renderEditProperties(item) {
    action.replaceChildren();

    action.updateProps({
      title: `Eigenschappen — ${item.title}`,
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

    // Back button
    const backRow = root.createComponent("InlineStack", {
      gap: "base",
      inlineAlignment: "end",
    });
    backRow.appendChild(
      root.createComponent(
        "Button",
        { variant: "primary", onPress: () => renderUI() },
        "Klaar",
      ),
    );
    container.appendChild(backRow);

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
