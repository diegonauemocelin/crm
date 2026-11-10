# Integração CRM Usaparts ↔ TCarWebServer (PingAlive)

Documento para a equipe da Tcar. Explica como o CRM conversa com o TCarWebServer, com foco na **importação de
orçamento e pré-nota para a cotação de frete**. Nenhuma chave ou senha aparece aqui. Quem passa os valores é a
Usaparts, por um canal seguro.

## 1. Visão geral

O CRM nunca chama a Tcar diretamente. Quem inicia o contato é o TCarWebServer, pelo PingAlive descrito na
documentação da API Tcar:

1. **Ping.** O TCarWebServer faz `POST` no **ServerURL** do CRM a cada poucos segundos (keepalive).
2. **Ações.** O CRM responde com as consultas pendentes (`actions`).
3. **Execução.** O TCarWebServer executa cada ação localmente na própria API, com o usuário `ActionUserName`.
4. **Resultado.** O TCarWebServer envia o resultado com `POST` no **ReportURL**.

As consultas são todas de leitura (`GET`), em rotas que já existem na documentação da API.

| Item | Valor |
|---|---|
| ServerURL (ping) | `https://<domínio do CRM>/api/webhooks/tcar/ping` |
| ReportURL (resultado) | `https://<domínio do CRM>/api/webhooks/tcar/report` |
| Autenticação | header `x-api-key` com a APIKey do `PingAliveServer_N` (o CRM guarda só o hash) |
| Limite de chamadas | ping: 120/min; report: 300/min |
| Tamanho máximo do report | 24 MB |
| Offline | o CRM considera a Tcar desconectada após 2 min sem ping |

## 2. Ping (keepalive)

O TCarWebServer envia `POST /api/webhooks/tcar/ping` com o header `x-api-key`.

Corpo enviado pela Tcar (campos que o CRM lê):

```json
{ "company_id": 1, "branch_id": 1, "hostname": "SRV-TCAR", "ip_detected": "...", "version": "...", "uptime_seconds": 3600 }
```

- O primeiro ping fixa a empresa e a filial no CRM.
- Depois disso, um ping de outra empresa ou filial é recusado com `403`.

Resposta do CRM:

```json
{
  "status": "success",
  "actions": [
    { "transaction": "<uuid>", "cmd": "/orcamentos/12345", "verb": "GET",
      "query_params": { "incluir_servicos": "false", "incluir_servicos_terceiros": "false" }, "data": {} }
  ]
}
```

Quantidade máxima de ações por ping:

| Tipo de consulta | Máximo por ping |
|---|---|
| Tela (orçamento, pré-nota, cliente, consulta de peça) | 20 |
| Cópia de produtos | 4 |
| Fotos | 2 |

## 3. Report (resultado)

O TCarWebServer envia `POST /api/webhooks/tcar/report` com o header `x-api-key`:

```json
{ "transaction": "<uuid recebido no ping>", "result_code": 200, "execution_time_ms": 120, "data": { ... resposta da API ... } }
```

Como o CRM trata o `result_code`:

| `result_code` | O que o CRM faz |
|---|---|
| `200` | Processa o `data` |
| `404` | Mostra "não encontrado" ao usuário. Não conta como falha da integração |
| `5xx` | Tenta de novo, até 3 tentativas |
| Outros | Registra o erro. A mensagem é lida de `data.message`, se houver |

- **Sem resposta:** uma ação enviada e sem report em 10 minutos volta para a fila, também até 3 tentativas.
- **Transação desconhecida:** recebe `{"status":"success"}` e é ignorada.

## 4. Importar orçamento ou pré-nota para a cotação de frete

Na tela de cotação, o usuário escolhe **Orçamento** ou **Pré-nota (venda)**, digita o número e clica em
"Importar do Tcar". Para a Usaparts, a pré-nota é sempre uma venda.

### 4.1 Sequência

1. **Documento.** O CRM coloca na fila uma das duas consultas:
   - `GET /orcamentos/{numero}?incluir_servicos=false&incluir_servicos_terceiros=false`. Os serviços ficam de fora porque o frete é só das peças.
   - `GET /pre-notas/{numero}`.

   O número tem só dígitos, de 1 a 12.
2. **Cliente.** Se o documento tiver cliente, o CRM pede `GET /clientes/{codigo}` só para ler o endereço de entrega.
3. **Peso.** O peso sai do cadastro de produtos que o CRM já copiou da Tcar (`GET /produtos`, abaixo): quantidade ×
   peso bruto de cada peça. Peças sem peso aparecem para o usuário completar.

