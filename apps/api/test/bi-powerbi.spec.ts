import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { M_CRM_TABELA, M_TYPE } from '../src/bi/bi-contrato'
import { TABLES } from '../src/bi/bi-tabelas'
import { comEndereco, EXPRESSIONS_FILE, listarPasta, MODELO_DIR, projetoPowerBi, RELATORIO_DIR, zipDoProjeto } from '../src/bi/powerbi'
import { medidas } from '../src/bi/powerbi-medidas'
import { CENARIOS, MEDIDAS, POWERBI_BASE_PADRAO, relacoes, tabelasDoModelo } from '../src/bi/powerbi-modelo'
import { type Campo, paginas } from '../src/bi/powerbi-relatorio'

const PASTA = fileURLToPath(new URL('../../../bi/powerbi', import.meta.url))
/** Arquivos da pasta que não são gerados (escritos à mão ou copiados). */
const MANUAIS = ['LEIA-ME.md', `${RELATORIO_DIR}/StaticResources/SharedResources/BaseThemes/CY25SU12.json`]

const files = projetoPowerBi()
const tabelas = tabelasDoModelo(medidas())
const porNome = new Map(tabelas.map((t) => [t.nome, t]))

// ---------- Leitor mínimo de TMDL (estrutura e recuo) ----------

interface No {
  nivel: number
  texto: string
  filhos: No[]
  expressao: string[]
}

/** Lê um arquivo TMDL: recuo só com tab, expressões de várias linhas dois níveis abaixo do objeto (ou um abaixo da propriedade). */
function lerTmdl(src: string): No[] {
  const raiz: No = { nivel: -1, texto: '', filhos: [], expressao: [] }
  const pilha: No[] = [raiz]
  let emExpressao: { no: No; min: number } | null = null
  for (const [i, linha] of src.split('\n').entries()) {
    if (linha.trim() === '') continue
    const recuo = /^\t*/.exec(linha)![0].length
    if (/^\t* +/.test(linha) && !emExpressao) throw new Error(`linha ${i + 1}: recuo com espaços: ${JSON.stringify(linha)}`)
    if (emExpressao && recuo >= emExpressao.min) {
      emExpressao.no.expressao.push(linha.slice(emExpressao.min))
      continue
    }
    emExpressao = null
    const texto = linha.slice(recuo)
    while (pilha.length > 1 && pilha[pilha.length - 1]!.nivel >= recuo) pilha.pop()
    const pai = pilha[pilha.length - 1]!
    if (recuo !== pai.nivel + 1) throw new Error(`linha ${i + 1}: recuo ${recuo} inesperado (pai no nível ${pai.nivel}): ${texto}`)
    const no: No = { nivel: recuo, texto, filhos: [], expressao: [] }
    pai.filhos.push(no)
    pilha.push(no)
    if (/=\s*$/.test(texto)) {
      // "measure X =" (objeto): expressão 2 níveis abaixo; "source =" (propriedade): 1 nível abaixo.
      const objeto = /^(measure|column|expression|partition|table)\b/.test(texto)
      emExpressao = { no, min: recuo + (objeto ? 2 : 1) }
    }
  }
  return raiz.filhos
}

const PERMITIDOS: Record<string, RegExp> = {
  table: /^(\/\/\/ .*|dataCategory: Time|measure .+|column .+|hierarchy .+|partition .+ = (m|calculated))$/,
  measure: /^(formatString: .+|displayFolder: .+)$/,
  column: /^(dataType: (string|int64|double|decimal|dateTime|boolean)|isHidden|isKey|formatString: .+|summarizeBy: (none|sum|average)|sourceColumn: .+|sortByColumn: .+|annotation UnderlyingDateTimeDataType = Date)$/,
  hierarchy: /^level .+$/,
  level: /^column: .+$/,
  partition: /^(mode: import|source =)$/,
}

function conferirArvore(nos: No[]) {
  for (const n of nos) {
    const tipo = n.texto.split(' ')[0]!
    const regra = PERMITIDOS[tipo]
    if (!regra) continue
    for (const f of n.filhos) {
      if (f.texto.startsWith('///')) continue
      expect(f.texto, `${n.texto} › ${f.texto}`).toMatch(regra)
    }
    conferirArvore(n.filhos)
  }
}

