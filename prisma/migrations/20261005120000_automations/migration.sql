-- Invoice tracking on orders
ALTER TABLE "Order" ADD COLUMN "invoiceProvider" TEXT;
ALTER TABLE "Order" ADD COLUMN "invoiceSeries" TEXT;
ALTER TABLE "Order" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "invoiceUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN "invoiceStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "invoiceReverseNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "invoiceIssuedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "financialStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "shopifyCancelledAt" TIMESTAMP(3);

-- Automations (all off by default)
ALTER TABLE "ShopSettings" ADD COLUMN "autoAwbFilter" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "ShopSettings" ADD COLUMN "autoAwbMarkShipped" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "autoAwbNotifyCustomer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "autoInvoiceOnDelivered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "onCancelDeleteAwb" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "onCancelInvoice" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "ShopSettings" ADD COLUMN "onRefundReverseInvoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "onDeliveredMarkPaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "onReturnedCancelOrder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "onReturnedInvoice" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "ShopSettings" ADD COLUMN "statusTags" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "copyCustomerPhone" BOOLEAN NOT NULL DEFAULT false;

-- Romania's standard VAT rate is 21% since 1 August 2025
ALTER TABLE "ShopSettings" ALTER COLUMN "smartbillTVA" SET DEFAULT '21';
ALTER TABLE "ShopSettings" ALTER COLUMN "oblioTVA" SET DEFAULT '21';
