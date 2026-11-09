-- Avisos do chat em pop-up por usuário (desligado: só o número no sino).
ALTER TABLE "users" ADD COLUMN "chatPopups" BOOLEAN NOT NULL DEFAULT true;
