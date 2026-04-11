-- Add widget language override setting
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "widgetLanguage" TEXT NOT NULL DEFAULT 'auto';
