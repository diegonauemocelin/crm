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

## WhatsApp (Fase 9, Evolution API)

O WhatsApp fica **desligado** até ser ativado. A Evolution API e o Redis sobem só com `COMPOSE_PROFILES=whatsapp` no `.env`,
sem nenhuma porta publicada: só a API do CRM fala com eles, pela rede interna do Docker. As conversas ficam no CRM
(com as regras de LGPD); a Evolution guarda só as sessões dos aparelhos (volume `evolution`).

```bash
sudo bash deploy/whatsapp.sh status        # situação, versão, memória e quedas da conexão nas últimas 24 h
sudo bash deploy/whatsapp.sh reiniciar     # reinicia a Evolution; os números reconectam sozinhos, sem QR Code
sudo bash deploy/whatsapp.sh ativar        # gera as chaves no .env, cria o banco "evolution" e sobe tudo
sudo bash deploy/whatsapp.sh atualizacao-automatica ligar   # confere toda semana (domingo, 4h), só versões estáveis 2.x
sudo bash deploy/whatsapp.sh atualizar     # atualiza na hora (volta sozinho para a versão anterior se a nova não responder)
sudo bash deploy/whatsapp.sh desativar     # para a Evolution; as sessões ficam guardadas
```

- **Memória:** o `ativar` recusa com menos de 700 MB livres (`--forcar` passa por cima, por sua conta). Evolution + Redis usam
  por volta de 400-600 MB com 3 números conectados.
- **Limites:** `WHATSAPP_MAX_NUMBERS` (padrão 10 cadastrados) e `WHATSAPP_MAX_CONNECTED` (padrão 3 conectados ao mesmo tempo).
  Depois do upgrade da VPS: `sudo bash deploy/whatsapp.sh limite 5`.
- **Números:** cadastrados e conectados no CRM (Atendimento → Números de WhatsApp), lendo o QR Code no WhatsApp Business do
  celular. Para conectar um 4º, desconecte um (voltar exige ler o QR Code de novo).
- **Chaves:** `EVOLUTION_API_KEY` (CRM → Evolution) e `EVOLUTION_WEBHOOK_SECRET` (Evolution → CRM) ficam só no `.env`.
- **Backup:** o backup diário copia o banco do CRM (onde ficarão as conversas). As sessões não entram: se o volume `evolution`
  se perder, basta ler o QR Code de novo em cada número.

## Raio-x e backup completo do servidor

**Raio-x (só leitura):** mostra uso de CPU, memória e disco, os sistemas instalados (projetos Docker, containers,
sites do Nginx, serviços), os bancos de dados de cada um (com tamanho) e se cabe mais um sistema. Não altera nada e
não mostra senhas.

```bash
cd /opt/usaparts-crm && sudo bash deploy/raio-x.sh
```

**Backup completo da VPS** (além do backup diário do CRM): bancos de todos os sistemas (PostgreSQL, MySQL/MariaDB,
MongoDB, Redis, em container ou instalados direto), volumes do Docker, pastas dos sistemas (/opt, /var/www, /srv,
/usr/local e projetos docker compose fora delas), configurações do servidor (/etc: Nginx, certificados, cron),
/root e /home, e a lista de pacotes. Não para nenhum sistema. Tudo sai criptografado com a chave pública do backup
(`BACKUP_AGE_RECIPIENT`): só abre com a chave privada, que fica com você.

```bash
cd /opt/usaparts-crm && sudo bash deploy/backup-servidor.sh
```

Salva em `/var/backups/servidor/AAAAMMDD-HHMM` (guarda os 3 últimos completos) com um `LEIA-ME.txt` dizendo o que
entrou e como restaurar cada parte. Para outro disco: `--destino /mnt/disco`. Volumes acima de 10 GB ficam de fora
(avisado no LEIA-ME), a não ser com `--tudo`. Baixe para o seu computador (PowerShell):

```powershell
scp -r usuario@IP-DA-VPS:/var/backups/servidor/AAAAMMDD-HHMM C:\Backups\
```

