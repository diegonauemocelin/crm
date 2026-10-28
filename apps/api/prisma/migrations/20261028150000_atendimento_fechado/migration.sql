-- Atendimento fechado (em massa ou na ficha): pré-venda encerrada ou pós-venda resolvido, com o chat finalizado.
ALTER TABLE "service_records" ADD COLUMN "closedAt" TIMESTAMP(3);
