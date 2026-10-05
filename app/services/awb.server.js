// app/services/awb.server.js
// Deletes an AWB at the courier, cancels the Shopify fulfillment that carries it
// and clears it from the order. Used by the "Delete AWB" button and by automations.
import { prisma } from "../db.server.js";
import { fanDeleteAwb, fanCreateAwb } from "./fan-courier.server.js";
import { samedayDeleteAwb, samedayCreateAwb, samedayGetClientPickupPoints, samedayGetServices } from "./sameday.server.js";
import { cargusDeleteAwb, cargusCreateAwb, cargusGetSenderLocations } from "./cargus.server.js";
import { glsDeleteAwb, glsCreateAwb } from "./gls.server.js";
import { packetaDeletePacket, packetaCreatePacket } from "./packeta.server.js";
import { cancelFulfillmentsForAwb } from "./fulfillment.server.js";
import { syncAwbToShopify, writeOrderMetafields } from "./xconnector.server.js";
import { updateOrderAwb } from "../models/order.server.js";

export async function deleteAwbForOrder(admin, order, settings) {
  if (!order.awbNumber) throw new Error("No AWB to delete");
  const courier = order.courierType;

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
      throw new Error("GLS ParcelId not found — cannot delete");
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
    throw new Error(`Unsupported courier: ${courier}`);
  }


  // The order shouldn't stay "fulfilled" with tracking for an AWB that no longer exists
  if (admin) {
    try {
      await cancelFulfillmentsForAwb(admin, order.shopifyOrderId, order.awbNumber);
    } catch (e) {
      console.error("Cancel fulfillment after AWB delete failed:", e.message);
    }
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { awbNumber: null, awbStatus: "pending", awbPdfUrl: null },
  });
}

// ── Generate ────────────────────────────────────────────────────────────────
// Shared by the AWB wizard (api.generate-awb) and automatic AWB on new orders.
// `options` are the wizard fields (all optional). Throws AwbError with an HTTP status.
export class AwbError extends Error {
  constructor(message, status = 500, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const awbError = (message, status, extra) => new AwbError(message, status, extra);

export async function generateAwbForOrder(admin, shop, orderId, options = {}) {
  const {
    courierOverride, weightOverride, packageCountOverride,
    serviceOverride, observationsOverride,
    openPackage, saturdayDelivery, morningDelivery, insuredValue,
    pickupPointIdOverride, glsParcelShop,
    recipientName, recipientPhone, recipientEmail,
    recipientAddress, recipientCity, recipientCounty, recipientZip, recipientCountry,
    codAmountOverride, declaredValue, shipmentPayer,
    cargusReimbursement,
    notifyCustomer, markAsDispatched,
  } = options;

  // Load order and settings
  const [order, settings] = await Promise.all([
    prisma.order.findFirst({ where: { shop, id: orderId } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!order) throw awbError("Order not found", 404);
  if (!settings) throw awbError("Shop not configured", 400);

  // ── Trial / plan gate ────────────────────────────────────────────────────────
  const TRIAL_LIMIT = 10;
  if (settings.planType === "trial" && settings.awbCount >= TRIAL_LIMIT) {
    throw awbError(`Trial limit reached (${TRIAL_LIMIT} free AWBs). Please upgrade to a Pro plan to continue.`, 402, { requiresUpgrade: true });
  }

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
    else if (lockerPoint.address) {
      // County is null in DB — try to extract it from the formatted address string
      // Format stored at sync time: "Street Name, City, County"
      const addrParts = lockerPoint.address.split(",").map((s) => s.trim()).filter(Boolean);
      if (addrParts.length >= 2) orderData.shippingCounty = addrParts[addrParts.length - 1];
    }
    if (!orderData.shippingAddress1) orderData.shippingAddress1 = lockerPoint.address || "";
    if (!orderData.shippingZip)      orderData.shippingZip      = lockerPoint.zip     || "";
  }
  console.log(`[AWB] locker county="${orderData.shippingCounty}" city="${orderData.shippingCity}" from lockerPoint.county="${lockerPoint?.county}" lockerPoint.city="${lockerPoint?.city}"`);

  let awbResult;

  {
    if (courier === "fan") {
      if (!settings.fanClientId || !settings.fanUsername || !settings.fanPassword) {
        throw awbError("FAN Courier API credentials not configured", 400);
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
        throw awbError("Sameday API credentials not configured", 400);
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
        throw awbError("No sender pickup point configured in Sameday. Contact software@sameday.ro", 400);
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
        throw awbError("Cargus API credentials not configured", 400);
      }

      // Get sender's own warehouse locations for the LocationId
      const senderLocations = await cargusGetSenderLocations({
        subscriptionKey: settings.cargusSubscriptionKey,
        username: settings.cargusUsername,
        password: settings.cargusPassword,
      });

      const senderLocation = senderLocations[0];
      if (!senderLocation) {
        throw awbError("No sender location configured in Cargus. Contact urgentcargus.ro", 400);
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
        throw awbError("GLS API credentials not configured", 400);
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
        throw awbError("Packeta API key not configured", 400);
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

    // Increment AWB counter (used for trial gate)
    await prisma.shopSettings.update({
      where: { shop },
      data: { awbCount: { increment: 1 } },
    });

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
        markAsDispatched:   markAsDispatched === true || markAsDispatched === "true",
        notifyCustomer:     notifyCustomer === true || notifyCustomer === "true",
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


    return { awbNumber: awbResult.awbNumber, order: updatedOrder };
  }
}
