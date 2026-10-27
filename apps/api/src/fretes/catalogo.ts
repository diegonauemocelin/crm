// Variáveis, componentes padrão e listas fixas do módulo de fretes. Sem banco e sem rede.

export interface VariableDef {
  code: string
  label: string
  /** ENTRADA: vem da cotação (peso, valor, volumes). REGRA: valor da tabela da transportadora para o destino. */
  source: 'ENTRADA' | 'REGRA'
  unit: 'R$' | '%' | 'kg' | 'm³' | 'dias' | 'un' | 'R$/kg' | 'kg/fração' | '0/1'
  help?: string
}

/** Calculadas na hora a partir dos dados da cotação. Não vêm da tabela. */
export const INPUT_VARIABLES: VariableDef[] = [
  { code: 'cargo_value', label: 'Valor da mercadoria', source: 'ENTRADA', unit: 'R$' },
  { code: 'total_value', label: 'Valor total da NF', source: 'ENTRADA', unit: 'R$', help: 'Igual ao valor da mercadoria quando a NF não é informada à parte.' },
  { code: 'weight', label: 'Peso taxado', source: 'ENTRADA', unit: 'kg', help: 'Maior entre o peso real e o cubado (salvo se a tabela não usar cubagem).' },
  { code: 'real_weight', label: 'Peso real', source: 'ENTRADA', unit: 'kg' },
  { code: 'cubed_weight', label: 'Peso cubado', source: 'ENTRADA', unit: 'kg' },
  { code: 'cubage', label: 'Cubagem (volume)', source: 'ENTRADA', unit: 'm³' },
  { code: 'volumes', label: 'Quantidade de volumes', source: 'ENTRADA', unit: 'un' },
  { code: 'is_pf', label: 'Destinatário pessoa física', source: 'ENTRADA', unit: '0/1' },
  { code: 'is_pj', label: 'Destinatário pessoa jurídica', source: 'ENTRADA', unit: '0/1' },
  { code: 'weight_limit', label: 'Peso-limite da faixa', source: 'ENTRADA', unit: 'kg', help: 'Peso final da faixa usada (ou o inicial, na última faixa "acima de"). Base do excedente.' },
  { code: 'weight_start', label: 'Peso inicial da faixa', source: 'ENTRADA', unit: 'kg' },
  { code: 'deadline', label: 'Prazo da regra', source: 'ENTRADA', unit: 'dias' },
  { code: 'subtotal', label: 'Soma dos componentes anteriores', source: 'ENTRADA', unit: 'R$', help: 'Para taxas sobre o frete: some só o que vem antes na ordem de aplicação.' },
]

