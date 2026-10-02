# Segurança

Referências: OWASP Top 10 (2021/2025) e OWASP ASVS nível 2. Esta página registra o que já está implementado e o que entra nas próximas fases.

## Autenticação (ASVS V2/V3)

| Controle | Implementação |
|---|---|
| Hash de senha | Argon2id (38 MiB, 3 iterações), rehash automático se os parâmetros mudarem |
| Política de senha | Mínimo de 12 caracteres, sem regra de composição (ASVS 2.1), bloqueio de senhas óbvias e que contenham o e-mail |
| 2FA | TOTP (RFC 6238), tolerância de ±30 s, **proteção contra reuso do mesmo código**, 8 códigos de recuperação de uso único (armazenados como hash) |
| 2FA obrigatório | Por perfil de acesso. Administrador e Diretoria vêm com 2FA obrigatório. Sem 2FA configurado, o servidor só libera a tela de configuração |
| Sessão | JWT HS256 de 15 min em cookie `HttpOnly; Secure; SameSite=Strict` + refresh token opaco de 12 h, **rotativo**, guardado como hash |
| Roubo de sessão | Reuso de refresh token já trocado derruba a sessão inteira e gera alerta na auditoria |
| Revogação imediata | A cada requisição o servidor confere usuário ativo, perfil ativo e sessão não revogada. Desativar usuário, trocar perfil ou trocar senha encerra as sessões na hora |
| Força bruta | Bloqueio progressivo da conta (5 erros: 15 min; 10: 1 h; 15+: 4 h) + limite por IP (10 logins/min, 300 req/min geral) |
| Enumeração de contas | Mesma mensagem e mesmo tempo de resposta para e-mail inexistente e senha errada; "esqueci a senha" sempre responde igual |
| Recuperação de senha | Token aleatório de 256 bits, guardado como hash, uso único, 1 h de validade (72 h para convites) |

## Autorização (ASVS V4, OWASP A01)

- Guard global no backend: **toda rota exige sessão**, exceto as marcadas explicitamente como públicas (login, branding, versão, health).
- Permissão por módulo e ação (`ver`, `criar`, `editar`, `excluir`, `exportar`) checada no servidor em cada rota com `@RequirePermission`. O frontend só esconde botões; quem decide é o servidor.
- Escopo "somente os próprios registros" já modelado e entregue ao backend em cada requisição (usado a partir da Fase 2).
- Todas as consultas filtram por `tenantId` da sessão (prevenção de IDOR entre empresas no futuro SaaS).
- Perfil Administrador é de sistema: não pode ser editado nem excluído. O último administrador ativo não pode ser desativado.

## Entradas e saídas (ASVS V5, OWASP A03)

- SQL: somente Prisma (consultas parametrizadas). Não há SQL montado com texto do usuário.
- Validação: `class-validator` com `whitelist` + `forbidNonWhitelisted` (campos não previstos são recusados).
- XSS: React escapa a saída; CSP sem `unsafe-inline` e sem `unsafe-eval` para scripts; o único script fora do bundle (`theme-init.js`) é arquivo estático.
- Upload: tipo detectado pelos bytes do arquivo (PNG, JPG, WEBP, ICO), limite de 1 MB, **SVG recusado**, nome gerado pelo servidor, `nosniff` na resposta.
- E-mails: HTML de e-mail com todos os valores escapados.

## CSRF e SSRF

- CSRF: `SameSite=Strict` + checagem de `Origin`/`Referer` + token double-submit (`X-CSRF-Token`) em todo método que altera dados. Webhooks (próximas fases) ficam fora disso e são autenticados por assinatura.
- SSRF: o host SMTP informado no painel é resolvido uma vez e recusado se apontar para rede interna (loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, IPv6 local). A conexão é feita no IP já validado, contra DNS rebinding, e o certificado TLS continua validado pelo nome.

## Dados sensíveis (ASVS V6/V8)

- Segredos do 2FA e senha do SMTP: AES-256-GCM com chave `APP_ENCRYPTION_KEY` (fora do banco).
- Segredos só em variáveis de ambiente (`.env` com permissão 600, fora do Git).
- Logs: cookies, `Authorization` e `X-CSRF-Token` são mascarados. A auditoria remove automaticamente campos como senha, token, segredo e chave.

## Auditoria (ASVS V7)

- Tabela somente inserção: **triggers no PostgreSQL bloqueiam UPDATE, DELETE e TRUNCATE**, inclusive pela própria aplicação.
- Cada registro carrega o hash do anterior (cadeia SHA-256). O botão **Verificar integridade** recalcula a cadeia e aponta o primeiro registro adulterado.
- Registra login, falhas, bloqueios, logout, 2FA, alterações de usuários, perfis e configurações, com usuário, IP e navegador.

## Cabeçalhos e transporte

- HTTPS obrigatório com redirecionamento e HSTS (certbot `--hsts`).
- CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- `server_tokens off` e sem `X-Powered-By`.

## Infraestrutura

- Containers sem root (API como `node`, web com `nginx-unprivileged`, backup como `postgres`), `read_only`, `cap_drop: ALL`, `no-new-privileges` e limites de memória.
- Banco numa rede Docker `internal` (sem saída para a internet), sem porta publicada.
- Frontend publicado só em `127.0.0.1`: a porta do Docker não fica exposta mesmo que o Docker contorne o UFW.
- Backups diários criptografados com chave pública `age`. A chave privada fica fora do servidor.
- Dependências: `npm audit` no CI (falha em vulnerabilidade alta), scripts de instalação de pacotes bloqueados por padrão (só os necessários liberados em `allowScripts`).

## Pendências planejadas (Fase 8 e anteriores)

- fail2ban lendo o log do Nginx do CRM (exige instalar/configurar no host: será proposto após o inventário).
- Limite de requisições compartilhado em Redis (hoje em memória, suficiente para uma instância da API).
- Sessões ativas por usuário (listar e encerrar dispositivos) e alerta por e-mail de login em novo dispositivo.
- Pedir senha novamente para reconfigurar o 2FA.
- LGPD (consentimento, exportação e exclusão do titular) entra junto com a base de leads (Fase 3).
- Teste de intrusão e de carga (Fase 8).
