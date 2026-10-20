-- Chat: chatbot de atendimento (fluxos sem IA) e o estado do robô em cada conversa.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "botFlowId" UUID,
ADD COLUMN "botState" JSONB,
ADD COLUMN "botAt" TIMESTAMP(3);

CREATE TABLE "whatsapp_flows" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "numberIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "trigger" TEXT NOT NULL DEFAULT 'NOVA_CONVERSA',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onlyAfterHours" BOOLEAN NOT NULL DEFAULT false,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "startStepId" TEXT NOT NULL DEFAULT '',
    "timeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_flows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "whatsapp_flows_tenantId_active_idx" ON "whatsapp_flows"("tenantId", "active");

-- Finalizar atendimento: quando e por quem.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closedByName" TEXT;
