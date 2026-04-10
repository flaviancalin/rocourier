// app/routes/api.bulk-print-awb.js
// Fetches PDFs for multiple orders and merges them into a single download
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { PDFDocument } from "pdf-lib";
import { fanPrintAwb } from "../services/fan-courier.server.js";
import { samedayDownloadAwbPdf } from "../services/sameday.server.js";
import { cargusDownloadAwbPdf } from "../services/cargus.server.js";
import { glsDownloadAwbPdf } from "../services/gls.server.js";
import { packetaDownloadLabel } from "../services/packeta.server.js";

async function fetchPdf(order, settings) {
  const courier = order.courierType;

  if (courier === "fan") {
    const result = await fanPrintAwb({
      clientId: settings.fanClientId,
      username: settings.fanUsername,
      password: settings.fanPassword,
      awbNumber: order.awbNumber,
    });
    if (result?.pdf) return Buffer.from(result.pdf, "base64");
    if (result?.pdfUrl) {
      const res = await fetch(result.pdfUrl);
      return Buffer.from(await res.arrayBuffer());
    }
    throw new Error("FAN: no PDF data");
  }

  if (courier === "sameday") {
    return samedayDownloadAwbPdf({
      username: settings.samedayUsername,
      password: settings.samedayPassword,
      sandbox: !!settings.samedaySandbox,
      awbNumber: order.awbNumber,
    });
  }

  if (courier === "cargus") {
    return cargusDownloadAwbPdf({
      subscriptionKey: settings.cargusSubscriptionKey,
      username: settings.cargusUsername,
      password: settings.cargusPassword,
      awbNumber: order.awbNumber,
    });
  }

  if (courier === "gls") {
    return glsDownloadAwbPdf({
      username: settings.glsUsername,
      password: settings.glsPassword,
      sandbox: !!settings.glsSandbox,
      awbNumber: order.awbNumber,
    });
  }

  if (courier === "packeta") {
    const packetId = order.awbPdfUrl?.startsWith("packeta_id:")
      ? order.awbPdfUrl.replace("packeta_id:", "")
      : order.awbNumber;
    return packetaDownloadLabel({ apiKey: settings.packetaApiKey, packetId });
  }

  throw new Error(`Unsupported courier: ${courier}`);
}

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
          const pdfBytes = await fetchPdf(order, settings);
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
