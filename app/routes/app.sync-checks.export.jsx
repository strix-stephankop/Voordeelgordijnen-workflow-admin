import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { queryAllSyncChecksByDate, queryAllSyncChecksByDateRange } from "../supabase.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  try {
    let data;
    if (dateFrom && dateTo) {
      data = await queryAllSyncChecksByDateRange(dateFrom, dateTo);
    } else if (date) {
      data = await queryAllSyncChecksByDate(date);
    } else {
      return json([], { status: 400 });
    }
    return json(data);
  } catch (e) {
    console.error("Failed to load sync checks for export:", e.message);
    return json([], { status: 500 });
  }
};
