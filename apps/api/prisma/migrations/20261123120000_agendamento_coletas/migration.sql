-- Transportadoras que só vêm quando a coleta é agendada, e os agendamentos (manhã ou tarde) feitos pela expedição.
ALTER TABLE "freight_carriers" ADD COLUMN "pickupBySchedule" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "freight_pickup_schedules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID,
    "carrierId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGENDADA',
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "statusByName" TEXT,
    "statusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_pickup_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "freight_pickup_schedules_tenantId_date_idx" ON "freight_pickup_schedules"("tenantId", "date");
