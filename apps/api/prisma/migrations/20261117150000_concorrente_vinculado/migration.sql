-- Anúncio do concorrente ligado à mão a um anúncio da loja (mesma peça com outro código).
ALTER TABLE "ml_competitor_items" ADD COLUMN "linkedOwnId" TEXT;