**Importante:** a consulta só enxerga a filial do servidor Tcar que faz o ping (`branch_id`). Um documento de outra
filial volta `404`.

### 4.2 Campos lidos: orçamento (`/orcamentos/{numero}`)

| Campo da API | Uso no CRM |
|---|---|
| `atorc_numero` | Número |
| `fll_codigo` | Filial |
| `atorc_situacao` | Situação |
| `atorc_dtaemi` | Emissão |
| `atorc_totalpeca` | Total das peças |
| `atorc_totalgeral` | Total geral |
| `cln_codigo_cliente` | Código do cliente, usado em `/clientes` |
| `cliente_nome` / `cliente_fantasia` | Nome do cliente |
| `cliente_cnpj` | CNPJ ou CPF, só para saber se é PF ou PJ |
| `itens[].atoit_codigo` | Código da peça |
| `itens[].atoit_descricao` | Descrição |
| `itens[].atoit_qtdade` | Quantidade |
| `itens[].atoit_vlr_unitario` | Valor unitário |
| `itens[].atoit_vlr_total` | Valor total do item |

### 4.3 Campos lidos: pré-nota (`/pre-notas/{numero}`)

| Campo da API | Uso no CRM |
|---|---|
| `cabecalho.numero` (ou `chave.id`) | Número |
| `cabecalho.situacao` | Situação |
| `cabecalho.data_emissao` | Emissão |
| `filial.codigo` (ou `chave.filial`) | Filial |
| `fornecedor.codigo` | Código do cliente (na venda, o bloco `fornecedor` é o cliente) |
| `fornecedor.nome` / `fornecedor.fantasia` | Nome do cliente |
| `fornecedor.cnpj_cpf` | CNPJ ou CPF |
| `totais.valor_produtos` | Total dos produtos |
| `totais.valor_total` | Total |
| `totais.valor_frete` | Frete |
| `itens[].produto_codigo` | Código da peça |
| `itens[].descricao` | Descrição |
| `itens[].quantidade` | Quantidade |
| `itens[].valor_unitario` | Valor unitário |
| `itens[].valor_liquido` (ou `valor_total`) | Valor do item |

### 4.4 Campos lidos: cliente (`/clientes/{codigo}`)

O CRM lê só `cep_cep`, `cidade_nome`, `uf_estado` e `cdd_codigo` (IBGE). Pela LGPD, nenhum outro dado do cliente
é guardado.

## 5. Outras consultas que o CRM faz

| Consulta | Quando |
|---|---|
| `GET /produtos?limit=200&offset=N&incluir_referencias=S[&include=filiais&branch_ids=..]` | Cópia completa a cada 6 h, página a página |
| `GET /produtos?...&alterado_desde=<data>` | Produtos alterados, a cada 10 min |
| `GET /produtos/{codigo}[?include=filiais&branch_ids=..]` | Consulta de uma peça na tela |
| `GET /produtos/{codigo}/fotos?max_fotos=6` | Fotos, aos poucos (2 por ping) |

Do cadastro de produtos, o CRM usa o peso de `epctb_pesobruto` e `epctb_pesoliq`.

**Segurança.** O CRM só gera ações dentro desta lista: rota exata, verbo `GET` e só os parâmetros acima. Qualquer
outra ação é bloqueada antes de sair. Sugerimos que a Tcar também restrinja o usuário do PingAlive a essas rotas,
só em leitura.

## 6. O que pedimos à Tcar para incluir na API

Para a cotação de frete ficar completa:

1. **Pré-nota → orçamento:** o número do orçamento de origem na pré-nota.
2. **Frete do orçamento (tela AT125F):** transportadora, modalidade (CIF/FOB), valor do frete e volumes.
3. **Produto:** dimensões (altura, largura, comprimento em cm), NCM, ativo/inativo e embalagem/volumes.
4. **Lista de transportadoras:** código, nome e CNPJ.
5. **Estoque e preço com `alterado_desde`**, para buscar só o que mudou.
6. **NF-e emitida em JSON:** dados de transporte, com `alterado_desde`.
7. **Limites de uso:** documentar o limite de chamadas e devolver `429` quando passar dele.
8. **Acesso:** um usuário só de leitura para o PingAlive, e as rotas `/health` e `/metrics` fechadas para fora.

Contato técnico: setor de TI da Usaparts.
