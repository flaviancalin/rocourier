-- Order confirmation on WhatsApp (Thank you page block)
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappConfirm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappPhone" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappName" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappTitle" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappText" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappButton" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappMessage" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappCodOnly" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Order" ADD COLUMN "confirmationNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerConfirmedAt" TIMESTAMP(3);
