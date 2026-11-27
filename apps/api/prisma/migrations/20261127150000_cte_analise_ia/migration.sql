-- Análise inteligente (IA) da conciliação do CT-e.
ALTER TABLE "freight_ctes" ADD COLUMN "aiAnalysis" JSONB;
ALTER TABLE "freight_ctes" ADD COLUMN "aiAnalysisAt" TIMESTAMP(3);
