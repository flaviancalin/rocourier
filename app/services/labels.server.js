// app/services/labels.server.js
// AWB label PDF for any courier — shared by single and bulk printing.
import { fanPrintAwb } from "./fan-courier.server.js";
import { samedayDownloadAwbPdf } from "./sameday.server.js";
import { cargusDownloadAwbPdf } from "./cargus.server.js";
import { glsDownloadAwbPdf } from "./gls.server.js";
import { packetaDownloadLabel, packetaCredentials } from "./packeta.server.js";
import { dpdPrintAwb } from "./dpd.server.js";

// awbPdfUrl holds courier-specific references, e.g. "packeta_id:123" or "dpd_parcels:1,2"
const ref = (order, prefix) => (order.awbPdfUrl?.startsWith(prefix) ? order.awbPdfUrl.slice(prefix.length) : null);

export async function fetchLabelPdf(order, s) {
  const awbNumber = order.awbNumber;
  switch (order.courierType) {
    case "fan":
      return fanPrintAwb({ clientId: s.fanClientId, username: s.fanUsername, password: s.fanPassword, awbNumber });
    case "sameday":
      return samedayDownloadAwbPdf({ username: s.samedayUsername, password: s.samedayPassword, sandbox: !!s.samedaySandbox, awbNumber });
    case "cargus":
      return cargusDownloadAwbPdf({ subscriptionKey: s.cargusSubscriptionKey, username: s.cargusUsername, password: s.cargusPassword, awbNumber });
    case "gls": {
      const stored = ref(order, "gls_label:");
      if (stored) return Buffer.from(stored, "base64");   // label saved when the AWB was created
      return glsDownloadAwbPdf({ username: s.glsUsername, password: s.glsPassword, sandbox: !!s.glsSandbox, awbNumber });
    }
    case "packeta": {
      const [packetId, kind] = (ref(order, "packeta_id:") || awbNumber).split(":");
      return packetaDownloadLabel({
        ...packetaCredentials(s), packetId, format: s.packetaLabelFormat || "A6 on A4",
        // home delivery → the carrier's label; points / Z-BOX → Packeta label
        homeDelivery: kind === "hd" || order.shippingMethod !== "pickup_point",
      });
    }
    case "dpd":
      return dpdPrintAwb({
        username: s.dpdUsername, password: s.dpdPassword, awbNumber,
        parcelIds: (ref(order, "dpd_parcels:") || "").split(",").filter(Boolean),
        paperSize: s.dpdLabelSize || "A6",
      });
    default:
      throw new Error(`Unsupported courier: ${order.courierType}`);
  }
}
