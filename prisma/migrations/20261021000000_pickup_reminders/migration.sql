-- Email reminders for parcels waiting in a locker / pickup point
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "pickupReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "pickupReminderHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "pickupReminderLastDay" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "readyForPickupAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pickupRemindersSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pickupReminderAt" TIMESTAMP(3);
-- Automatic courier choice (cheapest connected courier)
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "autoCourierMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "autoCourierPrices" JSONB;
