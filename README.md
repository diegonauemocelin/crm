# CRM USA Parts

CRM, automação de marketing e painel de pré e pós-vendas, whitelabel, em português do Brasil.

> Desenvolvido e mantido por **Diego Naue Mocelin**.

| | |
|---|---|
| Versão atual | ver [`releases.json`](releases.json) (também na tela **Atualizações** do sistema) |
| Produção | https://crm.usaparts.com.br |
| Implantação | [docs/DEPLOY.md](docs/DEPLOY.md) |
| Segurança | [docs/SEGURANCA.md](docs/SEGURANCA.md) |
| Como publicar versões | [docs/RELEASES.md](docs/RELEASES.md) |

## Arquitetura

```
Internet ─► Nginx da VPS (vhost só do CRM + Let's Encrypt)
              │ 127.0.0.1:8180
              ▼
   ┌──────────── docker compose "usaparts-crm" ────────────┐
   │ web     Nginx sem root: frontend React + proxy /api     │
   │ api     NestJS 12 (Node 24), REST + OpenAPI             │
   │ db      PostgreSQL 18 (rede interna, sem porta pública) │
   │ backup  pg_dump diário criptografado com age            │
   └────────────────────────────────────────────────────────┘
```

| Camada | Tecnologia |
|---|---|
| Backend | NestJS 12, TypeScript 6, Prisma 7 (PostgreSQL), class-validator, Swagger |
| Frontend | React 19, Vite 8, Tailwind CSS 4, shadcn/ui (componentes + block `sidebar-07`), TanStack Query, React Router 8 |
| Segurança | Argon2id, TOTP (otplib), JWT HS256 em cookie HttpOnly, refresh token rotativo, CSRF double-submit, Helmet, rate limit |
| Infra | Docker Compose, Nginx, Let's Encrypt, backups com `age` |

Repositório em *npm workspaces*:

```
apps/api      API NestJS (src/, prisma/, test/)
apps/web      Frontend React (src/pages, src/components, src/lib)
deploy/       Scripts da VPS: inventário, instalação, deploy, rollback, backup, restauração
scripts/      Verificação de versão, teste de fumaça, banco local de desenvolvimento
releases.json Fonte única da versão e do histórico exibido na tela Atualizações
```

## Desenvolvimento local

Pré-requisito: Node.js 24.

```bash
npm install
```

```bash
copy apps\api\.env.example apps\api\.env
```

Preencha `JWT_ACCESS_SECRET`, `APP_ENCRYPTION_KEY` e `SEED_ADMIN_EMAIL` no `apps/api/.env` (os comandos para gerar os segredos estão no próprio arquivo). Depois, em três terminais:

```bash
npm run dev:db
```

```bash
npm run db:migrate -w @crm/api && npm run db:seed -w @crm/api && npm run dev:api
```

```bash
npm run dev:web
```

Acesse http://localhost:5173. O seed mostra a senha provisória do administrador no terminal. A documentação da API fica em http://localhost:3000/api/docs.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run typecheck` | Checagem de tipos da API e do frontend |
| `npm test` | Testes automatizados (permissões, bloqueio de login, 2FA, criptografia, auditoria, upload, SSRF) |
| `npm run build` | Build de produção |
| `npm run release:check` | Confere se a versão está igual em `releases.json` e nos `package.json` |
| `npm run smoke -- https://crm.usaparts.com.br` | Teste de fumaça das proteções em um ambiente no ar |

## Layouts

Cada usuário escolhe em **Meu perfil → Aparência** (o administrador define o padrão e pode travar a escolha em **Configurações → Aparência**):

- **Moderno:** menu lateral recolhível do shadcn/ui (block `sidebar-07`), breadcrumb e busca global (Ctrl+K).
- **Clássico:** menu superior com listas suspensas por área, no estilo do RD Station, com tabelas mais compactas.

As telas são as mesmas nos dois; só muda a moldura, então nenhum recurso fica de fora de um dos layouts.
