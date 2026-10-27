# Gestão de Fretes — projeto e MVP

Módulo **separado** dentro do CRM Usaparts (mesmo login, mesmos perfis, mesma auditoria), com menu próprio
**Fretes** e permissões próprias. Referência funcional: telas do Frete Gestão (tabelas, regras, componentes,
histórico de importação, vigência e filiais). Nada do sistema de referência é copiado: o código é próprio.

Este documento responde à seção 24 do pedido (o que apresentar antes de programar) e registra o que já está
entregue no MVP (v0.99.0).

## 1. Arquitetura

```
Navegador (React) ─► Nginx ─► API NestJS  ─► PostgreSQL
                                 │
                                 ├─ src/fretes/formula.ts      interpretador de fórmulas (sem eval)
                                 ├─ src/fretes/motor.ts        cubagem, escolha da regra, componentes, ICMS
                                 ├─ src/fretes/importacao.ts   leitura e validação de planilhas
                                 ├─ src/fretes/*.service.ts    regras de negócio + permissão + auditoria
                                 └─ integrações (fase 3+): SEFAZ DF-e, Correios, Mercado Livre, Google, Tcar
```

- **Regras de negócio sem banco e sem rede** (`formula.ts`, `motor.ts`, `importacao.ts`, `cep.ts`): testadas
  isoladamente (`apps/api/test/fretes-*.spec.ts`).
- **Serviços** aplicam permissão, filial e auditoria; o controller só valida a entrada (class-validator).
- Mesmo padrão do restante do CRM: NestJS 12 + Prisma 7 + PostgreSQL 18; React 19 + TanStack Query + shadcn/ui.

## 2. Tecnologias

As mesmas do CRM (ver `README.md`): sem dependência nova. Excel lido com `read-excel-file` (já usado nos leads),
CSV com o leitor do próprio sistema, gráficos com Recharts, consulta de CEP no ViaCEP (serviço público, com cache
de 90 dias e fallback pela faixa oficial de CEP de cada UF).

## 3. Modelo de dados

| Tabela | Para quê |
|---|---|
| `units` (+ `cnpj`, `legalName`, `zip`, `address`) | Filiais: origem das cotações (CEP de expedição) |
| `users.extraUnitIds` | Outras filiais que a pessoa acessa (gestor de mais de uma filial) |
| `freight_carriers` | Transportadoras: CNPJ, contatos, modalidades, filiais atendidas, códigos externos |
| `freight_tables` | Tabela negociada: transportadora, vigência, filiais, tipo de pessoa, faixas, modal, uso |
| `freight_table_versions` | Versões: componentes (fórmulas), parâmetros (ICMS, cubagem), situação |
| `freight_rules` | Regras da versão: destino (faixa de CEP, cidade ou UF) × faixa de peso × valores |
| `freight_imports` | Histórico de importação: arquivo original, mapeamento, linhas lidas/importadas/rejeitadas, relatório |
| `freight_quotes` | Cotação: entradas, todas as opções calculadas (com versão e componentes) e a escolha |
| `freight_ceps` | Cache de CEP → cidade/UF |

Regras invioláveis no modelo:

- **Versão publicada não muda.** Alterar = criar rascunho (cópia), conferir, publicar. A anterior fica
  `SUBSTITUIDA`, guardada para auditoria e reprodução.
- A cotação grava `versionId` e o cálculo completo de cada opção: **reproduzível** a qualquer tempo
  (botão *Reproduzir com as versões originais*).
- Valores da regra ficam em JSON por variável (`freight`, `gris`, `toll`…): cada transportadora pode ter colunas
  próprias sem mudar o banco.

## 4. Telas e navegação (menu Fretes)

