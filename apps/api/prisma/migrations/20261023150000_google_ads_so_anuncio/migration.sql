-- Google Ads só para quem veio de um anúncio: tira a marcação feita pela origem do atendimento.
UPDATE "service_records" SET "adsVia" = NULL WHERE "adsVia" = 'ORIGEM';
