-- Taxas por destino (EMEX, TRT, TDA por cidade...): a lista "Restrições" da transportadora por cidade (IBGE), CEP,
-- região ou UF, além das por destinatário (CPF/CNPJ).
ALTER TABLE "freight_recipient_fees" ALTER COLUMN "doc" DROP NOT NULL;
ALTER TABLE "freight_recipient_fees" ADD COLUMN "ibge" VARCHAR(7);
ALTER TABLE "freight_recipient_fees" ADD COLUMN "cepStart" INTEGER;
ALTER TABLE "freight_recipient_fees" ADD COLUMN "cepEnd" INTEGER;
ALTER TABLE "freight_recipient_fees" ADD COLUMN "region" VARCHAR(40);
ALTER TABLE "freight_recipient_fees" ADD COLUMN "basis" TEXT NOT NULL DEFAULT 'FRETE';
CREATE INDEX "freight_recipient_fees_carrierId_ibge_idx" ON "freight_recipient_fees"("carrierId", "ibge");
