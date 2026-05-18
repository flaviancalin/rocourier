-- AlterTable: add billing fields to ShopSettings
ALTER TABLE "ShopSettings"
  ADD COLUMN "planType"        TEXT      NOT NULL DEFAULT 'trial',
  ADD COLUMN "awbCount"        INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN "shopifyChargeId" TEXT,
  ADD COLUMN "planActivatedAt" TIMESTAMP(3);

-- CreateTable: DiscountCode
CREATE TABLE "DiscountCode" (
  "id"         SERIAL       NOT NULL,
  "code"       TEXT         NOT NULL,
  "type"       TEXT         NOT NULL,
  "percentOff" INTEGER,
  "maxUses"    INTEGER,
  "usedCount"  INTEGER      NOT NULL DEFAULT 0,
  "active"     BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DiscountCodeUsage
CREATE TABLE "DiscountCodeUsage" (
  "id"     SERIAL       NOT NULL,
  "code"   TEXT         NOT NULL,
  "shop"   TEXT         NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscountCodeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");
CREATE UNIQUE INDEX "DiscountCodeUsage_code_shop_key" ON "DiscountCodeUsage"("code", "shop");
