import { extension } from "@shopify/ui-extensions/admin";

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) {
      name
    }
  }
`;

export default extension("admin.order-details.action.render", (root, api) => {
  const { close, data } = api;
  const orderId = data.selected?.[0]?.id;

  const action = root.createComponent("AdminAction", {
    title: "Open in Workflow Admin",
  });
  const loading = root.createComponent("BlockStack", {
    inlineAlignment: "center",
    padding: "large400",
  });
  loading.appendChild(
    root.createComponent("ProgressIndicator", { size: "small-200" })
  );
  action.appendChild(loading);
  root.appendChild(action);

  if (!orderId) {
    action.removeChild(loading);
    action.appendChild(
      root.createComponent("Banner", { tone: "critical" }, "Order not found")
    );
    return;
  }

  fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query: ORDER_QUERY, variables: { id: orderId } }),
  })
    .then((res) => res.json())
    .then((json) => {
      const order = json.data?.order;
      action.removeChild(loading);

      if (!order) {
        action.replaceChildren(
          root.createComponent("Banner", { tone: "critical" }, "Order not found")
        );
        return;
      }

      const orderNumber = order.name.replace(/^#/, "");

      action.updateProps({
        title: "Open in Workflow Admin",
        primaryAction: root.createComponent(
          "Link",
          { href: `app:?q=${orderNumber}` },
          `Open ${order.name}`
        ),
        secondaryAction: root.createComponent(
          "Button",
          { onPress: close },
          "Close"
        ),
      });
    })
    .catch((e) => {
      action.removeChild(loading);
      action.appendChild(
        root.createComponent("Banner", { tone: "critical" }, e.message)
      );
    });
});
