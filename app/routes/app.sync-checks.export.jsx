import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { queryAllSyncChecksByDate } from "../supabase.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return json([], { status: 400 });
  }

  try {
    const data = await queryAllSyncChecksByDate(date);
    return json(data);
  } catch (e) {
    console.error("Failed to load sync checks for export:", e.message);
    return json([], { status: 500 });
  }
};
