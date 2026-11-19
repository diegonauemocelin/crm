-- Conferência de frete por pedido: quem conferiu, quando, resultado (OK/DIVERGENTE), causa e observação.
ALTER TABLE "freight_shipments" ADD COLUMN "auditStatus" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "auditCause" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "auditNote" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "auditedByName" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "auditedAt" TIMESTAMP(3);
