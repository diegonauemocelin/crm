-- Orçamento ou pré-nota do ERP (Tcar) na cotação e no pedido de frete, e o frete cobrado do cliente no ERP.
ALTER TABLE "freight_quotes" ADD COLUMN "erpDocType" TEXT;
ALTER TABLE "freight_quotes" ADD COLUMN "erpDocNumber" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "erpDocType" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "erpDocNumber" TEXT;
ALTER TABLE "freight_shipments" ADD COLUMN "erpFreight" DECIMAL(12,2);
