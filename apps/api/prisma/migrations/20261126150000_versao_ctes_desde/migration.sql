-- Versão de tabela que corrige a anterior: vale na conciliação dos CT-es desde uma data.
ALTER TABLE "freight_table_versions" ADD COLUMN "ctesFrom" TIMESTAMP(3);
