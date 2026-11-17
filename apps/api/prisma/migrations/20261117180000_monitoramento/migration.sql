-- Monitoramento: amostras do servidor e da API (uma por minuto, 7 dias).
CREATE TABLE "monitor_samples" (
    "id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPct" DOUBLE PRECISION NOT NULL,
    "load1" DOUBLE PRECISION NOT NULL,
    "memPct" DOUBLE PRECISION NOT NULL,
    "memUsedMb" INTEGER NOT NULL,
    "apiMemMb" INTEGER NOT NULL,
    "diskPct" DOUBLE PRECISION,
    "dbMs" INTEGER NOT NULL,
    "requests" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL,
    "avgMs" INTEGER NOT NULL,

    CONSTRAINT "monitor_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "monitor_samples_at_idx" ON "monitor_samples"("at");
