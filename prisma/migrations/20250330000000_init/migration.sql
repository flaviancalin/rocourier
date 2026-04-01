-- prisma/migrations/20250330000000_init/migration.sql
-- RoCourier Initial Migration
-- Run with: npx prisma migrate dev --name init

-- Session storage (Shopify requirement)
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- Shop settings
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "fanClientId" TEXT,
    "fanUsername" TEXT,
    "fanPassword" TEXT,
    "fanToken" TEXT,
    "fanTokenExp" TIMESTAMP(3),
    "fanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "samedayUsername" TEXT,
    "samedayPassword" TEXT,
    "samedayToken" TEXT,
    "samedayTokenExp" TIMESTAMP(3),
    "samedayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "xconnectorApiKey" TEXT,
    "xconnectorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "senderName" TEXT,
    "senderCity" TEXT,
    "senderZip" TEXT,
    "senderAddress" TEXT,
    "senderPhone" TEXT,
    "senderEmail" TEXT,
    "senderCounty" TEXT DEFAULT 'Bucuresti',
    "defaultWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "defaultCourier" TEXT NOT NULL DEFAULT 'fan',
    "autoGenerateAwb" BOOLEAN NOT NULL DEFAULT false,
    "widgetPosition" TEXT NOT NULL DEFAULT 'before_checkout',
    "codSurcharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "showPickupMap" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- Orders
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "shopifyOrderToken" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "shippingAddress1" TEXT,
    "shippingCity" TEXT,
    "shippingCounty" TEXT,
    "shippingZip" TEXT,
    "shippingCountry" TEXT DEFAULT 'RO',
    "shippingMethod" TEXT NOT NULL DEFAULT 'home_delivery',
    "courierType" TEXT NOT NULL DEFAULT 'fan',
    "pickupPointId" TEXT,
    "pickupPointName" TEXT,
    "pickupPointAddress" TEXT,
    "awbNumber" TEXT,
    "awbPdfUrl" TEXT,
    "awbStatus" TEXT NOT NULL DEFAULT 'pending',
    "codAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "packageCount" INTEGER NOT NULL DEFAULT 1,
    "xconnectorSynced" BOOLEAN NOT NULL DEFAULT false,
    "xconnectorSyncAt" TIMESTAMP(3),
    "shopifyCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_shop_shopifyOrderId_key" ON "Order"("shop", "shopifyOrderId");
CREATE INDEX "Order_shop_idx" ON "Order"("shop");
CREATE INDEX "Order_shop_awbStatus_idx" ON "Order"("shop", "awbStatus");
CREATE INDEX "Order_shop_courierType_idx" ON "Order"("shop", "courierType");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- AWB tracking events
CREATE TABLE "AwbEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "eventDesc" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AwbEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AwbEvent_orderId_idx" ON "AwbEvent"("orderId");
ALTER TABLE "AwbEvent" ADD CONSTRAINT "AwbEvent_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pickup points cache
CREATE TABLE "PickupPoint" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "county" TEXT,
    "zip" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "type" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickupPoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PickupPoint_courier_externalId_key" ON "PickupPoint"("courier", "externalId");
CREATE INDEX "PickupPoint_courier_idx" ON "PickupPoint"("courier");
CREATE INDEX "PickupPoint_county_idx" ON "PickupPoint"("county");
