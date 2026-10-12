-- Checkout shows only the option chosen in the cart widget ("widget") or the usual list ("list")
ALTER TABLE "ShopSettings" ADD COLUMN "checkoutStyle" TEXT NOT NULL DEFAULT 'list';