| Tela | Rota | Conteúdo |
|---|---|---|
| Painel de fretes | `/fretes` | Cotações, escolhidas, frete escolhido, custo/kg, % da mercadoria, economia estimada, vigência das tabelas, rankings por transportadora, filial e UF |
| Cotação de frete | `/fretes/cotacao` | Origem/destino, vários volumes, PF/PJ, valor; comparativo com composição do preço; escolher (com motivo se não for a mais barata); exportar; comprovante |
| Histórico de cotações | `/fretes/cotacoes` | Busca por nº, pedido, cliente, cidade, CEP; detalhe com reprodução e impressão |
| Tabelas de frete | `/fretes/tabelas` | Lista com vigência; detalhe com abas **Regras**, **Histórico de Importação**, **Componentes**, **Versões**, **Dados da tabela** |
| Transportadoras | `/fretes/transportadoras` | Cadastro, contatos, filiais atendidas, tabelas vinculadas, indicadores |
| Filiais e integrações | `/fretes/filiais` | CNPJ e CEP de expedição de cada filial; situação real de cada integração |

Seletor de **filial ativa** no cabeçalho de cada tela; quem tem acesso a todas vê **Todas as filiais (visão global)**.

## 5. Fluxos

1. **Tabela nova:** cadastrar transportadora → cadastrar tabela (vigência, filiais) → *Importar Regras* → mapear
   colunas → validar → confirmar (rascunho) → conferir no simulador → **publicar** (a tabela passa a *Ativa*).
2. **Tabela atualizada pela transportadora:** importar a planilha nova na mesma tabela (vira rascunho da próxima
   versão) → simular → publicar. Se mudar a vigência, editar em *Dados da tabela* (fica na auditoria).
3. **Cotação:** filial + CEP destino + valor + peso/volumes → *Calcular fretes* → comparar → *Escolher*.
4. **Auditoria de cobrança (fase 4):** CT-e capturado → localizar cotação → comparar componente a componente.

## 6. Permissões

Cinco módulos em **Configurações → Perfis**: `fretes_painel`, `fretes_cotacao`, `fretes_tabelas`,
`fretes_transportadoras`, `fretes_filiais` (ver o texto de ajuda de cada um na tela). O escopo de cada módulo:

- **Todos:** todas as filiais (visão global).
- **Somente das filiais da pessoa:** a unidade do usuário + as *Outras unidades que acessa* (cadastro do usuário).

Tabela ou transportadora que vale para *todas as filiais* só é alterada por quem tem a visão global. Liberar
tabela vencida numa cotação exige *Editar* em Tabelas e justificativa (gravada na cotação e na auditoria).

Perfis sugeridos (criar em Configurações → Perfis):

| Perfil | Painel | Cotação | Tabelas | Transportadoras | Filiais | Escopo |
|---|---|---|---|---|---|---|
| Gestor de logística | Ver | Tudo | Tudo | Tudo | Editar | Todos |
| Operador de expedição | — | Ver/Criar/Editar | Ver | Ver | Ver | Filiais da pessoa |
| Compras | Ver | Ver/Criar | Ver/Criar/Editar | Ver/Criar/Editar | Ver | Todos |
| Financeiro | Ver/Exportar | Ver/Exportar | Ver | Ver | Ver | Todos |
| Auditor / Consulta | Ver | Ver | Ver | Ver | Ver | Todos ou filiais |

## 7. Importação de tabelas

- Aceita **.xlsx** e **.csv** (`;`, `,` ou tabulação; UTF-8, UTF-16 ou Windows-1252), até 20 MB e 100 mil linhas.
- Reconhece sozinho a linha do cabeçalho (mesmo com título acima) e sugere o mapeamento pelos títulos:
  CEP inicial/final, CEP de 5 dígitos, UF, cidade, peso inicial/final, prazo, restrição, frete, frete/kg,
  mínimo, excedente, ad valorem, GRIS (e mínimos), pedágio e fração, TAS, TDA, TRT, TDE, alíquota de ICMS etc.
- **Faixas de peso em colunas** ("Até 10 kg | Até 30 kg | …"): cada coluna vira uma regra por destino.
- Colunas desconhecidas podem virar **variável própria** (código livre), usável nas fórmulas.
- Validação por linha: CEP (inclusive o zero que o Excel tira), CEP inicial > final, UF, números no formato
  brasileiro, negativos, percentual > 100%, CEP de outra UF (alerta), **duplicidade** (mesmo destino e faixa),
  sobreposição de faixas de CEP (alerta). Linhas com erro ficam de fora e aparecem no relatório.
