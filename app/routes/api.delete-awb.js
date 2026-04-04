// app/routes/api.delete-awb.js
// Cancel/delete a previously generated AWB (only possible before courier pickup)
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanDeleteAwb } from "../services/fan-courier.server.js";
import { samedayDeleteAwb } from "../services/sameday.server.js";
import { cargusDeleteAwb } from "../services/cargus.server.js";
import { glsDeleteAwb } from "../services/gls.server.js";
import { packetaDeletePacket } from "../services/packeta.server.js";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const { orderId } = await request.json();
  if (!orderId) return json({ error: "Missing orderId" }, { status: 400 });

  const [order, settings] = await Promise.all([
    prisma.order.findFirst({ where: { shop, id: orderId } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!order) return json({ error: "Order not found" }, { status: 404 });
  if (!order.awbNumber) return json({ error: "No AWB to delete" }, { status: 400 });

  const courier = order.courierType;

  try {
    if (courier === "fan") {
      await fanDeleteAwb({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
        awbNumber: order.awbNumber,
      });

    } else if (courier === "sameday") {
      await samedayDeleteAwb({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
        sandbox: !!settings.samedaySandbox,
        awbNumber: order.awbNumber,
      });

    } else if (courier === "cargus") {
      await cargusDeleteAwb({
        subscriptionKey: settings.cargusSubscriptionKey,
        username: settings.cargusUsername,
        password: settings.cargusPassword,
        awbNumber: order.awbNumber,
      });

    } else if (courier === "gls") {
      // GLS deletion requires the ParcelId (database ID), not the barcode
      // We stored it as "gls_parcelid:{id}" in awbPdfUrl
      const parcelIdStr = order.awbPdfUrl?.startsWith("gls_parcelid:")
        ? order.awbPdfUrl.replace("gls_parcelid:", "")
        : null;
      if (!parcelIdStr) {
        return json({ error: "GLS ParcelId not found — cannot delete" }, { status: 400 });
      }
      await glsDeleteAwb({
        username: settings.glsUsername,
        password: settings.glsPassword,
        sandbox: !!settings.glsSandbox,
        parcelId: parseInt(parcelIdStr),
      });

    } else if (courier === "packeta") {
      const packetId = order.awbPdfUrl?.startsWith("packeta_id:")
        ? order.awbPdfUrl.replace("packeta_id:", "")
        : order.awbNumber;
      await packetaDeletePacket({
        apiKey: settings.packetaApiKey,
        packetId,
      });

    } else {
      return json({ error: `Unsupported courier: ${courier}` }, { status: 400 });
    }

    // Clear AWB from DB
    await prisma.order.update({
      where: { id: orderId },
      data: {
        awbNumber: null,
        awbStatus: "pending",
        awbPdfUrl: null,
      },
    });

    return json({ success: true });

  } catch (e) {
    console.error("Delete AWB error:", e);
    return json({ error: e.message }, { status: 500 });
  }
}
