-- Lucro desejado por produto (Preços e promoções)
ALTER TABLE "marketplace_costs" ADD COLUMN "profitValue" DECIMAL(14,2),
ADD COLUMN "profitPct" DECIMAL(6,2),
ADD COLUMN "profitSalePct" DECIMAL(6,2);
