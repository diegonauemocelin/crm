-- Controle de brindes: filiais (unidades) com cota e retiradas próprias, sem vendedor.
ALTER TABLE "gift_quotas" ALTER COLUMN "sellerId" DROP NOT NULL;
ALTER TABLE "gift_quotas" ADD COLUMN "unitId" UUID;
ALTER TABLE "gift_deliveries" ALTER COLUMN "sellerId" DROP NOT NULL;
ALTER TABLE "gift_deliveries" ADD COLUMN "unitId" UUID;

CREATE UNIQUE INDEX "gift_quotas_unitId_giftId_key" ON "gift_quotas"("unitId", "giftId");
CREATE INDEX "gift_deliveries_unitId_date_idx" ON "gift_deliveries"("unitId", "date");

ALTER TABLE "gift_quotas" ADD CONSTRAINT "gift_quotas_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cada linha é de um vendedor ou de uma filial, nunca dos dois nem de nenhum.
ALTER TABLE "gift_quotas" ADD CONSTRAINT "gift_quotas_holder_check" CHECK (("sellerId" IS NULL) <> ("unitId" IS NULL));
ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_holder_check" CHECK (("sellerId" IS NULL) <> ("unitId" IS NULL));
