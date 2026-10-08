# Segurança

Referências: OWASP Top 10 (2021/2025) e OWASP ASVS nível 2. Esta página registra o que já está implementado e o que entra nas próximas fases.

## Autenticação (ASVS V2/V3)

| Controle | Implementação |
|---|---|
| Hash de senha | Argon2id (38 MiB, 3 iterações), rehash automático se os parâmetros mudarem |
| Política de senha | Mínimo de 12 caracteres, sem regra de composição (ASVS 2.1), bloqueio de senhas óbvias e que contenham o e-mail |
| 2FA | TOTP (RFC 6238), tolerância de ±90 s (relógio do celular ou do servidor fora da hora), **proteção contra reuso do mesmo código**, 8 códigos de recuperação de uso único (armazenados como hash) |
| 2FA obrigatório | Por perfil de acesso. Administrador e Diretoria vêm com 2FA obrigatório. Sem 2FA configurado, o servidor só libera a tela de configuração |
| Sessão | JWT HS256 de 15 min em cookie `HttpOnly; Secure; SameSite=Strict` + refresh token opaco de 12 h, **rotativo**, guardado como hash |
| Roubo de sessão | Reuso de refresh token já trocado derruba a sessão inteira e gera alerta na auditoria |
| Revogação imediata | A cada requisição o servidor confere usuário ativo, perfil ativo e sessão não revogada. Desativar usuário, trocar perfil ou trocar senha encerra as sessões na hora |
| Força bruta | Bloqueio progressivo da conta (5 erros: 15 min; 10: 1 h; 15+: 4 h) + limite por IP nas rotas sem sessão (10 logins/min) + fail2ban no servidor (15 erros em 10 min banem o IP por 1 h) |
| Limite de uso | 300 req/min **por usuário logado** (token válido); sem sessão, por IP. O escritório inteiro sai por um IP só, então o limite por IP somaria a equipe |
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

## LGPD (dados de leads)

- Consentimento para e-mail marketing registrado em `lead_consents` (finalidade, aceito/recusado, origem, texto, IP e data). Importações nunca reinscrevem quem se descadastrou.
- Descadastro em 1 clique: link assinado (HMAC) por lead, página pública sem login, com o e-mail mascarado.
- Portabilidade: exportação em JSON de tudo o que o sistema guarda sobre o titular.
- Eliminação: apaga nome, e-mail, telefone, campos personalizados e histórico do lead e dos atendimentos vinculados, mantendo só um registro anônimo para estatística. Fica registrado na auditoria.
- Arquivos de importação ficam fora da área pública, com permissão 600, e são apagados ao fim da importação.

## Rastreamento do site e webhooks (v0.3.2)

- O script do site usa só cookies do próprio domínio do site, com números aleatórios (sem dado pessoal). Não grava IP nem navegador.
- URLs guardadas sem parâmetros desconhecidos (só UTMs, gclid/fbclid e busca): e-mail, token ou CPF que apareçam na URL são descartados antes de gravar. Do site que indicou, só o domínio.
- Coleta aceita apenas os domínios cadastrados (origem do navegador e URL da página), com limite por IP. A rota não devolve dado nenhum e fica fora do CSRF (não usa sessão nem cookie do CRM).
- Identificação do visitante só por token assinado (HMAC) no link (`crm_lid`) ou pelos formulários do próprio CRM: ninguém consegue ligar visitas a um lead só sabendo o e-mail dele.
- Modo "só após consentimento" para sites com banner de cookies; navegadores com Global Privacy Control não são rastreados.
- Prazo de guarda configurável (padrão 395 dias), com limpeza diária. Eliminação do lead apaga também a navegação; a portabilidade a inclui.
- Meta Lead Ads: desligado por padrão; URL do webhook com chave aleatória por empresa; verificação por token; cada aviso validado pela assinatura `X-Hub-Signature-256` (HMAC do corpo bruto com o App Secret); reenvios ignorados por chave única; chamadas só para `graph.facebook.com` (sem SSRF). App Secret e token da página criptografados (AES-256-GCM).

## Loja virtual (Magazord) e eventos de compra (v0.4.0)

- Integração só de leitura (GET) com usuário WebService próprio. Token e senha criptografados (AES-256-GCM), nunca devolvidos pela API.
- Endereço restrito a `https://*.magazord.com.br` (sem porta, usuário ou outro esquema): o painel não pode ser usado para o servidor chamar outro destino (SSRF).
- CPF/CNPJ não é lido nem guardado. Do cliente, só nome, e-mail, telefone, cidade/UF e empresa (pessoa jurídica).
- Links e imagens de produtos vindos da loja só são aceitos com `https://`. A CSP do painel permite imagens `https:` (fotos dos produtos no CDN da loja); scripts continuam restritos ao próprio domínio.
- Carrinhos seguem o escopo de acesso da base de leads (vendedor só vê os carrinhos dos próprios leads). Eliminação do lead apaga os carrinhos e desliga os pedidos da pessoa.
- Eventos de compra do site (carrinho, checkout, compra) chegam pelo mesmo canal do rastreamento: lista fechada de eventos, até 30 produtos por evento, valores numéricos validados; o dispositivo é guardado só como categoria (celular, computador, tablet, app).

