// app/routes/api.generate-awb.js
// Called from the admin dashboard to generate an AWB for an order
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanCreateAwb } from "../services/fan-courier.server.js";
import { samedayCreateAwb, samedayGetClientPickupPoints, samedayGetServices } from "../services/sameday.server.js";
import { cargusCreateAwb, cargusGetSenderLocations } from "../services/cargus.server.js";
import { glsCreateAwb } from "../services/gls.server.js";
import { packetaCreatePacket } from "../services/packeta.server.js";
import { syncAwbToShopify, writeOrderMetafields } from "../services/xconnector.server.js";
import { updateOrderAwb } from "../models/order.server.js";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const formData = await request.json();
  const {
    orderId, courierOverride, weightOverride, packageCountOverride,
    serviceOverride, observationsOverride,
    openPackage, saturdayDelivery, morningDelivery, insuredValue,
    pickupPointIdOverride, glsParcelShop,
    // New wizard fields
    recipientName, recipientPhone, recipientEmail,
    recipientAddress, recipientCity, recipientCounty, recipientZip, recipientCountry,
    codAmountOverride, declaredValue, shipmentPayer,
    height, width, length,
    cargusReimbursement, swapService,
    notifyCustomer, markAsDispatched,
  } = formData;

  // Load order and settings
  const [order, settings] = await Promise.all([
    prisma.order.findFirst({ where: { shop, id: orderId } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!order) return json({ error: "Order not found" }, { status: 404 });
  if (!settings) return json({ error: "Shop not configured" }, { status: 400 });

  const courier = courierOverride || order.courierType;
  const orderData = {
    ...order,
    // Recipient overrides from wizard Step 2
    customerName:    recipientName    || order.customerName,
    customerPhone:   recipientPhone   || order.customerPhone,
    customerEmail:   recipientEmail   || order.customerEmail,
    shippingAddress1: recipientAddress || order.shippingAddress1,
    shippingCity:    recipientCity    || order.shippingCity,
    shippingCounty:  recipientCounty  || order.shippingCounty,
    shippingZip:     recipientZip     || order.shippingZip,
    shippingCountry: recipientCountry || order.shippingCountry,
    // Content overrides from wizard Step 3
    weight:       weightOverride       || order.weight || settings.defaultWeight || 1,
    packageCount: packageCountOverride || order.packageCount || 1,
    codAmount:    codAmountOverride !== undefined ? parseFloat(codAmountOverride) : order.codAmount,
    shopifyOrderName: order.shopifyOrderName,
  };

  // Effective pickup point: wizard override takes priority over the stored order pickup point
  const effectivePickupId = pickupPointIdOverride || (order.shippingMethod === "pickup_point" ? order.pickupPointId : null);

  // For locker deliveries, look up the stored pickup point so we can use its
  // address/county/city as recipient fields — required by Sameday and GLS even
  // when the package goes to a locker (the APIs still need valid address data).
  let lockerPoint = null;
  if (effectivePickupId) {
    lockerPoint = await prisma.pickupPoint.findFirst({
      where: { courier, externalId: String(effectivePickupId) },
    });
  }

  // For locker deliveries, always use the locker's own city/county — FAN validates that
  // county+locality in the recipient address match the locker's registered location.
  if (lockerPoint) {
    if (lockerPoint.city)    orderData.shippingCity    = lockerPoint.city;
    if (lockerPoint.county)  orderData.shippingCounty  = lockerPoint.county;
    if (!orderData.shippingAddress1) orderData.shippingAddress1 = lockerPoint.address || "";
    if (!orderData.shippingZip)      orderData.shippingZip      = lockerPoint.zip     || "";
  }

  let awbResult;

  try {
    if (courier === "fan") {
      if (!settings.fanClientId || !settings.fanUsername || !settings.fanPassword) {
        return json({ error: "FAN Courier API credentials not configured" }, { status: 400 });
      }

      awbResult = await fanCreateAwb({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
        order: orderData,
        settings,
        pickupPointId: effectivePickupId,
        serviceOverride: serviceOverride || null,
        observations: observationsOverride || null,
        openPackage: !!openPackage,
        shipmentPayer: shipmentPayer || "recipient",
        declaredValue: declaredValue ? parseFloat(declaredValue) : 0,
        saturdayDelivery: !!saturdayDelivery,
      });

    } else if (courier === "sameday") {
      if (!settings.samedayUsername || !settings.samedayPassword) {
        return json({ error: "Sameday API credentials not configured" }, { status: 400 });
      }

      const samedaySandbox = !!settings.samedaySandbox;
      const [senderPickupPoints, services] = await Promise.all([
        samedayGetClientPickupPoints({
          username: settings.samedayUsername,
          password: settings.samedayPassword,
          sandbox:  samedaySandbox,
        }),
        samedayGetServices({
          username: settings.samedayUsername,
          password: settings.samedayPassword,
          sandbox:  samedaySandbox,
        }),
      ]);

      const senderPickupPoint = senderPickupPoints[0];
      if (!senderPickupPoint) {
        return json({ error: "No sender pickup point configured in Sameday. Contact software@sameday.ro" }, { status: 400 });
      }

      const isLocker = !!effectivePickupId;
      const serviceCode = serviceOverride || (isLocker ? "LN" : "T");
      const service = services.find((s) => s.code === serviceCode) || services[0];

      // county/city ID lookup removed — samedayCreateAwb now uses countyString/cityString
      // (plain strings accepted by all Sameday contract types without strict ID validation).
      // For locker delivery, county/city are omitted entirely (oohLastMile identifies destination).

      awbResult = await samedayCreateAwb({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
        sandbox:  samedaySandbox,
        order: orderData,
        settings,
        senderPickupPointId: senderPickupPoint.id,
        lockerDestId: isLocker ? effectivePickupId : null,
        serviceId: service.id,
        serviceCode: service.code,
        openPackage: !!openPackage,
        insuredValue: insuredValue ? parseFloat(insuredValue) : 0,
      });

    } else if (courier === "cargus") {
      if (!settings.cargusSubscriptionKey || !settings.cargusUsername || !settings.cargusPassword) {
        return json({ error: "Cargus API credentials not configured" }, { status: 400 });
      }

      // Get sender's own warehouse locations for the LocationId
      const senderLocations = await cargusGetSenderLocations({
        subscriptionKey: settings.cargusSubscriptionKey,
        username: settings.cargusUsername,
        password: settings.cargusPassword,
      });

      const senderLocation = senderLocations[0];
      if (!senderLocation) {
        return json({ error: "No sender location configured in Cargus. Contact urgentcargus.ro" }, { status: 400 });
      }

      awbResult = await cargusCreateAwb({
        subscriptionKey: settings.cargusSubscriptionKey,
        username: settings.cargusUsername,
        password: settings.cargusPassword,
        order: orderData,
        senderLocationId: senderLocation.LocationId || senderLocation.locationId,
        pudoPointId: effectivePickupId || null,
        serviceIdOverride: serviceOverride || null,
        observations: observationsOverride || null,
        openPackage: !!openPackage,
        saturdayDelivery: !!saturdayDelivery,
        morningDelivery: !!morningDelivery,
        // ShipmentPayer: 1=sender, 2=recipient
        shipmentPayer: shipmentPayer === "sender" ? 1 : 2,
        // Reimbursement: cash vs collecting account
        bankRepayment: cargusReimbursement === "account" ? (orderData.codAmount || 0) : 0,
        cashRepayment: cargusReimbursement === "account" ? 0 : (orderData.codAmount || 0),
      });

    } else if (courier === "gls") {
      if (!settings.glsUsername || !settings.glsPassword) {
        return json({ error: "GLS API credentials not configured" }, { status: 400 });
      }

      awbResult = await glsCreateAwb({
        username: settings.glsUsername,
        password: settings.glsPassword,
        sandbox: !!settings.glsSandbox,
        order: orderData,
        settings,
        clientNumber: parseInt(settings.glsClientNumber) || 0,
        pickupPointId: glsParcelShop ? effectivePickupId : (order.shippingMethod === "pickup_point" ? effectivePickupId : null),
        saturdayDelivery: !!saturdayDelivery,
      });

    } else if (courier === "packeta") {
      if (!settings.packetaApiKey) {
        return json({ error: "Packeta API key not configured" }, { status: 400 });
      }

      awbResult = await packetaCreatePacket({
        apiKey: settings.packetaApiKey,
        order: orderData,
        settings,
        pickupPointId: effectivePickupId,
      });
    }

    if (!awbResult?.success) {
      throw new Error("AWB generation returned unsuccessful result");
    }

    // Update our DB — also persist the actual courier used (wizard may override order.courierType)
    const updatedOrder = await updateOrderAwb(order.id, {
      awbNumber: awbResult.awbNumber,
      awbStatus: "generated",
      courierType: courier,
      // GLS: store the label PDF (already returned by PrintLabels) so download works without GetPrintedLabels
      // Packeta: store the numeric packetId (needed for packetLabelPdf — barcode won't work)
      ...(awbResult.labelBase64 ? { awbPdfUrl: `gls_label:${awbResult.labelBase64}` } :
          awbResult.parcelId    ? { awbPdfUrl: `gls_parcelid:${awbResult.parcelId}` } : {}),
      ...(awbResult.packetId    ? { awbPdfUrl: `packeta_id:${awbResult.packetId}`   } : {}),
    });

    // Sync to Shopify fulfillment (makes xConnector compatible)
    try {
      await syncAwbToShopify({
        adminApiClient: admin,
        shopifyOrderId: order.shopifyOrderId,
        awbNumber: awbResult.awbNumber,
        courierType: courier,
        pickupPointName: order.pickupPointName,
        pickupPointAddress: order.pickupPointAddress,
      });

      await writeOrderMetafields({
        adminApiClient: admin,
        shopifyOrderId: order.shopifyOrderId,
        awbNumber: awbResult.awbNumber,
        courierType: courier,
        pickupPointId: order.pickupPointId,
        pickupPointName: order.pickupPointName,
      });
    } catch (syncError) {
      // Non-fatal — AWB was created, just sync failed
      console.error("Shopify sync error (non-fatal):", syncError?.message || syncError);
    }

    return json({
      success: true,
      awbNumber: awbResult.awbNumber,
      order: updatedOrder,
    });

  } catch (e) {
    console.error("AWB generation error:", e);
    return json({ error: e.message }, { status: 500 });
  }
}
