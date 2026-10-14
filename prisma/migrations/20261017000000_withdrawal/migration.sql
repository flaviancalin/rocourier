-- Right of withdrawal: "withdraw from contract" requests next to returns
ALTER TABLE "ShopSettings" ADD COLUMN "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReturnRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'return';
ALTER TABLE "ReturnRequest" ADD COLUMN "requestedVia" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN "refundDueAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN "confirmationSentAt" TIMESTAMP(3);
