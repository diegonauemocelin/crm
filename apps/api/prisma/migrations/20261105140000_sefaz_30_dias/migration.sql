-- Captura de CT-e na SEFAZ: até 30 dias para trás (antes 7); quem estava no padrão de 7 passa para 30.
ALTER TABLE "freight_sefaz_configs" ALTER COLUMN "lookbackDays" SET DEFAULT 30;
UPDATE "freight_sefaz_configs" SET "lookbackDays" = 30 WHERE "lookbackDays" = 7;
