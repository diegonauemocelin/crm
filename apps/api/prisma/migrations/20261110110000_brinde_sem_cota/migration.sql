-- Brinde sem cota mensal: qualquer vendedor ou filial retira, só baixa o estoque.
ALTER TABLE "gifts" ADD COLUMN "hasQuota" BOOLEAN NOT NULL DEFAULT true;
