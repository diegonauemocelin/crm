-- Rastreamento dos pedidos pela chave da NF-e (SSW: TW Transportes e outras)
ALTER TABLE "freight_shipments" ADD COLUMN "trackingAt" TIMESTAMP(3);
ALTER TABLE "freight_shipments" ADD COLUMN "trackingLast" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "trackingCarrier" TEXT;
