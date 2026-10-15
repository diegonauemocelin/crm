-- Visões salvas por tela (filtros guardados com um nome), de cada usuário.
ALTER TABLE "users" ADD COLUMN "savedViews" JSONB;
