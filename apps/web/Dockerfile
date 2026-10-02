# syntax=docker/dockerfile:1.7
# Frontend estático servido por Nginx sem privilégios de root. Contexto de build: raiz do repositório.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @crm/web --include-workspace-root=false --no-audit --no-fund
COPY apps/web apps/web
RUN npm run build -w @crm/web

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
