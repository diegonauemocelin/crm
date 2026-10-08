# Implantação na VPS (Locaweb)

Tudo roda em containers próprios (`usaparts-crm`), com rede, banco e volumes isolados. A única mudança fora dos containers é **um vhost novo no Nginx** para `crm.usaparts.com.br` e o certificado HTTPS desse domínio. Nenhum outro site, banco, container ou regra de firewall é alterado.

**Memória:** a VPS tem 2 GB e já roda outros sistemas (BI, painel). Por isso a VPS **não compila nada**. A cada versão publicada, o GitHub Actions constrói as imagens e publica em `ghcr.io/diegonauemocelin/crm-*`, e o deploy só as baixa. Em uso normal o CRM ocupa cerca de 300 MB, com limites rígidos por container (banco 384 MB, API 384 MB, frontend 64 MB, backup 128 MB). Na Fase 2 (WhatsApp/Evolution API) será preciso reavaliar a memória; o recomendado é passar a VPS para 4 GB.

## 0. Inventário (obrigatório antes de instalar)

Somente leitura: não instala nem altera nada.

```bash
sudo bash deploy/inventario.sh crm.usaparts.com.br
```

Envie o relatório gerado (`inventario-*.txt`) para conferência. Ele mostra portas em uso, sites do Nginx, containers, firewall, certificados e se o DNS já aponta para a VPS.

## 1. Pré-requisitos

- **Docker e Compose v2.** Se o inventário mostrar que não estão instalados, use o repositório oficial do Docker. Isso adiciona o Docker ao servidor, mas não mexe nos serviços existentes:

  ```bash
  curl -fsSL https://get.docker.com | sudo sh
  ```

- **Nginx e Certbot.** Já estão na VPS (usados pelo agente do Mercado Livre).
- **Git**:

  ```bash
  sudo apt-get install -y git
  ```

## 2. Chave de backup (no SEU computador, não na VPS)

Os backups são criptografados com uma chave pública. A chave privada fica só com você: quem invadir a VPS não consegue ler os backups.

