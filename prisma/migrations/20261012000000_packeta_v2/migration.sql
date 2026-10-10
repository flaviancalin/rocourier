-- Packeta: separate API password, sender indication, home delivery carrier
ALTER TABLE "ShopSettings" ADD COLUMN "packetaApiPassword" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "packetaSender" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "packetaHomeCarrierId" TEXT;

-- Packeta returns: drop-off password for the customer
ALTER TABLE "ReturnRequest" ADD COLUMN "dropoffPassword" TEXT;
