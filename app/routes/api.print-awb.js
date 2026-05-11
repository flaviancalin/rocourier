// app/routes/api.print-awb.js
// Download and stream the AWB label PDF for any courier
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanPrintAwb } from "../services/fan-courier.server.js";
import { samedayDownloadAwbPdf } from "../services/sameday.server.js";
import { cargusDownloadAwbPdf } from "../services/cargus.server.js";
import { glsDownloadAwbPdf } from "../services/gls.server.js";
import { packetaDownloadLabel } from "../services/packeta.server.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
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
    let pdfBuffer;

    if (courier === "fan") {
      pdfBuffer = await fanPrintAwb({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
        awbNumber: order.awbNumber,
      });

    } else if (courier === "sameday") {
      pdfBuffer = await samedayDownloadAwbPdf({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
        sandbox: !!settings.samedaySandbox,
        awbNumber: order.awbNumber,
      });

    } else if (courier === "cargus") {
      pdfBuffer = await cargusDownloadAwbPdf({
        subscriptionKey: settings.cargusSubscriptionKey,
        username: settings.cargusUsername,
        password: settings.cargusPassword,
        awbNumber: order.awbNumber,
      });

    } else if (courier === "gls") {
      pdfBuffer = await glsDownloadAwbPdf({
        username: settings.glsUsername,
        password: settings.glsPassword,
        sandbox: !!settings.glsSandbox,
        awbNumber: order.awbNumber,
      });

    } else if (courier === "packeta") {
      // Packeta needs packetId — stored as awbNumber (barcode) but label needs the id
      // The packetId is stored in the awbPdfUrl field if present, else use awbNumber
      const packetId = order.awbPdfUrl?.startsWith("packeta_id:")
        ? order.awbPdfUrl.replace("packeta_id:", "")
        : order.awbNumber;
      pdfBuffer = await packetaDownloadLabel({
        apiKey: settings.packetaApiKey,
        packetId,
      });

    } else {
      return new Response(`Unsupported courier: ${courier}`, { status: 400 });
    }

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
