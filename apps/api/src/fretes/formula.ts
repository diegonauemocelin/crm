// Fórmulas dos componentes de frete (ex.: "$cargo_value$ * ($advalorem$ / 100)"). Interpretador próprio, sem eval:
// só números, variáveis entre cifrões, operadores e as funções da lista abaixo. Sem banco e sem rede (test/fretes-formula.spec.ts).

export const FORMULA_MAX = 500
const MAX_DEPTH = 40

/** Funções autorizadas e quantos argumentos aceitam. "se" é avaliada sem calcular o lado que não vale. */
export const FUNCTIONS: Record<string, { min: number; max: number; help: string }> = {
  ceil: { min: 1, max: 1, help: 'arredonda para cima: ceil($weight$ / $fraction$)' },
  floor: { min: 1, max: 1, help: 'arredonda para baixo' },
  round: { min: 1, max: 2, help: 'arredonda (casas opcionais): round($x$, 2)' },
  abs: { min: 1, max: 1, help: 'valor sem sinal' },
  min: { min: 1, max: 20, help: 'menor valor: min($a$, $b$)' },
  max: { min: 1, max: 20, help: 'maior valor: max($calculado$, $minimo$)' },
  if: { min: 3, max: 3, help: 'condição: if($weight$ > 100, $a$, $b$)' },
}

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | '!'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] }

type Token = { k: 'num'; v: number; p: number } | { k: 'var'; v: string; p: number } | { k: 'id'; v: string; p: number } | { k: 'op'; v: string; p: number }

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(message)
  }
}

const OPS = ['>=', '<=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '(', ')', ',', '>', '<', '!']

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i))
      if (!m) throw new FormulaError(`Número inválido na posição ${i + 1}.`, i)
      out.push({ k: 'num', v: Number(m[0]), p: i })
      i += m[0].length
      continue
    }
    if (c === '$') {
      const end = src.indexOf('$', i + 1)
      if (end < 0) throw new FormulaError(`Variável sem o cifrão de fechamento na posição ${i + 1} (use $nome$).`, i)
      const name = src.slice(i + 1, end).trim()
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw new FormulaError(`Nome de variável inválido: $${name}$ (letras minúsculas, números e _).`, i)
      out.push({ k: 'var', v: name, p: i })
      i = end + 1
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!
      out.push({ k: 'id', v: m[0].toLowerCase(), p: i })
      i += m[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new FormulaError(`Caractere não permitido: "${c}" na posição ${i + 1}.`, i)
    out.push({ k: 'op', v: op, p: i })
    i += op.length
  }
  return out
}

// Precedência (menor primeiro): || && (== !=) (> < >= <=) (+ -) (* / %) unário
const LEVELS = [['||'], ['&&'], ['==', '!='], ['>', '<', '>=', '<='], ['+', '-'], ['*', '/', '%']]

class Parser {
  private i = 0
  constructor(
    private readonly tk: Token[],
    private readonly srcLen: number,
  ) {}

  parse(): Node {
    if (!this.tk.length) throw new FormulaError('A fórmula está vazia.')
    const n = this.level(0, 0)
    const rest = this.tk[this.i]
    if (rest) throw new FormulaError(`Sobrou "${rest.v}" na posição ${rest.p + 1}: falta um operador ou sobra um parêntese.`, rest.p)
    return n
  }

  private peek() {
    return this.tk[this.i]
  }

  private level(l: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw new FormulaError('Fórmula com parênteses demais.')
    if (l >= LEVELS.length) return this.unary(depth)
    let a = this.level(l + 1, depth)
    for (;;) {
      const t = this.peek()
      if (!t || t.k !== 'op' || !LEVELS[l]!.includes(t.v)) return a
      this.i++
      const b = this.level(l + 1, depth)
      a = { t: 'bin', op: t.v, a, b }
    }
  }

  private unary(depth: number): Node {
    const t = this.peek()
    if (t?.k === 'op' && (t.v === '-' || t.v === '!' || t.v === '+')) {
      this.i++
      const a = this.unary(depth + 1)
      return t.v === '+' ? a : { t: 'un', op: t.v, a }
    }
    return this.primary(depth)
  }

  private primary(depth: number): Node {
    const t = this.peek()
    if (!t) throw new FormulaError('A fórmula termina no meio: falta um valor depois do último operador.', this.srcLen)
    this.i++
    if (t.k === 'num') return { t: 'num', v: t.v }
    if (t.k === 'var') return { t: 'var', name: t.v }
    if (t.k === 'op' && t.v === '(') {
      const n = this.level(0, depth + 1)
      this.expect(')', 'Falta fechar um parêntese.')
      return n
    }
    if (t.k === 'id') {
      const fn = t.v === 'se' ? 'if' : t.v
      const def = FUNCTIONS[fn]
      if (!def) throw new FormulaError(`Função não permitida: ${t.v}. Use ${Object.keys(FUNCTIONS).join(', ')}. Variáveis vão entre cifrões ($nome$).`, t.p)
      this.expect('(', `Depois de ${t.v} abra parênteses: ${t.v}(...).`)
      const args: Node[] = []
      if (this.peek()?.v !== ')') {
        for (;;) {
          args.push(this.level(0, depth + 1))
          if (this.peek()?.v === ',') {
            this.i++
            continue
          }
          break
        }
      }
      this.expect(')', `Falta fechar o parêntese de ${t.v}(...).`)
      if (args.length < def.min || args.length > def.max) {
        throw new FormulaError(`${t.v} aceita ${def.min === def.max ? def.min : `de ${def.min} a ${def.max}`} valor(es); recebeu ${args.length}.`, t.p)
      }
      return { t: 'call', fn, args }
    }
    throw new FormulaError(`"${t.v}" fora do lugar na posição ${t.p + 1}.`, t.p)
  }

