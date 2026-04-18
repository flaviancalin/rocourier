-- Add country field to PickupPoint for multi-country Packeta support
ALTER TABLE "PickupPoint" ADD COLUMN "country" TEXT DEFAULT 'ro';

CREATE INDEX "PickupPoint_country_idx" ON "PickupPoint"("country");
