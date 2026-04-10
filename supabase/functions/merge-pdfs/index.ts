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
    const body = await req.json();
    const { urls, pdfs } = body;

    const hasUrls = Array.isArray(urls) && urls.length > 0;
    const hasPdfs = Array.isArray(pdfs) && pdfs.length > 0;

    if (!hasUrls && !hasPdfs) {
      return new Response(
        JSON.stringify({
          error:
            'Provide { urls: ["..."] } for URL-based merge, { pdfs: ["base64..."] } for base64 merge, or both.',
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const mergedPdf = await PDFDocument.create();

    // Merge from URLs
    if (hasUrls) {
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
        const copiedPages = await mergedPdf.copyPages(
          sourcePdf,
          sourcePdf.getPageIndices()
        );
        for (const page of copiedPages) mergedPdf.addPage(page);
      }
    }

    // Merge from base64
    if (hasPdfs) {
      for (let i = 0; i < pdfs.length; i++) {
        const raw = pdfs[i].replace(/^data:application\/pdf;base64,/, "");
        const binary = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
        const sourcePdf = await PDFDocument.load(binary);
        const copiedPages = await mergedPdf.copyPages(
          sourcePdf,
          sourcePdf.getPageIndices()
        );
        for (const page of copiedPages) mergedPdf.addPage(page);
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
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
