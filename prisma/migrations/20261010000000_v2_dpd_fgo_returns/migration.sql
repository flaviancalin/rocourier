-- DPD Romania
ALTER TABLE "ShopSettings" ADD COLUMN "dpdUsername" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "dpdPassword" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "dpdEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "dpdServiceId" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "dpdClientId" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "dpdLabelSize" TEXT NOT NULL DEFAULT 'A6';
ALTER TABLE "ShopSettings" ADD COLUMN "dpdHomeDeliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ShopSettings" ADD COLUMN "dpdPickupFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- FGO
ALTER TABLE "ShopSettings" ADD COLUMN "fgoCui" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "fgoPrivateKey" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "fgoSeries" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "fgoTVA" TEXT DEFAULT '21';
ALTER TABLE "ShopSettings" ADD COLUMN "fgoCurrency" TEXT DEFAULT 'RON';
ALTER TABLE "ShopSettings" ADD COLUMN "fgoEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "fgoSandbox" BOOLEAN NOT NULL DEFAULT false;

-- Cart widget extras
ALTER TABLE "ShopSettings" ADD COLUMN "freeShippingThreshold" DOUBLE PRECISION;
ALTER TABLE "ShopSettings" ADD COLUMN "freeShippingScope" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "ShopSettings" ADD COLUMN "showDeliveryEstimate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "dispatchCutoffHour" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "ShopSettings" ADD COLUMN "processingDays" INTEGER NOT NULL DEFAULT 0;

-- Order checks
ALTER TABLE "ShopSettings" ADD COLUMN "validateAddresses" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "refusalWarnThreshold" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ShopSettings" ADD COLUMN "blockCodAfterRefusals" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShopSettings" ADD COLUMN "routingRules" JSONB;

-- Returns
ALTER TABLE "ShopSettings" ADD COLUMN "returnsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "returnsWindowDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "ShopSettings" ADD COLUMN "returnsCourier" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "returnsInstructions" TEXT;

-- COD reconciliation
ALTER TABLE "ShopSettings" ADD COLUMN "codSyncedAt" TIMESTAMP(3);

-- Orders
ALTER TABLE "Order" ADD COLUMN "customerCompany" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerVatCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerRegCom" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippingCost" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "codCollectedAmount" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "codCollectedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "codPayoutRef" TEXT;
CREATE INDEX "Order_shop_customerPhone_idx" ON "Order"("shop", "customerPhone");

-- Activity log
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT,
    "orderName" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityLog_shop_createdAt_idx" ON "ActivityLog"("shop", "createdAt");
CREATE INDEX "ActivityLog_orderId_idx" ON "ActivityLog"("orderId");

-- Returns
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "items" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "method" TEXT NOT NULL DEFAULT 'courier',
    "pickupPointId" TEXT,
    "pickupPointName" TEXT,
    "iban" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "returnCourier" TEXT,
    "returnAwbNumber" TEXT,
    "merchantNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReturnRequest_shop_status_idx" ON "ReturnRequest"("shop", "status");
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- COD payouts
CREATE TABLE "CodPayout" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "awbNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "paidAt" TIMESTAMP(3),
    "documentId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CodPayout_shop_courier_awbNumber_key" ON "CodPayout"("shop", "courier", "awbNumber");
CREATE INDEX "CodPayout_shop_paidAt_idx" ON "CodPayout"("shop", "paidAt");
