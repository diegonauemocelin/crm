-- CreateTable
CREATE TABLE "whatsapp_numbers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "phone" TEXT,
    "profileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DESCONECTADO',
    "statusReason" TEXT,
    "unitId" UUID,
    "sellerIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "connectingAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "whatsapp_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_numbers_instanceName_key" ON "whatsapp_numbers"("instanceName");

-- CreateIndex
CREATE INDEX "whatsapp_numbers_tenantId_status_idx" ON "whatsapp_numbers"("tenantId", "status");

