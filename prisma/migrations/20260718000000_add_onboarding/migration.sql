-- Migration: add onboardingCompleted to ShopSettings
ALTER TABLE "ShopSettings" ADD COLUMN "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
