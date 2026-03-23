import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, x-client-info, apikey",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { urls } = await req.json();

    if (!Array.isArray(urls) || urls.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Provide a non-empty array of PDF URLs in { urls: [...] }",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const mergedPdf = await PDFDocument.create();

    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) {
        return new Response(
          JSON.stringify({
            error: `Failed to fetch PDF from ${url}: ${response.statusText}`,
          }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        );
      }

      const pdfBytes = await response.arrayBuffer();
      const sourcePdf = await PDFDocument.load(pdfBytes);
      const pageIndices = sourcePdf.getPageIndices();
      const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);

      for (const page of copiedPages) {
        mergedPdf.addPage(page);
      }
    }

    const mergedBytes = await mergedPdf.save();

    return new Response(mergedBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="merged.pdf"',
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
