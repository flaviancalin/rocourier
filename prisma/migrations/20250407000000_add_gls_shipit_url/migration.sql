-- Add GLS ShipIT URL for parcel shop sync
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "glsShipItUrl" TEXT;
