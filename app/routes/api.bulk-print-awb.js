// app/routes/api.bulk-print-awb.js
// Fetches PDFs for multiple orders and merges them into a single download
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { PDFDocument } from "pdf-lib";
import { fetchLabelPdf } from "../services/labels.server.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const url = new URL(request.url);
  const orderIds = url.searchParams.get("orderIds")?.split(",").filter(Boolean);
  if (!orderIds?.length) return new Response("Missing orderIds", { status: 400 });

  const [orders, settings] = await Promise.all([
    prisma.order.findMany({
      where: { shop, id: { in: orderIds }, awbNumber: { not: null } },
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!orders.length) return new Response("No orders with AWBs found", { status: 400 });

  const merged = await PDFDocument.create();
  const errors = [];

  // Fetch PDFs with concurrency limit of 3
  const chunks = [];
  for (let i = 0; i < orders.length; i += 3) chunks.push(orders.slice(i, i + 3));

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (order) => {
        try {
          const pdfBytes = await fetchLabelPdf(order, settings);
          const doc = await PDFDocument.load(pdfBytes);
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach((p) => merged.addPage(p));
        } catch (e) {
          errors.push(`${order.shopifyOrderName}: ${e.message}`);
        }
      })
    );
  }

  if (merged.getPageCount() === 0) {
    return new Response(`No PDFs could be fetched. Errors: ${errors.join("; ")}`, { status: 502 });
  }

  const pdfBytes = await merged.save();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `AWB_bulk_${date}_${orders.length}buc.pdf`;

  return new Response(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBytes.length),
    },
  });
}