Antes de mudanças grandes no servidor, faça também o **snapshot** no painel do provedor da VPS: é a cópia do disco
inteiro e volta tudo em minutos.

### Backup no Google Drive (sem ocupar o disco da VPS)

Com `--drive`, cada parte é criptografada e enviada direto ao Google Drive enquanto é gerada: nada fica no disco da
VPS (só um registro pequeno em `/var/tmp/backup-servidor/ultimo.log`). No Drive ficam os 3 últimos completos, cada um
com `LEIA-ME.txt`, `COMO-REINSTALAR.txt` (passo a passo para remontar o servidor, com os nomes desta VPS) e `MD5SUMS`.

**Uma vez só — ligar a VPS ao Google Drive (rclone):**

1. Na VPS: `apt install -y rclone`
2. No seu computador (Windows): baixe o rclone em https://rclone.org/downloads/ (Windows, Intel/AMD 64 bits),
   descompacte e, no PowerShell, dentro da pasta: `.\rclone.exe authorize "drive"`. Abre o navegador: entre com a conta
   Google que vai guardar os backups e autorize. O PowerShell mostra um código (um texto entre chaves) — copie.
3. Na VPS: `rclone config` → `n` (novo) → nome `gdrive` → tipo `drive` → client_id e client_secret em branco →
   scope `1` (acesso total) ou `3` (só arquivos criados pelo rclone, mais seguro) → service_account_file em branco →
   advanced `n` → auto config **`n`** → cole o código do passo 2 → shared drive `n` → `y` para salvar → `q`.
4. Teste: `rclone lsd gdrive:`

**Backup no Drive:**

```bash
bash /opt/usaparts-crm/deploy/backup-servidor.sh --drive gdrive:Backups-VPS
```

**Automático toda semana** (domingo às 4h), com `crontab -e` como root:

```
0 4 * * 0 bash /opt/usaparts-crm/deploy/backup-servidor.sh --drive gdrive:Backups-VPS >> /var/log/backup-servidor.log 2>&1
```

Para restaurar, baixe a pasta do Drive para o computador ou para a VPS nova e siga o `COMO-REINSTALAR.txt`. A chave
privada (`chave-backup-crm.txt`) é necessária para abrir as partes: guarde em lugar seguro e fora do Drive.

## Mercado Livre no CRM (Marketplaces)

Em **Marketplaces › Conexões**, conecte o Mercado Livre (Ads e vendas). O antigo Usaparts BI (`/opt/usaparts-bi`) não é mais importado: o painel de Ads do CRM busca tudo direto no Mercado Livre. Quando o CRM estiver conectado, pare o BI:

```bash
cd /opt/usaparts-bi && sudo docker compose stop app worker
```

## Trazer o assistente das perguntas (painel.usaparts.com.br)

O Usaparts Assistente (`/opt/usaparts-assistente`) passa a fazer parte do CRM, em **Marketplaces › Assistente**: perguntas e respostas do Mercado Livre, base de conhecimento, importação por planilha, aplicações peça × máquina, anúncios da loja, vendas ligadas às perguntas, configurações de IA (Sem IA, Gemini ou Claude) e o frete calculado pela Magazord. O comando abaixo copia **tudo** do painel para o CRM, sem alterar nada no painel e com os dois no ar:

```bash
sudo bash /opt/usaparts-crm/deploy/importar-painel.sh
```

- Antes, faz o backup do CRM e guarda uma cópia criptografada da pasta de dados e do `.env` do painel na pasta de backups do CRM (`painel-dados-*.tar.gz.age`, mesma chave dos backups do CRM). Essa cópia não é apagada pela limpeza automática.
- Os usuários do painel viram referências aos usuários do CRM com o mesmo e-mail (quem não existir no CRM fica só com o nome no histórico).
- As chaves de IA e o acesso ao Mercado Livre do painel vêm junto, já criptografados com a chave do CRM.
- **O CRM não responde nada sozinho** depois da importação: o painel continua respondendo. Pode rodar o comando de novo quantas vezes quiser (troca os dados pelos mais novos, sem duplicar).
- Libere as permissões do grupo **Marketplaces** (Assistente: atendimento, base de conhecimento, aplicações e configurações) nos perfis de acesso de quem vai usar.

