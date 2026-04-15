-- Re-add glsShipItUrl as a no-op deprecated column.
-- The app no longer reads or writes this field, but the Prisma client
-- still references it due to Railway build caching. Keeping the column
-- in the DB allows the old cached client to continue working until
-- a full cache-busted rebuild lands.
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "glsShipItUrl" TEXT;