- Nunca substitui a versão publicada: gera rascunho. O arquivo original fica guardado para download.

## 8. Motor de cálculo

1. **Pesos:** real (soma dos volumes ou total informado, vale o maior), cubado = m³ × fator (kg/m³, por versão),
   taxado = maior dos dois (ou só o real, se a versão não usa cubagem). Medidas em cm e kg, com trava contra
   milímetros e gramas.
2. **Regra do destino:** faixa de CEP mais estreita > cidade (+UF) > UF. Faixa de peso que contém o peso taxado
   (no limite, vale a de baixo). Acima da última faixa: usa a última com **excedente**; sem valor de excedente,
   a opção sai *Fora da faixa* (não vira preço errado).
3. **Componentes** na ordem de aplicação, cada um com fórmula, condição de incidência opcional, "soma no imposto"
   e nome no CT-e. Cada componente vira a variável `$c_<código>$` para os seguintes (taxa sobre o frete).
4. **ICMS:** *somado por dentro* (base ÷ (1 − alíquota)), *destacado sem somar* ou *não incide*. Alíquota, nesta
   ordem: a da regra (`icms_aliq`), a fixada na versão (interestadual / mesmo estado) e, sem nenhuma, a da
   legislação: interestadual 7% ou 12% (Resolução do Senado 22/1989) e interna pela tabela por UF em Fretes →
   Filiais (SC 17%, conferida no CT-e 340.989). UF sem alíquota interna fica em aberto: avisa e não calcula.
   As alíquotas internas são cadastradas à mão ou lidas dos XMLs de CT-e (`src/fretes/cte.ts`): frete no mesmo
   estado com CST 00 (ou 20, alíquota efetiva) atualiza a UF; a captura automática de CT-e usará o mesmo passo.
5. **Prazo:** dias úteis da regra + expedição da tabela; data prevista sem sábados e domingos (feriados não).

**Fórmulas:** só números, `$variáveis$`, `+ - * / %`, comparações, `&& || !` e as funções `ceil floor round abs
min max if`. Interpretador próprio, sem `eval`: não executa código. Divisão por zero é erro (não vira zero calado).

Componentes padrão de uma tabela nova (ajustar ao contrato de cada transportadora):

| Componente | Fórmula |
|---|---|
| Frete peso | `max($freight$ + $freight_kg$ * $weight$ + $over_weight$ * max($weight$ - $weight_limit$, 0), $min_freight$)` |
| Frete valor | `$cargo_value$ * ($freight_value$ / 100)` |
| ADVALOREM | `max($cargo_value$ * ($advalorem$ / 100), $advalorem_min$)` |
| GRIS | `max($cargo_value$ * ($gris$ / 100), $gris_min$)` |
| PEDÁGIO | `if($fraction$ > 0, ceil($weight$ / $fraction$) * $toll$, $toll$)` |
| TAS, TDA, TRT, TDE, Despacho | `$tas$`, `$tda$`… |
| T-CPF | `$t_cpf$` com condição `$is_pf$` |
| REENTREGA | `$total_value$ * ($redelivery$ / 100)` (desligado na cotação; serve para conferir CT-e) |

### Taxas por destinatário, SVD e ICMS por estado (v0.99.2)

- **Listas da transportadora** (TDA, TDE, TDC, TVD por CPF/CNPJ, como as da Expresso São Miguel): importadas na
  ficha da transportadora (`freight_recipient_fees`, sem o nome da pessoa). Na cotação, com o documento do
  destinatário informado, viram componentes depois dos da tabela: valor fixo ou o maior entre o fixo e o % do frete
  (TDE "222/20%"), dentro da base do ICMS. A cotação guarda as taxas aplicadas para ser reproduzida igual.
- **SVD (sem valor declarado):** envio sem nota fiscal, com declaração de conteúdo. A variável `$no_invoice$` e o
  preço `$svd$` da regra; o Frete peso padrão usa o SVD quando os dois existem.