/** Valores que a transportadora informa por destino e faixa (colunas da tabela). Códigos iguais aos da tela de referência. */
export const RULE_VARIABLES: VariableDef[] = [
  { code: 'freight', label: 'Frete (valor da faixa)', source: 'REGRA', unit: 'R$' },
  { code: 'freight_kg', label: 'Frete por kg', source: 'REGRA', unit: 'R$/kg' },
  { code: 'base_freight', label: 'Frete base', source: 'REGRA', unit: 'R$' },
  { code: 'min_freight', label: 'Frete mínimo', source: 'REGRA', unit: 'R$' },
  { code: 'over_weight', label: 'Excedente de peso (por kg)', source: 'REGRA', unit: 'R$/kg' },
  { code: 'freight_value', label: 'Frete valor (% da NF)', source: 'REGRA', unit: '%' },
  { code: 'advalorem', label: 'Ad valorem', source: 'REGRA', unit: '%' },
  { code: 'advalorem_min', label: 'Ad valorem mínimo', source: 'REGRA', unit: 'R$' },
  { code: 'gris', label: 'GRIS', source: 'REGRA', unit: '%' },
  { code: 'gris_min', label: 'GRIS mínimo', source: 'REGRA', unit: 'R$' },
  { code: 'toll', label: 'Pedágio', source: 'REGRA', unit: 'R$' },
  { code: 'fraction', label: 'Fração do pedágio', source: 'REGRA', unit: 'kg/fração', help: 'Vazio ou 0 = pedágio fixo por envio.' },
  { code: 'tas', label: 'TAS', source: 'REGRA', unit: 'R$' },
  { code: 't_cpf', label: 'T-CPF (entrega a pessoa física)', source: 'REGRA', unit: 'R$' },
  { code: 'tda', label: 'TDA (difícil acesso)', source: 'REGRA', unit: 'R$' },
  { code: 'trt', label: 'TRT (restrição de trânsito)', source: 'REGRA', unit: 'R$' },
  { code: 'tde', label: 'TDE (dificuldade de entrega)', source: 'REGRA', unit: 'R$' },
  { code: 'tdc', label: 'TDC', source: 'REGRA', unit: 'R$' },
  { code: 'tec', label: 'TEC', source: 'REGRA', unit: 'R$' },
  { code: 'tce', label: 'TCE', source: 'REGRA', unit: 'R$' },
  { code: 'tcd', label: 'TCD', source: 'REGRA', unit: 'R$' },
  { code: 'tac', label: 'TAC', source: 'REGRA', unit: 'R$' },
  { code: 'tag', label: 'TAG', source: 'REGRA', unit: 'R$' },
  { code: 'tar', label: 'TAR', source: 'REGRA', unit: 'R$' },
  { code: 'tsb', label: 'TSB', source: 'REGRA', unit: 'R$' },
  { code: 'itr', label: 'ITR', source: 'REGRA', unit: 'R$' },
  { code: 'emex', label: 'EMEX', source: 'REGRA', unit: 'R$' },
  { code: 'ebs', label: 'EBS', source: 'REGRA', unit: 'R$' },
  { code: 'seccat', label: 'SECCAT', source: 'REGRA', unit: 'R$' },
  { code: 'suframa', label: 'Suframa', source: 'REGRA', unit: 'R$' },
  { code: 'capatazia', label: 'Capatazia', source: 'REGRA', unit: 'R$' },
  { code: 'delivery_fee', label: 'Taxa de entrega', source: 'REGRA', unit: 'R$' },
  { code: 'fees', label: 'Taxas administrativas', source: 'REGRA', unit: 'R$' },
  { code: 'dispatch', label: 'Despacho', source: 'REGRA', unit: 'R$' },
  { code: 'fluvial_dispatch', label: 'Despacho fluvial', source: 'REGRA', unit: 'R$' },
  { code: 'redispatch', label: 'Redespacho', source: 'REGRA', unit: 'R$' },
  { code: 'fluvial_redispatch', label: 'Redespacho fluvial', source: 'REGRA', unit: 'R$' },
  { code: 'redelivery', label: 'Reentrega', source: 'REGRA', unit: '%' },
  { code: 'devolution', label: 'Devolução', source: 'REGRA', unit: '%' },
  { code: 'insurance', label: 'Seguro', source: 'REGRA', unit: '%' },
  { code: 'fluvial_insurance', label: 'Seguro fluvial', source: 'REGRA', unit: '%' },
  { code: 'collection', label: 'Coleta', source: 'REGRA', unit: 'R$' },
  { code: 'extra_freight', label: 'Extra frete', source: 'REGRA', unit: 'R$' },
  { code: 'extra_others', label: 'Extra outros', source: 'REGRA', unit: 'R$' },
  { code: 'others', label: 'Outros', source: 'REGRA', unit: 'R$' },
  { code: 'inv_above', label: 'Valor NF acima de', source: 'REGRA', unit: 'R$' },
  { code: 'icms_aliq', label: 'Alíquota de ICMS', source: 'REGRA', unit: '%', help: 'Quando vazia, vale a alíquota padrão dos parâmetros da versão.' },
]

export const ALL_VARIABLES = [...INPUT_VARIABLES, ...RULE_VARIABLES]
export const INPUT_CODES = new Set(INPUT_VARIABLES.map((v) => v.code))
export const RULE_CODES = new Set(RULE_VARIABLES.map((v) => v.code))

/** Código de componente: maiúsculas, números, _ e -. Vira a variável c_<código> para os componentes seguintes. */
export const COMPONENT_CODE = /^[A-Z][A-Z0-9_-]{0,29}$/
export const componentVar = (code: string) => `c_${code.toLowerCase().replace(/-/g, '_')}`

export interface ComponentDef {
  code: string
  name: string
  formula: string
  /** Condição de incidência (fórmula): 0 = não cobra. Vazia = sempre. */
  condition?: string | null
  /** Entra na base do ICMS ("Soma no imposto"). */
  inTax: boolean
  /** Nome do componente no CT-e, para a conciliação. Vazio = o próprio nome. */
  cteName?: string | null
  order: number
  active: boolean
  description?: string | null
}

