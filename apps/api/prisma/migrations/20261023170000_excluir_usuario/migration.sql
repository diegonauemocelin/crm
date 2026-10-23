-- Excluir usuário: some das listas e não entra mais; o histórico continua com o nome.
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
