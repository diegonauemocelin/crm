-- Cidades atendidas com a base responsável: coleta, contato da base e observações.
ALTER TABLE "freight_carrier_regions" ADD COLUMN "pickup" BOOLEAN, ADD COLUMN "contact" TEXT, ADD COLUMN "note" TEXT;
ALTER TABLE "freight_carriers" ADD COLUMN "citiesUrl" TEXT, ADD COLUMN "citiesSyncedAt" TIMESTAMP(3), ADD COLUMN "citiesSyncError" TEXT;