  private expect(v: string, msg: string) {
    const t = this.peek()
    if (t?.k !== 'op' || t.v !== v) throw new FormulaError(msg, t?.p ?? this.srcLen)
    this.i++
  }
}

export interface CompiledFormula {
  source: string
  variables: string[]
  ast: Node
}

/** Confere a sintaxe e devolve a fórmula pronta para calcular. Lança FormulaError com a explicação em português. */
export function compileFormula(source: string): CompiledFormula {
  const src = (source ?? '').trim()
  if (src.length > FORMULA_MAX) throw new FormulaError(`A fórmula passa de ${FORMULA_MAX} caracteres.`)
  const ast = new Parser(tokenize(src), src.length).parse()
  const vars = new Set<string>()
  const walk = (n: Node) => {
    if (n.t === 'var') vars.add(n.name)
    else if (n.t === 'un') walk(n.a)
    else if (n.t === 'bin') {
      walk(n.a)
      walk(n.b)
    } else if (n.t === 'call') n.args.forEach(walk)
  }
  walk(ast)
  return { source: src, variables: [...vars].sort(), ast }
}

/** Valida sem lançar: para o editor de fórmulas. */
export function checkFormula(source: string): { ok: true; variables: string[] } | { ok: false; error: string; position: number | null } {
  try {
    return { ok: true, variables: compileFormula(source).variables }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message, position: e.position ?? null }
    throw e
  }
}

export interface EvalResult {
  value: number
  /** Variáveis usadas que não tinham valor (contam como zero). */
  missing: string[]
}

/** Calcula. Variável sem valor conta como 0 e é avisada; divisão por zero é erro (nunca vira valor de cobrança calado). */
export function evaluate(f: CompiledFormula, vars: Record<string, number | null | undefined>): EvalResult {
  const missing = new Set<string>()
  const ev = (n: Node): number => {
    switch (n.t) {
      case 'num':
        return n.v
      case 'var': {
        const v = vars[n.name]
        if (v === null || v === undefined || !Number.isFinite(v)) {
          missing.add(n.name)
          return 0
        }
        return v
      }
      case 'un': {
        const a = ev(n.a)
        return n.op === '-' ? -a : a ? 0 : 1
      }
      case 'bin': {
        if (n.op === '&&') return ev(n.a) && ev(n.b) ? 1 : 0
        if (n.op === '||') return ev(n.a) || ev(n.b) ? 1 : 0
        const a = ev(n.a)
        const b = ev(n.b)
        switch (n.op) {
          case '+':
            return a + b
          case '-':
            return a - b
          case '*':
            return a * b
          case '/':
          case '%':
            if (b === 0) throw new FormulaError('Divisão por zero: confira se a variável do divisor tem valor na regra (ex.: fração do pedágio).')
            return n.op === '/' ? a / b : a % b
          case '>':
            return a > b ? 1 : 0
          case '<':
            return a < b ? 1 : 0
          case '>=':
            return a >= b ? 1 : 0
          case '<=':
            return a <= b ? 1 : 0
          case '==':
            return Math.abs(a - b) < 1e-9 ? 1 : 0
          case '!=':
            return Math.abs(a - b) < 1e-9 ? 0 : 1
        }
        throw new FormulaError(`Operador desconhecido: ${n.op}`)
      }
      case 'call': {
        if (n.fn === 'if') return ev(n.args[0]!) ? ev(n.args[1]!) : ev(n.args[2]!)
        const xs = n.args.map(ev)
        switch (n.fn) {
          case 'ceil':
            // Tolerância de ponto flutuante: 150 / 100 * 100 não pode virar 151 frações.
            return Math.ceil(xs[0]! - 1e-9)
          case 'floor':
            return Math.floor(xs[0]! + 1e-9)
          case 'round':
            return roundTo(xs[0]!, xs[1] ?? 0)
          case 'abs':
            return Math.abs(xs[0]!)
          case 'min':
            return Math.min(...xs)
          case 'max':
            return Math.max(...xs)
        }
        throw new FormulaError(`Função desconhecida: ${n.fn}`)
      }
    }
  }
  const value = ev(f.ast)
  if (!Number.isFinite(value)) throw new FormulaError('O resultado não é um número válido.')
  return { value, missing: [...missing].sort() }
}

/** Arredondamento comercial (meio para cima, também em valores negativos), sem o erro de 1,005 → 1,00. */
export function roundTo(x: number, digits = 2) {
  const d = Math.max(0, Math.min(6, Math.trunc(digits)))
  const f = 10 ** d
  const sign = x < 0 ? -1 : 1
  return (sign * Math.round(Number((Math.abs(x) * f).toPrecision(15)))) / f
}

export const money = (x: number) => roundTo(x, 2)