// ---------- Nomes no DAX ----------

const unquote = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s)
const medidaNomes = new Set(tabelas.flatMap((t) => t.medidas.map((m) => m.nome)))
const colunaExiste = (tabela: string, coluna: string) => !!porNome.get(tabela)?.colunas.some((c) => c.nome === coluna)

/** Confere as referências de um DAX: Tabela[coluna] precisa existir; [Nome] solto precisa ser medida (ou coluna da própria tabela). */
function conferirDax(dax: string, tabelaAtual: string | null, colunasLocais: string[] = []) {
  const semTextos = dax.replace(/"(?:[^"]|"")*"/g, '""')
  const re = /('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)?\[([^\]]+)\]/g
  for (const m of semTextos.matchAll(re)) {
    const tabela = m[1] ? unquote(m[1]) : null
    const nome = m[2]!
    if (tabela) {
      expect(colunaExiste(tabela, nome), `${tabela}[${nome}] em: ${dax}`).toBe(true)
    } else {
      const ok = medidaNomes.has(nome) || colunasLocais.includes(nome) || (tabelaAtual !== null && colunaExiste(tabelaAtual, nome))
      expect(ok, `[${nome}] em: ${dax}`).toBe(true)
    }
  }
}

describe('Projeto do Power BI (bi/powerbi)', () => {
  it('a pasta do repositório está em dia (ATUALIZAR_POWERBI=1 regrava)', () => {
    if (process.env.ATUALIZAR_POWERBI === '1') {
      for (const d of [MODELO_DIR, RELATORIO_DIR]) {
        for (const rel of existsSync(`${PASTA}/${d}`) ? listarPasta(`${PASTA}/${d}`) : []) {
          const caminho = `${d}/${rel}`
          if (!files.has(caminho) && !MANUAIS.includes(caminho)) rmSync(`${PASTA}/${caminho}`)
        }
      }
      for (const [rel, conteudo] of files) {
        mkdirSync(dirname(`${PASTA}/${rel}`), { recursive: true })
        writeFileSync(`${PASTA}/${rel}`, conteudo)
      }
    }
    const naPasta = listarPasta(PASTA).filter((f) => !f.startsWith('.'))
    expect(naPasta.filter((f) => !files.has(f) && !MANUAIS.includes(f) && !f.endsWith('/.platform') && f !== '.gitignore')).toEqual([])
    for (const m of MANUAIS) expect(existsSync(`${PASTA}/${m}`), m).toBe(true)
    for (const [rel, conteudo] of files) expect(readFileSync(`${PASTA}/${rel}`, 'utf8'), rel).toBe(conteudo)
  })

  it('todo arquivo TMDL tem recuo com tab e só propriedades conhecidas', () => {
    const tmdl = [...files].filter(([f]) => f.endsWith('.tmdl'))
    expect(tmdl.length).toBe(4 + tabelas.length)
    for (const [f, src] of tmdl) {
      const arvore = lerTmdl(src)
      expect(arvore.length, f).toBeGreaterThan(0)
      conferirArvore(arvore)
    }
  })

  it('tem uma tabela por tabela do contrato, com as mesmas colunas e tipos', () => {
    const tipo = { texto: 'string', inteiro: 'int64', decimal: 'double', moeda: 'decimal', data: 'dateTime', datahora: 'dateTime', booleano: 'boolean' }
    for (const t of TABLES) {
      const src = files.get(`${MODELO_DIR}/definition/tables/${t.nome}.tmdl`)
      expect(src, t.nome).toBeDefined()
      const arvore = lerTmdl(src!)
      const tabela = arvore.find((n) => n.texto === `table ${t.nome}`)!
      const importadas = tabela.filhos.filter((n) => /^column \S+$/.test(n.texto))
      expect(importadas.map((n) => n.texto.slice(7)), t.nome).toEqual(t.colunas.map((c) => c.nome))
      for (const c of t.colunas) {
        const no = importadas.find((n) => n.texto === `column ${c.nome}`)!
        expect(no.filhos.map((f) => f.texto)).toContain(`dataType: ${tipo[c.tipo]}`)
        expect(no.filhos.map((f) => f.texto)).toContain(`sourceColumn: ${c.nome}`)
      }
      const particao = tabela.filhos.find((n) => n.texto.startsWith('partition '))!
      const fonte = particao.filhos.find((n) => n.texto === 'source =')!.expressao.join('\n')
      expect(fonte).toContain(`CRM_Tabela("${t.nome}")`)
      for (const c of t.colunas) expect(fonte).toContain(`{"${c.nome}", ${M_TYPE[c.tipo]}}`)
      if (t.tipo === 'dimensao') expect(importadas.find((n) => n.texto === `column ${t.chave}`)!.filhos.map((f) => f.texto)).toContain('isKey')
    }
  })

  it('parâmetros e a função CRM_Tabela são os do contrato', () => {
    const src = files.get(EXPRESSIONS_FILE)!
    const arvore = lerTmdl(src)
    expect(arvore.map((n) => n.texto.split(' =')[0])).toEqual(['/// Endereço da API de BI do CRM (termina em /api/bi/v1/).', 'expression CRM_BaseUrl', '/// Chave de acesso criada em Configurações › Power BI no CRM (crmbi_...).', 'expression CRM_Chave', '/// Lê uma tabela da API de BI do CRM, página por página (contrato de dados, seção 3).', 'expression CRM_Tabela'])
    const funcao = arvore.find((n) => n.texto === 'expression CRM_Tabela =')!
    expect(funcao.expressao.join('\n')).toBe(M_CRM_TABELA)
    expect(src).toContain(`expression CRM_BaseUrl = "${POWERBI_BASE_PADRAO}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`)
    expect(comEndereco(src, 'https://crm.outra.com.br/api/bi/v1/')).toContain('expression CRM_BaseUrl = "https://crm.outra.com.br/api/bi/v1/" meta')
    expect(comEndereco(src, 'javascript:alert(1)')).toBe(src)
  })

  it('relações do contrato e do calendário, ligando colunas que existem', () => {
    const rels = relacoes()
    const contrato = TABLES.flatMap((t) => t.relacoes.map((r) => `${t.nome}[${r.coluna}]>${r.tabela}[${r.chave}]:${r.ativa !== false}`))
    for (const c of contrato) expect(rels.map((r) => `${r.de.tabela}[${r.de.coluna}]>${r.para.tabela}[${r.para.coluna}]:${r.ativa}`)).toContain(c)
    for (const t of TABLES) t.datas.forEach((d, i) => expect(rels.find((r) => r.de.tabela === t.nome && r.de.coluna === d && r.para.tabela === 'Calendario')?.ativa).toBe(i === 0))
    expect(new Set(rels.map((r) => r.nome)).size).toBe(rels.length)
    for (const r of rels) {
      expect(colunaExiste(r.de.tabela, r.de.coluna), `${r.de.tabela}[${r.de.coluna}]`).toBe(true)
      expect(colunaExiste(r.para.tabela, r.para.coluna), `${r.para.tabela}[${r.para.coluna}]`).toBe(true)
    }
    // Uma só relação ativa entre o mesmo par de tabelas (o Power BI recusa duas).
    const ativas = rels.filter((r) => r.ativa).map((r) => `${r.de.tabela}>${r.para.tabela}`)
    expect(new Set(ativas).size).toBe(ativas.length)
  })

  it('medidas com nome único, pasta e DAX que só cita o que existe', () => {
    const todas = tabelas.flatMap((t) => t.medidas)
    expect(new Set(todas.map((m) => m.nome)).size).toBe(todas.length)
    const colunas = new Set(tabelas.flatMap((t) => t.colunas.map((c) => c.nome)))
    for (const m of todas) {
      expect(colunas.has(m.nome), m.nome).toBe(false)
      expect(m.nome).not.toMatch(/[\]\n]/)
      expect(m.pasta.split('\\')[0]).toMatch(/^(Comercial|WhatsApp|Loja|Mercado Livre|Marketing|Fretes|Brindes|Cenários)$/)
      conferirDax(m.expressao, MEDIDAS)
    }
    for (const t of tabelas) {
      for (const c of t.colunas) if (c.expressao) conferirDax(c.expressao, t.nome)
      for (const c of t.colunas) if (c.sortByColumn) expect(colunaExiste(t.nome, c.sortByColumn)).toBe(true)
      for (const h of t.hierarquias) for (const n of h.niveis) expect(colunaExiste(t.nome, n.coluna), `${t.nome}.${h.nome}.${n.nome}`).toBe(true)
    }
    for (const c of CENARIOS) expect(porNome.get(c.nome)?.particao.fonte).toBe(`GENERATESERIES ( ${c.min}, ${c.max}, ${c.passo} )`)
    // Cenários: com tudo em 0% o projetado é igual ao real.
    expect(todas.find((m) => m.nome === 'Receita projetada')!.expressao).toBe('[Vendas projetadas] * [Ticket médio projetado]')
  })

  it('nomes sem repetir dentro de cada tabela (o Power BI ignora maiúsculas: coluna, hierarquia e medida)', () => {
    const low = (x: string) => x.toLocaleLowerCase('pt-BR')
    for (const t of tabelas) {
      const nomes = [...t.colunas.map((c) => c.nome), ...t.hierarquias.map((h) => h.nome), ...t.medidas.map((m) => m.nome)].map(low)
      const repetidos = nomes.filter((n, i) => nomes.indexOf(n) !== i)
      expect(repetidos, t.nome).toEqual([])
    }
    const colunas = new Set(tabelas.flatMap((t) => t.colunas.map((c) => low(c.nome))))
    const medidasNomes = tabelas.flatMap((t) => t.medidas.map((m) => low(m.nome)))
    expect(new Set(medidasNomes).size).toBe(medidasNomes.length)
    for (const m of medidasNomes) expect(colunas.has(m), m).toBe(false)
  })

  it('todo campo dos visuais existe no modelo (colunas, medidas e níveis de hierarquia)', () => {
    const existe = (c: Campo) => {
      if (c.tipo === 'medida') return medidaNomes.has(c.nome)
      if (c.tipo === 'coluna') return colunaExiste(c.tabela, c.coluna)
      return !!porNome.get(c.tabela)?.hierarquias.find((h) => h.nome === c.hierarquia)?.niveis.some((n) => n.nome === c.nivel)
    }
    const ps = paginas()
    expect(ps.map((p) => p.titulo)).toEqual(['Visão geral', 'Comercial', 'WhatsApp', 'Loja e Mercado Livre', 'Marketing', 'Fretes', 'Cenários'])
    const nomes = new Set<string>()
    for (const p of ps) {
      for (const v of p.visuais) {
        expect(nomes.has(v.nome), v.nome).toBe(false)
        nomes.add(v.nome)
        expect(v.nome.length).toBeLessThanOrEqual(50)
        expect(v.pos.x + v.pos.w, v.nome).toBeLessThanOrEqual(1280)
        expect(v.pos.y + v.pos.h, v.nome).toBeLessThanOrEqual(720)
        for (const campos of Object.values(v.papeis)) for (const c of campos) expect(existe(c), `${v.nome}: ${JSON.stringify(c)}`).toBe(true)
      }
    }
  })

  it('o zip leva a pasta inteira com o endereço deste CRM', () => {
    const zip = unzipSync(zipDoProjeto(PASTA, 'https://crm.exemplo.com.br/api/bi/v1/'))
    const nomes = Object.keys(zip)
    for (const f of [...files.keys(), ...MANUAIS]) expect(nomes).toContain(`CRM Usaparts - Power BI/${f}`)
    const expr = new TextDecoder().decode(zip[`CRM Usaparts - Power BI/${EXPRESSIONS_FILE}`])
    expect(expr).toContain('expression CRM_BaseUrl = "https://crm.exemplo.com.br/api/bi/v1/"')
  })
})
