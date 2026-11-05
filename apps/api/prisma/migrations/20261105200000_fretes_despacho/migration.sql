-- Transportadoras: coleta ou despacho (a empresa leva até ela), valor do despacho e o prestador que leva; e o cadastro
-- de prestador (só leva a carga até a transportadora, não entra na cotação).
ALTER TABLE "freight_carriers" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TRANSPORTADORA';
ALTER TABLE "freight_carriers" ADD COLUMN "pickupMode" TEXT NOT NULL DEFAULT 'COLETA';
ALTER TABLE "freight_carriers" ADD COLUMN "dropOffCost" DECIMAL(12,2);
ALTER TABLE "freight_carriers" ADD COLUMN "dropOffProviderId" UUID;
