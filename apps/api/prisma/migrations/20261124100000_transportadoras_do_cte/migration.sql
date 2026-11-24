-- Transportadoras cadastradas sozinhas pelo CT-e e as opções de cada uma: aparece na cotação e faz coleta.
ALTER TABLE "freight_carriers" ADD COLUMN "quote" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "freight_carriers" ADD COLUMN "pickup" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "freight_carriers" ADD COLUMN "autoCreated" BOOLEAN NOT NULL DEFAULT false;
