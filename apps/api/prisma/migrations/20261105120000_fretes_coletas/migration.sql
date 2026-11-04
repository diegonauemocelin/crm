-- Horários de coleta das transportadoras (ponto de corte e hora da coleta), para o painel de TV.
ALTER TABLE "freight_carriers" ADD COLUMN "pickups" JSONB NOT NULL DEFAULT '[]';
