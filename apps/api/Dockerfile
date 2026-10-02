# syntax=docker/dockerfile:1.7
# Imagem da API. Contexto de build: raiz do repositório (docker compose cuida disso).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @crm/api --include-workspace-root=false --no-audit --no-fund

FROM deps AS build
COPY apps/api apps/api
RUN npm run build -w @crm/api

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @crm/api --include-workspace-root=false --omit=dev --no-audit --no-fund && npm cache clean --force \
 && mkdir -p apps/api/node_modules

FROM node:24-alpine AS runtime
ARG GIT_COMMIT=dev
ARG BUILD_DATE=
# PATH: prisma e tsx da própria imagem (versões travadas no package-lock), nunca baixados na hora.
ENV NODE_ENV=production \
    PORT=3000 \
    GIT_COMMIT=${GIT_COMMIT} \
    BUILD_DATE=${BUILD_DATE} \
    RELEASES_FILE=/app/releases.json \
    UPLOAD_DIR=/data/uploads \
    PATH=/app/node_modules/.bin:/app/apps/api/node_modules/.bin:$PATH \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apk add --no-cache tini && mkdir -p /data/uploads && chown -R node:node /data
WORKDIR /app/apps/api
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/src/generated ./src/generated
COPY --chown=node:node apps/api/package.json apps/api/prisma.config.ts ./
COPY --chown=node:node apps/api/prisma ./prisma
COPY --chown=node:node releases.json /app/releases.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
