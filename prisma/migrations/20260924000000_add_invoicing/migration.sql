-- Migration: add SmartBill, Oblio, and invoicing settings to ShopSettings

-- SmartBill
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "smartbillEmail"      TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "smartbillToken"      TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "smartbillCompanyCIF" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "smartbillSeries"     TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "smartbillTVA"        TEXT DEFAULT '19';
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "smartbillCurrency"   TEXT DEFAULT 'RON';
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "smartbillEnabled"    BOOLEAN NOT NULL DEFAULT false;

-- Oblio
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "oblioEmail"    TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "oblioSecret"   TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "oblioCIF"      TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "oblioSeries"   TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "oblioTVA"      TEXT DEFAULT '19';
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "oblioCurrency" TEXT DEFAULT 'RON';
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "oblioEnabled"  BOOLEAN NOT NULL DEFAULT false;

-- Common invoicing settings
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "invoiceProvider"      TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "autoSendInvoice"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "autoInvoiceOnFulfill" BOOLEAN NOT NULL DEFAULT false;
