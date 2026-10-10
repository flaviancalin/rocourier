// app/routes/api.print-awb.js
// Download and stream the AWB label PDF for any courier
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fetchLabelPdf } from "../services/labels.server.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  // Return label: same courier modules, with the return AWB
  const returnId = url.searchParams.get("returnId");
  if (returnId) {
    const [rr, s] = await Promise.all([
      prisma.returnRequest.findFirst({ where: { shop, id: returnId } }),
      prisma.shopSettings.findUnique({ where: { shop } }),
    ]);
    if (!rr?.returnAwbNumber) return new Response("No return AWB", { status: 404 });
    try {
      const pdf = await fetchLabelPdf({ courierType: rr.returnCourier, awbNumber: rr.returnAwbNumber, awbPdfUrl: null }, s);
      return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="RETUR_${rr.returnAwbNumber}.pdf"` } });
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  }

  if (!orderId) {
    return new Response("Missing orderId", { status: 400 });
  }

  const [order, settings] = await Promise.all([
    prisma.order.findFirst({ where: { shop, id: orderId } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!order) return new Response("Order not found", { status: 404 });
  if (!order.awbNumber) return new Response("No AWB generated", { status: 400 });

  const courier = order.courierType;

  try {
    const pdfBuffer = await fetchLabelPdf(order, settings);

    const filename = `AWB_${order.awbNumber}_${courier}.pdf`;
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });

  } catch (e) {
    console.error("Print AWB error:", e);
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}
