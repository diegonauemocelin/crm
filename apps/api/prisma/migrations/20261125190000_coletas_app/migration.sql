-- App da expedição: coleta de horário fixo marcada (FIXA + slot), horários reais, volumes e notas da coleta.
ALTER TABLE "freight_pickup_schedules" ADD COLUMN "slot" TEXT;
ALTER TABLE "freight_pickup_schedules" ADD COLUMN "arrivedAt" TIMESTAMP(3);
ALTER TABLE "freight_pickup_schedules" ADD COLUMN "collectedAt" TIMESTAMP(3);
ALTER TABLE "freight_pickup_schedules" ADD COLUMN "volumes" INTEGER;
ALTER TABLE "freight_pickup_schedules" ADD COLUMN "invoices" INTEGER;
ALTER TABLE "freight_carriers" ADD COLUMN "pickupCountsRequired" BOOLEAN NOT NULL DEFAULT false;
