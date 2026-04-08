import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const NAV_PAGES = [
  { key: "orders", to: "/app/orders", label: "Webattelier" },
  { key: "kleurstalen", to: "/app/kleurstalen", label: "Kleurstalen" },
  { key: "nedistri", to: "/app/nedistri", label: "NE Distri" },
  { key: "grandhome", to: "/app/grandhome", label: "Grand Home" },
  { key: "hkl", to: "/app/hkl", label: "HKL" },
  { key: "sync-checks", to: "/app/sync-checks", label: "Sync Checks" },
  { key: "executions", to: "/app/executions", label: "Executions" },
  { key: "softr", to: "/app/softr", label: "Softr" },
  { key: "fabric-usage", to: "/app/fabric-usage", label: "Stofverbruik" },
  { key: "metafield-check", to: "/app/metafield-check", label: "Metafield Check" },
];

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  let pageVisibility = {};
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "page_visibility" },
    });
    if (setting?.value) pageVisibility = JSON.parse(setting.value);
  } catch {}

  return { apiKey: process.env.SHOPIFY_API_KEY || "", pageVisibility };
};

export default function App() {
  const { apiKey, pageVisibility } = useLoaderData();

  const visiblePages = NAV_PAGES.filter(
    (p) => pageVisibility[p.key] !== false,
  );

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Orders
        </Link>
        {visiblePages.map((p) => (
          <Link key={p.key} to={p.to}>{p.label}</Link>
        ))}
        <Link to="/app/settings">Instellingen</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
