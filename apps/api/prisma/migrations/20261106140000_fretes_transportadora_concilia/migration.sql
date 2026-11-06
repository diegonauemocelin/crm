-- Transportadora que não concilia CT-e (ex.: Mercado Livre Envios, frete cobrado pela plataforma).
ALTER TABLE "freight_carriers" ADD COLUMN "reconcile" BOOLEAN NOT NULL DEFAULT true;
