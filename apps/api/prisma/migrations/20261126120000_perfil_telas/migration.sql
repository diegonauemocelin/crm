-- Telas do menu escondidas por perfil (dentro de um módulo liberado).
ALTER TABLE "roles" ADD COLUMN "hiddenScreens" TEXT[] DEFAULT ARRAY[]::TEXT[];
