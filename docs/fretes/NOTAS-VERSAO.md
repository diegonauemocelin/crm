# Notas de fretes para a v1.0.4

O módulo de fretes (PR diegonauemocelin/crm#1) entra na **v1.0.4** (terça, 03/11/2026), junto com o que ficar pronto
até lá. Ao montar a versão, junte estes itens na entrada da v1.0.4 do `releases.json` (com a data do dia) e apague este
arquivo.

```json
[
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Novo módulo Fretes, separado no menu e com permissões próprias (painel, cotações, tabelas, transportadoras e filiais). Cada pessoa vê as suas filiais; quem tem acesso a todas escolhe \"Todas as filiais (visão global)\" no seletor de filial do cabeçalho."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Transportadoras: CNPJ, razão social, nome na cotação, contatos, modalidades, filiais atendidas, códigos nos sistemas externos e \"usar recebedor como destinatário\", com as tabelas vinculadas e quantas vezes cada uma foi cotada e escolhida."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Tabelas de frete com vigência, filiais, tipo de pessoa, faixas de peso e valor, modal, tabela de carga, expedição e código de serviço. Os valores ficam em versões: a publicada calcula, alterar cria um rascunho, e as versões anteriores ficam guardadas para auditoria."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Importação da planilha da transportadora (Excel ou CSV): o sistema acha o cabeçalho, sugere o que é cada coluna (inclusive faixas de peso em colunas, como \"Até 10 kg | Até 30 kg\"), valida CEPs, números, percentuais e duplicidades linha a linha e mostra o relatório antes de gravar. A planilha vira rascunho; o original fica para baixar no Histórico de Importação."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Componentes do frete com fórmulas (ad valorem, GRIS, pedágio por fração, TAS, T-CPF, TDA, TRT, TDE, despacho, reentrega e outros), condição de incidência, ordem de aplicação, \"soma no imposto\" e nome no CT-e, com variáveis clicáveis, validação da fórmula e simulador. O editor aceita só variáveis, operadores e funções autorizadas."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Cotação de frete: filial de origem, CEP de destino (cidade e UF pelo CEP), PF/PJ, valor da NF e vários volumes com medidas. Calcula peso cubado e taxado, a regra do destino, cada componente e o ICMS, e compara as transportadoras por preço ou prazo, com o motivo de quem não atende (sem cobertura, restrição, tabela vencida, fora da faixa)."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Toda cotação fica salva com a versão de tabela usada e pode ser reproduzida depois com os mesmos valores. Escolher uma transportadora que não é a mais barata pede o motivo; tabela vencida só entra com liberação justificada, registrada na auditoria."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Painel de fretes com cotações, frete escolhido, custo por kg, frete sobre o valor da mercadoria, economia estimada, tabelas vencidas ou vencendo, e rankings por transportadora, filial e UF, só com números calculados dos registros."
  },
  {
    "type": "melhoria",
    "area": "Usuários",
    "text": "Cadastro do usuário com \"Outras unidades que acessa\": gestores de mais de uma filial enxergam todas elas no módulo de fretes."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "Importação escolhe sozinha a aba com a tabela (planilhas com abas de contrato, generalidades e taxas, como as da Expresso São Miguel) e reconhece TAXA, QUILO, % NF, GRIS e GRIS %, pedágio por fração e prazo mínimo/máximo."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "Coluna com texto (ex.: ICMS \"CONFORME LEGISLAÇÃO\", \"De 2 a 6 dias\") não é mais sugerida como valor, evitando erro em todas as linhas."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Isenção de cubagem por volume na versão da tabela (ex.: São Miguel cobra pelo peso real até 0,30 m³)."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "A observação da transportadora para o destino (taxa por volume, dias de entrega) aparece como aviso na cotação."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Taxas por destinatário: na ficha da transportadora, importe as listas de TDA, TDE, TDC e TVD (como as abas da Expresso São Miguel). Na cotação, a taxa entra sozinha quando o CPF/CNPJ do destinatário está na lista (ex.: TDE de R$ 222,00 ou 20% do frete, o maior). Só o documento, a cidade e a taxa são guardados, sem o nome."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Cotação de envio sem nota fiscal (SVD, com declaração de conteúdo): usa o preço SVD da tabela quando a transportadora tem."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Alíquota de ICMS própria para entregas no mesmo estado da filial de origem, além da interestadual."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "A vigência da tabela é informada no assistente de importação, a cada planilha nova (fica na auditoria)."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "Importação reconhece a coluna \"Pequenos volumes S.V.D.\" (sem valor declarado)."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "ICMS do frete automático: entre estados, 7% ou 12% pela Resolução do Senado 22/1989; dentro do mesmo estado, a alíquota interna da tabela de ICMS em Fretes → Filiais (SC 17% já cadastrada, conferida em CT-e). UF sem alíquota fica em aberto e a cotação avisa, sem calcular imposto inventado."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "A tabela de frete ainda pode fixar a alíquota (aba Componentes) ou trazer a coluna de alíquota por destino, que valem mais que a regra automática. A cotação antiga é reproduzida com a alíquota da época."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Em Fretes → Filiais → ICMS do frete, \"Atualizar pelos CT-e (XML)\": envie os XMLs e cada frete dentro de um mesmo estado com ICMS tributado atualiza a alíquota interna daquela UF (vale o CT-e mais recente; redução de base vira a alíquota efetiva). Cada alíquota mostra se veio do cadastro manual ou de qual CT-e, e a mudança fica na auditoria."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Pedidos e expedição: pedido gerado pela cotação (guarda o valor escolhido), cadastrado à mão ou importado de planilha do ERP; situação do envio com histórico (coleta, despachado, em trânsito, ocorrência, entregue), previsão de entrega e filtro de atrasados."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "CT-e: importação dos XMLs (um a um ou em .zip, com eventos de cancelamento). O sistema acha a transportadora pelo CNPJ, a filial pelo CNPJ de quem enviou ou pagou e o pedido pela chave da NF-e; repetidos são pulados pela chave e o XML fica guardado."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Conciliação automática: o cobrado é comparado, componente por componente e no ICMS, com a cotação do pedido ou, sem ela, com a tabela publicada na data do CT-e. Dentro da tolerância o CT-e é aprovado sozinho; fora dela vai para a fila de Conciliação (divergência de valor ou peso, taxa não prevista ou duplicada), onde se aprova o cobrado, aprova o esperado contestando a diferença ou contesta tudo, e depois registra o crédito obtido."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Faturas de frete: lançar a fatura da transportadora marcando os CT-es (colando os números), ver o cobrado, o aprovado, o contestado em aberto e o que ficou sem CT-e; aprovar para pagamento (só com todos os CT-es decididos), registrar o pagamento ou cancelar."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Relatórios de frete (transportadoras, filiais, UF, mês, divergências, contestações, faturas e tabelas) com exportação em CSV, e central de alertas: tabelas vencendo, pedidos sem cotação ou sem CT-e, entregas atrasadas, CT-es divergentes, contestações paradas e faturas vencendo. O painel ganhou os números de CT-e, conciliação, entregas no prazo e faturas."
  },
  {
    "type": "novo",
    "area": "Fretes",
    "text": "Cotação em lote: planilha com vários destinos (CEP, peso e valor) devolve a melhor e a segunda opção de cada linha, com CSV. Não grava no histórico."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "Prazo de entrega em dias úteis agora pula os feriados nacionais (inclusive Sexta-feira Santa). Feriados estaduais e municipais ainda não entram."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "Importação de tabela: arquivo novo da transportadora com o mesmo layout de uma importação anterior já vem com o mapeamento de colunas conferido daquela vez."
  },
  {
    "type": "melhoria",
    "area": "Fretes",
    "text": "Perfis prontos (Gestor de logística, Operador de expedição, Financeiro de fretes), criados pelo Administrador em Fretes → Filiais; tolerâncias da conciliação (geral e por transportadora) e prazos dos alertas no mesmo lugar."
  }
]
```
