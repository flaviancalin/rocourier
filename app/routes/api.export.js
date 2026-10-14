// app/routes/api.export.js — accounting files for a month: ?type=sales|cod|shipping|saga-receipts|saga-invoices&month=YYYY-MM
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { monthRange, salesCsv, codCsv, shippingCsv, sagaReceiptsXml, sagaInvoicesXml, companyCif } from "../services/accounting-export.server.js";
import { logActivity } from "../services/activity.server.js";

const file = (body, name, type) => new Response(body, {
  headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
});

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const range = monthRange(url.searchParams.get("month"));
  const shop = session.shop;
  let res;
  switch (type) {
    case "sales": res = file(await salesCsv(shop, range), `vanzari-${range.label}.csv`, "text/csv"); break;
    case "cod": res = file(await codCsv(shop, range), `ramburs-${range.label}.csv`, "text/csv"); break;
    case "shipping": res = file(await shippingCsv(shop, range), `transport-${range.label}.csv`, "text/csv"); break;
    case "saga-receipts": res = file(await sagaReceiptsXml(shop, range), `I_${range.label}.xml`, "application/xml"); break;
    case "saga-invoices": {
      const settings = await prisma.shopSettings.findUnique({ where: { shop } });
      const { xml } = await sagaInvoicesXml(admin, shop, range);
      res = file(xml, `F_${companyCif(settings) || "CIF"}_${range.label}.xml`, "application/xml");
      break;
    }
    default: return new Response("Tip de export necunoscut", { status: 400 });
  }
  await logActivity({ shop, action: "export", actor: session.onlineAccessInfo?.associated_user?.email || "staff", message: `Export ${type} ${range.label}` }).catch(() => {});
  return res;
}