/** Ponto de partida de toda tabela nova. As fórmulas definitivas seguem o contrato de cada transportadora. */
export const DEFAULT_COMPONENTS: ComponentDef[] = [
  {
    code: 'FRETE_PESO',
    name: 'Frete peso',
    formula: 'max($freight$ + $freight_kg$ * $weight$ + $over_weight$ * max($weight$ - $weight_limit$, 0), $min_freight$)',
    inTax: true,
    order: 10,
    active: true,
    description: 'Valor da faixa + R$/kg + excedente acima da faixa, respeitando o frete mínimo.',
  },
  { code: 'FRETE_VALOR', name: 'Frete valor', formula: '$cargo_value$ * ($freight_value$ / 100)', inTax: true, order: 20, active: true },
  { code: 'ADVALOREM', name: 'ADVALOREM', formula: 'max($cargo_value$ * ($advalorem$ / 100), $advalorem_min$)', inTax: true, order: 30, active: true },
  { code: 'GRIS', name: 'GRIS', formula: 'max($cargo_value$ * ($gris$ / 100), $gris_min$)', inTax: true, order: 40, active: true },
  {
    code: 'PEDAGIO',
    name: 'PEDÁGIO',
    formula: 'if($fraction$ > 0, ceil($weight$ / $fraction$) * $toll$, $toll$)',
    inTax: true,
    order: 50,
    active: true,
    description: 'Com fração: arredonda o peso taxado para cima em frações. Sem fração: valor fixo por envio.',
  },
  { code: 'TAS', name: 'TAS', formula: '$tas$', inTax: true, order: 60, active: true },
  { code: 'T-CPF', name: 'T-CPF', formula: '$t_cpf$', condition: '$is_pf$', inTax: true, order: 70, active: true, description: 'Só para destinatário pessoa física.' },
  { code: 'TDA', name: 'TDA', formula: '$tda$', inTax: true, order: 80, active: true },
  { code: 'TRT', name: 'TRT', formula: '$trt$', inTax: true, order: 90, active: true },
  { code: 'TDE', name: 'TDE', formula: '$tde$', inTax: true, order: 100, active: true },
  { code: 'DESPACHO', name: 'Despacho', formula: '$dispatch$', inTax: true, order: 110, active: true },
  {
    code: 'REENTREGA',
    name: 'REENTREGA',
    formula: '$total_value$ * ($redelivery$ / 100)',
    inTax: true,
    order: 900,
    active: false,
    description: 'Só acontece quando a entrega falha: fica desligado na cotação e serve para conferir o CT-e.',
  },
]

export const ICMS_MODES = ['SOMADO', 'NAO_INCIDE', 'INFORMATIVO'] as const
export type IcmsMode = (typeof ICMS_MODES)[number]
export const ICMS_LABEL: Record<IcmsMode, string> = {
  SOMADO: 'Somado nos componentes (por dentro)',
  NAO_INCIDE: 'Não incide',
  INFORMATIVO: 'Destacado, sem somar no total',
}

export interface CalcSettings {
  icmsMode: IcmsMode
  /** Alíquota padrão (%) quando a regra não traz icms_aliq. */
  icmsRate: number | null
  /** kg por m³ (ex.: 300 no rodoviário). */
  cubageFactor: number
  /** false = cobra só pelo peso real. */
  useCubage: boolean
  /** Isenção de cubagem: envio com até este volume (m³) paga pelo peso real (ex.: 0,30 na São Miguel). */
  cubageExemptM3?: number | null
}

export const DEFAULT_SETTINGS: CalcSettings = { icmsMode: 'SOMADO', icmsRate: null, cubageFactor: 300, useCubage: true, cubageExemptM3: null }

export const TABLE_KINDS = ['COMPRA_VENDA', 'COMPRA', 'VENDA'] as const
export const TABLE_STATUS = ['ATIVA', 'INATIVA', 'RASCUNHO'] as const
export const MODALS = ['RODOVIARIO', 'AEREO', 'AQUAVIARIO', 'FERROVIARIO', 'MULTIMODAL', 'CORREIOS'] as const
export const MODAL_LABEL: Record<(typeof MODALS)[number], string> = {
  RODOVIARIO: '01 - Rodoviário',
  AEREO: '02 - Aéreo',
  AQUAVIARIO: '03 - Aquaviário',
  FERROVIARIO: '04 - Ferroviário',
  MULTIMODAL: '06 - Multimodal',
  CORREIOS: 'Correios',
}
export const PERSON_TYPES = ['AMBOS', 'PF', 'PJ'] as const
export const USAGES = ['COTACAO_CONCILIACAO', 'COTACAO', 'CONCILIACAO'] as const
export const LOAD_TYPES = ['FRACIONADA', 'LOTACAO', 'DEDICADA'] as const
export const GOODS_TYPES = ['Geral', 'Peças e componentes', 'Filtros', 'Material rodante', 'Volumosa', 'Perigosa', 'Frágil'] as const