- **ICMS:** alíquota padrão (interestadual) e alíquota para origem e destino no mesmo estado. Conferido com o CT-e
  1.591.853 da São Miguel (12% por dentro: R$ 69,62 → R$ 79,11, ICMS R$ 9,49) em `test/fretes-taxas.spec.ts`.

## 9. Integração fiscal e certificados (fase 3)

- **CT-e:** Distribuição DF-e da SEFAZ (NSU por CNPJ interessado, com certificado A1 de cada CNPJ). O sistema só
  baixa documentos em que o CNPJ da Usaparts é parte (tomador/destinatário/remetente), respeitando o limite de
  consultas. XML importado não é tratado como válido só por existir: confere assinatura, protocolo e situação.
- **Certificado A1:** upload por quem tem permissão, senha criptografada (AES-256-GCM, como os demais segredos do
  CRM), validade e CNPJ lidos do certificado, aviso de vencimento, nada em log. A3 não roda em segundo plano:
  exigiria um agente local, a avaliar se for o caso.

## 10. Integrações pedidas

| Integração | Plano | Depende de |
|---|---|---|
| Correios | Preço e prazo pela API do Correios (CWS) como mais uma opção na cotação; até lá, a tabela dos Correios pode ser importada como tabela comum | Contrato, cartão de postagem e credenciais da API |
| Mercado Livre — ME1 | No Mercado Envios 1 o vendedor informa o frete: gerar a tabela de frete da loja a partir das tabelas marcadas para "Mercado Livre" e responder às perguntas de frete (o CRM já tem a conexão com o ML) | Definir com o comercial quais tabelas/regras valem e validar o formato aceito pela conta |
| Google Shopping | Frete dos produtos no Merchant Center a partir das tabelas marcadas para "Google Shopping" | Conta do Merchant Center com acesso de API |
| Tcar (ERP) | Pedidos e NF expedidas para vincular cotação → pedido → CT-e | Liberar consulta de pedidos/notas na Tcar |

Na tela **Filiais e integrações** todas aparecem como *Não conectada* até estarem de fato ligadas.

## 11. Cronograma

| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Permissões por filial, filiais, transportadoras, tabelas, importação, componentes e variáveis | **Entregue (v0.99.0)** |
| 2 | Fórmulas, regras geográficas, cubagem, cotação, comparativo, histórico e reprodução | **Entregue (v0.99.0)**; cotação em lote por planilha fica para a próxima versão |
| 3 | Pedidos e expedição (manual, planilha, Tcar), captura de CT-e (DF-e), certificado A1 | A fazer |
| 4 | Faturas, conciliação automática por componente, tolerâncias, contestação, pagamentos | A fazer |
| 5 | Relatórios gerenciais, alertas (vencimento, divergências), indicadores de desempenho | Parcial (painel e alertas de vigência) |
| 6 | Correios, Mercado Livre ME1, Google Shopping, APIs de transportadoras, homologação | A fazer |

## 12. Riscos e dependências

- **Formato das tabelas:** cada transportadora manda um layout; o mapeamento cobre a maioria, mas fórmulas
  especiais (ex.: TDE só acima de certo valor) precisam ser configuradas por tabela e conferidas no simulador.
- **ICMS:** alíquota depende de origem, destino e regime da transportadora; o sistema usa o que a tabela informa.
- **Feriados:** o prazo conta só dias úteis de segunda a sexta.
- **CT-e:** depende de certificado A1 por CNPJ e das regras de consulta da SEFAZ.
- **Integrações externas:** dependem de contrato e credenciais (Correios, Merchant Center, ML).

## 13. Como validar com uma tabela real

1. Fretes → Filiais: **Cadastrar as unidades da Usaparts** (ou conferir CEP de expedição de cada filial).
2. Fretes → Transportadoras: cadastrar a transportadora.
3. Fretes → Tabelas → Nova tabela → salvar → *Importar Regras* com a planilha recebida.
4. Conferir a aba **Componentes**: ajustar fórmulas ao contrato e simular 3 ou 4 destinos conhecidos,
   comparando com a cotação da própria transportadora.
5. Publicar em **Versões** e fazer cotações reais.
