-- Required by @shopify/shopify-app-session-storage-prisma >= 9 (expiring offline tokens)
ALTER TABLE "Session" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN "refreshTokenExpires" TIMESTAMP(3);
