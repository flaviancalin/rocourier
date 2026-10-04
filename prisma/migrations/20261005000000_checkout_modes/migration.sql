-- Checkout delivery modes (CCS nearest lockers vs. manual rates)
ALTER TABLE "ShopSettings" ADD COLUMN "checkoutMode" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "checkoutLockerCount" INTEGER NOT NULL DEFAULT 5;

-- Fast nearest-locker lookups
CREATE INDEX "PickupPoint_country_lat_lng_idx" ON "PickupPoint"("country", "lat", "lng");
CREATE INDEX "PickupPoint_country_zip_idx" ON "PickupPoint"("country", "zip");
