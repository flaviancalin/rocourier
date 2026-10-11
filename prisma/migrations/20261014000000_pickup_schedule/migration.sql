-- Opening hours and card payment at pickup points (weekend / card filters in the cart widget)
ALTER TABLE "PickupPoint" ADD COLUMN "schedule" JSONB;
ALTER TABLE "PickupPoint" ADD COLUMN "cardAtPickup" BOOLEAN;
