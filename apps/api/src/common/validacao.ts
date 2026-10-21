/**
 * Mensagens de validação em português. O class-validator responde em inglês ("name must be longer than or equal
 * to 2 characters"); aqui cada regra vira uma frase que diz o campo e o que corrigir. Mensagens já escritas em
 * português nos DTOs (message: '...') passam como estão.
 */
import { BadRequestException } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

/** Nomes dos campos como aparecem na tela (o que não está aqui sai como "o campo “x”"). */
const FIELD: Record<string, string> = {
  name: 'nome', nome: 'nome', title: 'título', titulo: 'título', email: 'e-mail', phone: 'telefone', telefone: 'telefone', password: 'senha', newPassword: 'nova senha',
  currentPassword: 'senha atual', text: 'texto', texto: 'texto', description: 'descrição', descricao: 'descrição', note: 'observação', notes: 'observações', city: 'cidade', cidade: 'cidade',
  state: 'estado', estado: 'estado', country: 'país', company: 'empresa', jobTitle: 'cargo', subject: 'assunto', preheader: 'pré-cabeçalho', fromName: 'nome do remetente',
  replyTo: 'responder para', color: 'cor', url: 'endereço (URL)', link: 'link', tags: 'etiquetas', tag: 'etiqueta', status: 'situação', stage: 'etapa', unitId: 'filial',
  ownerId: 'responsável', sellerId: 'vendedor', sellerIds: 'vendedores', userId: 'usuário', userIds: 'usuários', roleId: 'perfil de acesso', originId: 'origem', customerTypeId: 'tipo de cliente',
  brandIds: 'marcas', partTypeIds: 'tipos de peça', lostReasonId: 'motivo da perda', saleValue: 'valor da venda', value: 'valor', amount: 'valor', date: 'data', from: 'data inicial',
  to: 'data final', de: 'data inicial', ate: 'data final', month: 'mês', label: 'nome', key: 'chave', token: 'token', code: 'código', username: 'usuário', message: 'mensagem',
  caption: 'legenda', legenda: 'legenda', file: 'arquivo', category: 'categoria', kind: 'tipo', tipo: 'tipo', type: 'tipo', search: 'busca', busca: 'busca', q: 'busca', list: 'lista',
  emails: 'e-mails', time: 'horário', hour: 'hora', minute: 'minuto', weekday: 'dia da semana', threshold: 'limite', windowDays: 'período (dias)', budget: 'orçamento', goals: 'metas',
}
const field = (p: string) => (FIELD[p] ? `o campo ${FIELD[p]}` : `o campo “${p}”`)
const num = (m: string) => /(\d+(?:\.\d+)?)/.exec(m)?.[1] ?? ''

/** Mensagem padrão (inglês) do class-validator? As escritas à mão nos DTOs ficam como estão. */
const DEFAULT_EN = /\b(must|should|has failed|is not allowed|each value in|property \S+ should not exist)\b/i

function rule(constraint: string, prop: string, raw: string) {
  const f = field(prop)
  switch (constraint) {
    case 'isNotEmpty':
    case 'isDefined':
      return `Preencha ${f}.`
    case 'isString':
      return `${cap(f)} precisa ser um texto.`
    case 'minLength':
      return `${cap(f)} precisa ter pelo menos ${num(raw)} caracteres.`
    case 'maxLength':
      return `${cap(f)} pode ter no máximo ${num(raw)} caracteres.`
    case 'isLength':
      return /shorter/i.test(raw) ? `${cap(f)} pode ter no máximo ${num(raw)} caracteres.` : `${cap(f)} precisa ter pelo menos ${num(raw)} caracteres.`
    case 'isEmail':
      return `${cap(f)} não é um e-mail válido.`
    case 'isInt':
      return `${cap(f)} precisa ser um número inteiro.`
    case 'isNumber':
    case 'isNumberString':
    case 'isDecimal':
      return `${cap(f)} precisa ser um número.`
    case 'min':
      return `${cap(f)} precisa ser no mínimo ${num(raw)}.`
    case 'max':
      return `${cap(f)} pode ser no máximo ${num(raw)}.`
    case 'isPositive':
      return `${cap(f)} precisa ser maior que zero.`
    case 'isBoolean':
      return `${cap(f)} precisa ser sim ou não.`
    case 'isIn':
    case 'isEnum':
      return `${cap(f)} tem um valor que não está entre as opções.`
    case 'isUUID':
    case 'isMongoId':
      return `${cap(f)} não foi encontrado. Escolha de novo na lista.`
    case 'matches':
      return `${cap(f)} está em um formato inválido.`
    case 'isArray':
      return `${cap(f)} precisa ser uma lista.`
    case 'arrayMaxSize':
      return `${cap(f)} aceita no máximo ${num(raw)} itens.`
    case 'arrayMinSize':
      return `${cap(f)} precisa de pelo menos ${num(raw)} item(ns).`
    case 'arrayNotEmpty':
      return `Escolha pelo menos um item em ${f}.`
    case 'isDateString':
    case 'isDate':
    case 'isISO8601':
      return `${cap(f)} não é uma data válida.`
    case 'isUrl':
      return `${cap(f)} não é um endereço válido (comece com https://).`
    case 'isObject':
      return `${cap(f)} está em um formato inválido.`
    case 'whitelistValidation':
      return `O campo “${prop}” não é aceito aqui. Atualize a página (Ctrl+F5) e tente de novo.`
    default:
      return `${cap(f)} está inválido.`
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Primeira mensagem de cada campo (com os campos de dentro de listas e objetos). */
export function validationMessages(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const e of errors) {
    const prop = /^\d+$/.test(e.property) ? parent || e.property : e.property
    for (const [constraint, raw] of Object.entries(e.constraints ?? {})) out.push(DEFAULT_EN.test(raw) ? rule(constraint, prop, raw) : raw)
    if (e.children?.length) out.push(...validationMessages(e.children, prop))
  }
  return out
}

export const validationExceptionFactory = (errors: ValidationError[]) => {
  const messages = validationMessages(errors)
  return new BadRequestException(messages.length ? messages : ['Confira os dados informados.'])
}
