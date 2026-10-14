-- Locker availability from the courier (Sameday occupancy, FAN high demand)
ALTER TABLE "PickupPoint" ADD COLUMN "availability" TEXT;
