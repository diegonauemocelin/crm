-- Fretes: taxas cobradas só de destinatários das listas da transportadora (TDA, TDE, TDC, TVD).
-- CreateTable
CREATE TABLE "freight_recipient_fees" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "doc" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fixed" DECIMAL(12,2) NOT NULL,
    "percent" DECIMAL(7,3),
    "city" TEXT,
    "uf" CHAR(2),
    "since" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_recipient_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "freight_recipient_fees_carrierId_doc_idx" ON "freight_recipient_fees"("carrierId", "doc");

