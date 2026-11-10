-- Peso (kg) e medidas (cm) do produto lidos da Magazord, para o frete no Google pelas tabelas do CRM.
ALTER TABLE "store_products" ADD COLUMN "weightKg" DECIMAL(12,3),
ADD COLUMN "heightCm" DECIMAL(8,1),
ADD COLUMN "widthCm" DECIMAL(8,1),
ADD COLUMN "lengthCm" DECIMAL(8,1),
ADD COLUMN "measuresAt" TIMESTAMP(3);
