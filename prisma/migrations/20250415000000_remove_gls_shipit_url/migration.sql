-- Migration: remove glsShipItUrl from ShopSettings
-- Pickup point sync now uses app-level env vars (GLS_SYNC_USERNAME/PASSWORD)
-- and a hardcoded standard ShipIT endpoint — merchants no longer configure this.

ALTER TABLE "ShopSettings" DROP COLUMN IF EXISTS "glsShipItUrl";
