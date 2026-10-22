# Landing pages no subdomínio (lp.usaparts.com.br)

As landing pages são criadas no CRM (E-mail marketing › Landing pages) e servidas pelo próprio servidor do CRM.
Enquanto o subdomínio não estiver pronto, cada página já funciona em `https://crm.usaparts.com.br/lp/<endereco>`.

## 1. DNS (TI / quem administra o domínio usaparts.com.br)

Crie **um** registro para o subdomínio, apontando para a VPS do CRM:

| Tipo  | Nome | Valor                                   |
|-------|------|-----------------------------------------|
| CNAME | lp   | crm.usaparts.com.br                     |

(ou um registro **A** `lp` com o IP da VPS). Espere a propagação (minutos a algumas horas).

## 2. Servidor (uma vez)

Na VPS, dentro de `/opt/usaparts-crm`:

```bash
sudo bash deploy/landing-pages.sh lp.usaparts.com.br ti@usaparts.com.br
```

O script confere o DNS, cria **um** vhost novo no Nginx (`usaparts-crm-lp`) e emite o certificado HTTPS só para o
subdomínio. Não mexe no CRM nem em outros sites.

## 3. No CRM

E-mail marketing › Landing pages › **Subdomínio e medição**:

- **Subdomínio**: `lp.usaparts.com.br`
- **Quem abrir o subdomínio sem página vai para**: `https://www.usaparts.com.br`
- **GA4 – ID de medição** (G-…): o mesmo do site, para ver tudo junto no Analytics.
- **Meta Pixel – ID**: do Gerenciador de Eventos.
- **Conversões do Google Ads**: usa a tag cadastrada em Captura › Google Ads.

Para ligar as visitas da LP ao histórico do lead (rastreamento do CRM), o domínio `usaparts.com.br` precisa estar
em Configurações › Rastreamento do site (ele cobre os subdomínios).

## Como funciona

- `lp.usaparts.com.br/<pagina>` → Nginx do servidor → container web (`/lp/<pagina>`) → API.
- Formulário, contagem de visitas e imagens vão em `lp.usaparts.com.br/api/...` (mesmo endereço da página).
- GA4, Meta Pixel e Google Ads só carregam depois do aceite de cookies (LGPD).
- Só o formulário preenchido vira lead (Captura, com a página como origem). Visitas e cliques entram só nas métricas.
