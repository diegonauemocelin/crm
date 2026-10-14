# Integração com a Tcar (ERP): consulta de produtos

O CRM copia os produtos da Tcar (códigos, título, marca, aplicação, estoque e preço) para a tela
**Atendimento Comercial → Consulta de produtos**. A conexão usa o **PingAlive** da própria Tcar:

- o servidor da Tcar (na rede da empresa) chama o CRM a cada poucos segundos;
- o CRM responde só com **consultas de produtos** (`GET /produtos`), nunca com alterações;
- não precisa abrir porta no firewall nem expor a Tcar na internet;
- a senha do usuário Tcar fica no servidor da Tcar; o CRM nunca a recebe;
- o custo contábil não é copiado.

## 1. No CRM (administrador)

1. Configurações → **Tcar (ERP)** → **Gerar chave**. Copie a chave na hora (ela não aparece de novo).
2. Copie o trecho de configuração mostrado na tela (já vem com os endereços do CRM).

## 2. No servidor da Tcar (TI ou suporte Tcar)

No arquivo `config/tcarwebserver.ini`:

```ini
[ServerIdentity]
CompanyID=<código da empresa na Tcar>
BranchID=<código da filial do servidor>
APIKey=<API key local da Tcar>
Version=<versão>
ActionUserName=<usuário Tcar só de consulta>
ActionPassword=<senha desse usuário>

[PingAlive]
Enabled=1

[PingAliveServer_1]
Enabled=1
ServerURL=https://crm.usaparts.com.br/api/webhooks/tcar/ping
ReportURL=https://crm.usaparts.com.br/api/webhooks/tcar/report
IntervalSeconds=10
APIKey=<chave gerada no CRM>
```

Recomendações:

- use um usuário Tcar **só de consulta** em `ActionUserName` (o CRM só pede leituras, mas assim a Tcar também garante);
- depois de salvar, reinicie o TCarWebServer; em `GET /health`, o bloco `ping_alive` deve mostrar `running`.

## 3. Ligar

De volta ao CRM, ligue a integração e salve. No primeiro contato:

- o CRM fixa a empresa e a filial (contatos de outra empresa passam a ser recusados);
- começa a cópia completa, em páginas de 200 produtos.

Depois disso:

- os produtos alterados vêm a cada 10 minutos;
- a cópia completa (para atualizar estoque e preço) roda a cada 6 horas. Os dois intervalos podem ser ajustados.

Na consulta, o botão de atualizar de cada peça pede o estoque e o preço na hora (resposta em alguns segundos).

## "Utilizado em"

A API atual da Tcar não envia em quais máquinas a peça serve. Quando o suporte da Tcar incluir esse dado na
resposta de `GET /produtos`:

1. informe o nome do campo em Configurações → Tcar (ERP) → **Campo do "utilizado em"** (ex.: `epctb_utilizadoem`);
2. clique em **Copiar tudo de novo**.

## Problemas comuns

| Situação na tela | O que conferir |
|---|---|
| "Sem contato" | TCarWebServer ligado, `[PingAlive] Enabled=1`, ServerURL correta, internet no servidor da Tcar |
| "Contato recusado: empresa/filial diferente" | CompanyID/BranchID do ini; se mudou de propósito, use "Esquecer empresa/filial" |
| Erro 401 nas consultas | `ActionUserName`/`ActionPassword` ausentes ou errados no ini |
| Chave vazada ou trocada | Gere nova chave no CRM (a anterior deixa de valer) e atualize o ini |
