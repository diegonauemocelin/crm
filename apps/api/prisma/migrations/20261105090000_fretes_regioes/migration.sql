-- Regiões da transportadora (código, cidades, prazo e dias de entrega).
CREATE TABLE "freight_carrier_regions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "ibge" TEXT,
    "city" TEXT NOT NULL,
    "cityKey" TEXT NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "deadlineDays" INTEGER,
    "businessDays" BOOLEAN NOT NULL DEFAULT true,
    "weekdays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_carrier_regions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "freight_carrier_regions_carrierId_code_idx" ON "freight_carrier_regions"("carrierId", "code");
