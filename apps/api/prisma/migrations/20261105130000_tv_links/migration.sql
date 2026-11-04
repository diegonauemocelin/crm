-- Links de painel para a TV (sem login, só leitura): painel de coletas e Dashboard executivo.
CREATE TABLE "tv_links" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "unitId" UUID,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "tv_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tv_links_tokenHash_key" ON "tv_links"("tokenHash");
CREATE INDEX "tv_links_tenantId_kind_idx" ON "tv_links"("tenantId", "kind");