### Passar o atendimento para o CRM

1. No aplicativo do Mercado Livre usado pelo painel (developers.mercadolivre.com.br › Meus aplicativos), troque a **URL de notificações** para `https://SEU-DOMINIO/api/webhooks/mercadolivre` com os tópicos **questions** e **orders_v2**, e acrescente a **URI de redirecionamento** que aparece em Marketplaces › Conexões. Confira as permissões: Perguntas e respostas (leitura e escrita), Vendas e acesso offline.
2. Em **Marketplaces › Assistente › Integração**, clique em **Assumir o atendimento** (marcando "usar o acesso do painel" para não precisar conectar de novo). O CRM testa a conexão, passa a buscar as perguntas a cada minuto e responde conforme as configurações importadas.
3. Pare o painel, para os dois não responderem a mesma pergunta:

```bash
sudo systemctl disable --now usaparts.service
```

Para voltar ao painel: **Liberar o atendimento** no CRM e `sudo systemctl enable --now usaparts.service`. Depois de assumir, o importador se recusa a rodar, para não apagar o que o CRM já respondeu.

## Enxugar o servidor (deixar só o CRM)

Desliga e depois apaga os sistemas antigos (Usaparts BI e o painel do assistente) e os bancos deles, para sobrar memória e disco para o CRM. São três passos, cada um rodado por você:

```bash
sudo bash /opt/usaparts-crm/deploy/enxugar-servidor.sh            # 1. verificar: só lê e mostra o que há
sudo bash /opt/usaparts-crm/deploy/enxugar-servidor.sh desligar   # 2. backup criptografado + para e desativa
sudo bash /opt/usaparts-crm/deploy/enxugar-servidor.sh apagar     # 3. remove de vez (pede para digitar APAGAR)
```

- **desligar**: faz o backup do CRM e guarda cópias criptografadas do banco e da pasta do BI (`bi-db-*.dump.age`, `bi-pasta-*.tar.gz.age`) e da pasta do painel (`painel-pasta-*.tar.gz.age`) na pasta de backups do CRM. Para os containers do BI (sem subir de novo ao reiniciar), desativa o `usaparts.service`, pausa as tarefas de backup deles no cron e tira os sites antigos do Nginx. Nada é apagado.
- O painel só é desligado depois de importado (`deploy/importar-painel.sh`) **e** de o CRM assumir o atendimento (Marketplaces › Assistente › Integração › Assumir o atendimento). Antes disso, o script desliga só o BI e avisa.
- **apagar**: remove o que já foi desligado: containers, volumes (o banco PostgreSQL do BI), imagens, as pastas `/opt/usaparts-bi` e `/opt/usaparts-assistente` (banco SQLite), o backup sem criptografia do painel em `/opt/backups/usaparts`, o serviço e a tarefa do cron. As cópias criptografadas continuam na pasta de backups do CRM.
- O que a verificação lista em "Outros containers", "Serviços próprios" e "Bancos fora do Docker" não é tocado: confira e decida um a um.

Para voltar um sistema depois do **desligar** (antes do apagar): `cd /opt/usaparts-bi && sudo docker compose up -d` (BI) ou `sudo systemctl enable --now usaparts.service` (painel; no CRM, Liberar o atendimento antes); as tarefas do cron pausadas ficam com `#enxugar#` no começo (`sudo crontab -e` e tire o prefixo), e os sites do Nginx guardados em `/opt/usaparts-crm/.deploy/enxugar/nginx` voltam para `/etc/nginx/sites-enabled/` (depois `sudo nginx -t && sudo systemctl reload nginx`).
