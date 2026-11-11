-- Monitorar conversas por usuário: quem a pessoa monitora (todas as pessoas ou só as que a têm como gestora) e
-- quais números (vazio = os do perfil de acesso).
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "monitorEveryone" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "monitorNumberIds" UUID[] DEFAULT ARRAY[]::UUID[];
