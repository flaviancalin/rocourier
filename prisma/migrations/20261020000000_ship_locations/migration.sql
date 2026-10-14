-- Ship from several locations (warehouses, dropshipping suppliers)
ALTER TABLE "ShopSettings" ADD COLUMN "multiLocationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "shipFromLocationId" TEXT;
CREATE TABLE "ShipLocation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "county" TEXT,
    "zip" TEXT,
    "country" TEXT NOT NULL DEFAULT 'RO',
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "samedayPickupPointId" TEXT,
    "cargusLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShipLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShipLocation_shop_shopifyLocationId_key" ON "ShipLocation"("shop", "shopifyLocationId");
CREATE INDEX "ShipLocation_shop_idx" ON "ShipLocation"("shop");