## Captura: formulários, pop-ups e WhatsApp (v0.5.0)

- Rotas públicas `/api/public/captura/*` sem sessão e fora do CSRF; respondem (e liberam CORS) só para os domínios do site cadastrados no rastreamento. Resposta recusada não vai para cache.
- Envio validado contra a definição do formulário: só os campos dele entram (nada de campos extras), tamanhos limitados, e-mail e telefone normalizados, opções de lista conferidas.
- Antirrobô: campo-isca invisível e tempo mínimo de preenchimento (envio de robô recebe "ok" e é descartado), limite de 10 envios por minuto por IP.
- O número do WhatsApp central não vai para o site: o link `wa.me` só é devolvido depois do cadastro do visitante.
- No site, tudo é montado com `createElement`/`textContent` dentro de Shadow DOM: textos do painel nunca viram HTML, e o CSS da loja não interfere.
- Consentimento (LGPD): caixa nunca pré-marcada; o aceite fica em `lead_consents` com texto, data, origem e IP; link da política de privacidade em todos os formulários.
- Cada envio fica em `capture_submissions` (prova da conversão). Eliminação do lead apaga também os envios da pessoa.

## Fase 8: sessões, avisos e servidor (v0.9.0)

- **Aparelhos conectados** (Meu perfil): cada login aberto com navegador, sistema, IP, início e último uso; desconectar um aparelho ou todos os outros. O administrador vê os aparelhos de qualquer usuário e pode desconectá-lo de todos (Usuários → Aparelhos conectados).
- **Avisos por e-mail**: acesso por aparelho novo (navegador + sistema não usados nos últimos 180 dias; o primeiro acesso da conta não avisa), conta bloqueada por tentativas, senha trocada ou redefinida, 2FA desativado, reconfigurado ou zerado pelo administrador, e código de recuperação usado. O e-mail mostra só o começo do IP. Falha no envio não bloqueia a ação (vai para o log).
- **Reconfigurar o 2FA exige a senha**: sem isso, uma sessão roubada poderia trocar o 2FA da conta pelo celular de outra pessoa.
- Limpeza diária das sessões vencidas (os tokens trocados e ainda válidos ficam, para detectar roubo de sessão).
- Servidor: `deploy/seguranca-vps.sh` faz um diagnóstico só de leitura (portas abertas, containers expostos, ufw, SSH, fail2ban, tentativas no login, atualizações, relógio, backups) e, com `--fail2ban`, ativa as regras do SSH e do login do CRM, sempre deixando de fora o IP de quem está conectado. Firewall e SSH não são alterados automaticamente porque a VPS tem outros sistemas.
- Backup: `deploy/restaurar.sh --teste` restaura num banco separado e compara as contagens (usuários, leads, atendimentos, pedidos, campanhas, auditoria) com a produção.
- Carga: `scripts/teste-carga.mjs` simula a equipe nas telas mais pesadas (só leitura). Resultado local em 08/10/2026: 25 usuários simultâneos com mediana entre 150 e 250 ms e p95 abaixo de 450 ms (Visão geral até 730 ms).

### Revisão OWASP Top 10 (08/10/2026)

| Item | Situação |
|---|---|
| A01 Controle de acesso | Guard global, permissão por rota no servidor, escopo próprio/unidade também nos relatórios e carrinhos; arquivos privados conferidos pela empresa |
| A02 Criptografia | Argon2id, AES-256-GCM para segredos (2FA, SMTP, Magazord, Meta, chave do GA4), HTTPS com HSTS |
| A03 Injeção | Prisma parametrizado; no criador de relatórios todo SQL vem de uma lista fixa e os valores vão como parâmetro; CSV protegido contra fórmulas; HTML de e-mail sanitizado por lista de permissões |
| A04 Design inseguro | Corrigido: reconfigurar o 2FA sem senha. Corrigido: limite de uso por IP que somava o escritório inteiro |
| A05 Configuração | Cabeçalhos de segurança, containers sem root e só leitura, banco sem porta publicada |
| A06 Componentes | `npm audit --omit=dev`: 0 vulnerabilidades |
| A07 Autenticação | Bloqueio progressivo, 2FA com proteção contra reuso, avisos por e-mail, sessões por aparelho |
| A08 Integridade | Auditoria encadeada por hash e protegida por trigger; imagens publicadas pelo GitHub Actions |
| A09 Registro e monitoramento | Auditoria de login, sessões, exportações e configurações; fail2ban lendo o log do CRM |
| A10 SSRF | SMTP recusa rede interna; Magazord só `*.magazord.com.br`; Meta e Google com endereços fixos |

## Pendências planejadas

- Limite de requisições compartilhado em Redis (hoje em memória, suficiente para uma instância da API).
- Política de retenção configurável (anonimizar automaticamente leads inativos há X meses).
- Teste de intrusão externo por terceiro (recomendado antes de abrir o sistema para outras empresas).