No Windows, instale o `age` (https://github.com/FiloSottile/age/releases) e rode:

```bash
age-keygen -o chave-backup-crm.txt
```

O comando mostra `Public key: age1...`. Essa é a chave pública que vai para a VPS. Guarde o arquivo `chave-backup-crm.txt` em um local seguro e com cópia (por exemplo, um gerenciador de senhas). **Sem ele, os backups não podem ser restaurados.**

## 3. Baixar o código na VPS

Repositório privado: crie uma *deploy key* somente leitura (GitHub → repositório → Settings → Deploy keys) ou um token fine-grained somente leitura.

```bash
sudo git clone https://github.com/diegonauemocelin/crm.git /opt/usaparts-crm
```

## 4. Instalar

```bash
cd /opt/usaparts-crm && sudo BACKUP_AGE_RECIPIENT="age1...sua-chave-publica" bash deploy/instalar.sh crm.usaparts.com.br seu-email@usaparts.com.br "Seu Nome"
```

O script:

1. confere os pré-requisitos e **para sem alterar nada** se a porta 8180 ou o domínio já estiverem em uso;
2. cria o `.env` com segredos aleatórios (permissão 600);
3. sobe os containers, aplica as migrations e cria o primeiro administrador (a senha provisória aparece uma única vez no terminal);
4. cria `/etc/nginx/sites-available/usaparts-crm`, valida com `nginx -t` (se falhar, remove o vhost e para) e recarrega o Nginx;
5. emite o certificado Let's Encrypt **só para o domínio do CRM**, com redirecionamento HTTP→HTTPS e HSTS. A renovação automática já existente do certbot passa a cobrir o domínio.

> **Guarde também o `APP_ENCRYPTION_KEY`** do `/opt/usaparts-crm/.env` junto da chave de backup. Ele criptografa os segredos do 2FA e a senha do SMTP; numa restauração em outro servidor, ele é necessário.

Depois, confira:

```bash
node scripts/teste-fumaca.mjs https://crm.usaparts.com.br
```

## 5. Atualizar para uma nova versão

```bash
cd /opt/usaparts-crm && sudo bash deploy/deploy.sh
```

Sem argumento, instala a última versão publicada (tag `vX.Y.Z`). Para uma versão específica, use `sudo bash deploy/deploy.sh v0.2.0`.

O deploy faz backup, troca o código, constrói as imagens, aplica migrations, sobe e confere a saúde **na versão esperada**. Se algo falhar, volta sozinho para a versão anterior.

## 6. Rollback manual

```bash
sudo bash deploy/rollback.sh
```

Volta para a versão instalada antes da atual (ou informe a versão: `deploy/rollback.sh v0.1.0`). O rollback troca o código, mas **não desfaz migrations**. Se a versão nova mudou o banco de forma incompatível, restaure o backup feito antes do deploy (passo 8).

## 7. Backup

- **Automático:** todo dia às 3h (`BACKUP_HOUR`), com retenção de 30 dias (`BACKUP_RETENTION_DAYS`), em `/opt/usaparts-crm/backups`. Inclui banco e arquivos enviados (logos, fotos), criptografados e com checksum.
- **Imediato:**

  ```bash
  sudo bash deploy/backup-agora.sh
  ```

- **Cópia externa (recomendado):** copie periodicamente a pasta `backups/` para fora da VPS (por exemplo, para o seu computador com `scp`). Os arquivos já estão criptografados.

## 8. Restauração

Teste mensal, **sem afetar produção**: restaura num banco temporário, confere as tabelas e o apaga.

```bash
sudo bash deploy/restaurar.sh --teste backups/crm-db-AAAAMMDD-HHMMSS.dump.age /root/chave-backup-crm.txt
```

Restauração real: substitui os dados atuais, pede a confirmação `RESTAURAR` e faz um backup do estado atual antes.

```bash
sudo bash deploy/restaurar.sh backups/crm-db-AAAAMMDD-HHMMSS.dump.age /root/chave-backup-crm.txt
```

Copie a chave privada para a VPS só no momento da restauração e apague em seguida:

```bash
sudo shred -u /root/chave-backup-crm.txt
```

## 9. Operação do dia a dia

| Tarefa | Comando (em `/opt/usaparts-crm`) |
|---|---|
| Ver status | `sudo docker compose ps` |
| Ver logs da API | `sudo docker compose logs -f --tail=100 api` |
| Reiniciar | `sudo docker compose restart` |
| Histórico de deploys | `cat .deploy/historico.log` |

## Firewall

Não é preciso abrir portas: o CRM publica apenas `127.0.0.1:8180`, que não é acessível de fora, e usa as portas 80 e 443 do Nginx já liberadas. O banco não tem porta publicada.

## Remover completamente (se um dia necessário)

```bash
cd /opt/usaparts-crm && sudo docker compose down
```

```bash
sudo rm /etc/nginx/sites-enabled/usaparts-crm /etc/nginx/sites-available/usaparts-crm && sudo nginx -t && sudo systemctl reload nginx
```

Os dados ficam nos volumes `usaparts-crm_pgdata` e `usaparts-crm_uploads` até serem removidos explicitamente com `docker volume rm`.

## Segurança do servidor (Fase 8)

```bash
cd /opt/usaparts-crm && sudo bash deploy/seguranca-vps.sh
```

Diagnóstico só de leitura: portas abertas, containers expostos, firewall, SSH, fail2ban, tentativas de login, atualizações, relógio e backups. Não altera nada.

```bash
cd /opt/usaparts-crm && sudo bash deploy/seguranca-vps.sh --fail2ban
```

Instala e ativa o fail2ban com duas regras: SSH (5 erros em 10 min banem o IP por 1 h) e login do CRM (15 erros em 10 min, lendo só o log do CRM). O IP de quem está conectado por SSH no momento fica de fora. Para desfazer: apague `/etc/fail2ban/jail.d/usaparts-crm.conf` e rode `systemctl restart fail2ban`. Para desbanir: `sudo fail2ban-client unban <ip>`.

Firewall (ufw) e configuração do SSH não são alterados por script, porque a VPS tem outros sistemas.
