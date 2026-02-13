import { useEffect, useState } from "react";
import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  Button,
  Banner,
  Link,
  ProgressIndicator,
} from "@shopify/ui-extensions-react/admin";

const TARGET = "admin.order-details.action.render";

export default reactExtension(TARGET, () => <App />);

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) {
      name
    }
  }
`;

function App() {
  const { close, data } = useApi(TARGET);
  const orderId = data.selected?.[0]?.id;

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      try {
        const res = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify({ query: ORDER_QUERY, variables: { id: orderId } }),
        });
        const json = await res.json();
        const orderData = json.data?.order;
        if (!orderData) throw new Error("Order not found");
        setOrder(orderData);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  if (loading) {
    return (
      <AdminAction title="Open in Workflow Admin">
        <BlockStack inlineAlignment="center" padding="large400">
          <ProgressIndicator size="small-200" />
        </BlockStack>
      </AdminAction>
    );
  }

  if (error || !order) {
    return (
      <AdminAction
        title="Open in Workflow Admin"
        secondaryAction={<Button onPress={close}>Close</Button>}
      >
        <Banner tone="critical">{error || "Order not found"}</Banner>
      </AdminAction>
    );
  }

  const orderNumber = order.name.replace(/^#/, "");

  return (
    <AdminAction
      title="Open in Workflow Admin"
      primaryAction={<Link href={`app:?q=${orderNumber}`}>Open {order.name}</Link>}
      secondaryAction={<Button onPress={close}>Close</Button>}
    />
  );
}
