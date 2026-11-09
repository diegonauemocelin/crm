/**
 * Power BI (fase 2): projeto do Power BI Desktop (.pbip, modelo em TMDL e relatório em PBIR) do CRM.
 *
 * - `projetoPowerBi()` monta todos os arquivos gerados (caminho relativo à pasta bi/powerbi → conteúdo). O teste
 *   bi-powerbi.spec.ts confere se a pasta do repositório está em dia (ATUALIZAR_POWERBI=1 regrava).
 * - `zipDoProjeto()` empacota a pasta (copiada para a imagem da API) para o download em Configurações › Power BI,
 *   trocando o endereço do parâmetro CRM_BaseUrl pelo endereço real do CRM.
 * Puro (sem Nest nem banco).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { zipSync } from 'fflate'
import { medidas } from './powerbi-medidas'
import { DATABASE_TMDL, expressionsTmdl, modelTmdl, POWERBI_BASE_PADRAO, relacoes, relationshipsTmdl, tableFile, tableTmdl, tabelasDoModelo } from './powerbi-modelo'
import { pageJson, pagesJson, paginas, reportJson, versionJson, visualJson } from './powerbi-relatorio'

export const PROJETO = 'CRM Usaparts'
export const MODELO_DIR = `${PROJETO}.SemanticModel`
export const RELATORIO_DIR = `${PROJETO}.Report`
export const EXPRESSIONS_FILE = `${MODELO_DIR}/definition/expressions.tmdl`

/** Ids fixos dos itens (o Power BI Service usa para ligar o item ao Git; mudar cria outro item). */
const LOGICAL_ID = { modelo: '7d3f6c2a-4b1e-4f0a-9c8d-1a2b3c4d5e61', relatorio: '7d3f6c2a-4b1e-4f0a-9c8d-1a2b3c4d5e62' }

const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n'

const platform = (type: 'SemanticModel' | 'Report', logicalId: string) =>
  json({
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
    metadata: { type, displayName: PROJETO },
    config: { version: '2.0', logicalId },
  })

/** Arquivos gerados do projeto (caminho com "/" relativo a bi/powerbi → conteúdo). */
export function projetoPowerBi(): Map<string, string> {
  const files = new Map<string, string>()
  const tabelas = tabelasDoModelo(medidas())

  files.set(`${PROJETO}.pbip`, json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json', version: '1.0', artifacts: [{ report: { path: RELATORIO_DIR } }], settings: { enableAutoRecovery: true } }))

  // Modelo semântico (TMDL)
  files.set(`${MODELO_DIR}/.platform`, platform('SemanticModel', LOGICAL_ID.modelo))
  files.set(`${MODELO_DIR}/definition.pbism`, json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json', version: '4.2', settings: {} }))
  files.set(`${MODELO_DIR}/definition/database.tmdl`, DATABASE_TMDL)
  files.set(`${MODELO_DIR}/definition/model.tmdl`, modelTmdl(tabelas))
  files.set(EXPRESSIONS_FILE, expressionsTmdl())
  files.set(`${MODELO_DIR}/definition/relationships.tmdl`, relationshipsTmdl(relacoes()))
  for (const t of tabelas) files.set(`${MODELO_DIR}/definition/${tableFile(t.nome)}`, tableTmdl(t))

  // Relatório (PBIR)
  files.set(`${RELATORIO_DIR}/.platform`, platform('Report', LOGICAL_ID.relatorio))
  files.set(`${RELATORIO_DIR}/definition.pbir`, json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json', version: '4.0', datasetReference: { byPath: { path: `../${MODELO_DIR}` } } }))
  files.set(`${RELATORIO_DIR}/definition/version.json`, json(versionJson()))
  files.set(`${RELATORIO_DIR}/definition/report.json`, json(reportJson()))
  const ps = paginas()
  files.set(`${RELATORIO_DIR}/definition/pages/pages.json`, json(pagesJson(ps)))
  for (const p of ps) {
    files.set(`${RELATORIO_DIR}/definition/pages/${p.nome}/page.json`, json(pageJson(p)))
    p.visuais.forEach((v, i) => files.set(`${RELATORIO_DIR}/definition/pages/${p.nome}/visuals/${v.nome}/visual.json`, json(visualJson(v, (i + 1) * 1000))))
  }
  return files
}

/** Arquivos da pasta (recursivo), com caminho relativo e "/". Ignora arquivos locais do Power BI Desktop. */
export function listarPasta(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome)
      if (statSync(p).isDirectory()) {
        if (nome === '.pbi' || nome === 'node_modules') continue
        walk(p)
      } else if (nome !== '.gitignore' && nome !== 'cache.abf' && nome !== 'localSettings.json') out.push(relative(dir, p).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

/** Troca o endereço padrão do parâmetro CRM_BaseUrl pelo endereço da API de BI deste CRM. */
export function comEndereco(expressions: string, base: string): string {
  if (!/^https?:\/\/[^\s"]+\/$/.test(base)) return expressions
  return expressions.replace(`expression CRM_BaseUrl = "${POWERBI_BASE_PADRAO}"`, `expression CRM_BaseUrl = "${base}"`)
}

/** Zip do projeto (pasta "CRM Usaparts - Power BI/" dentro do zip), com o endereço real no CRM_BaseUrl. */
export function zipDoProjeto(dir: string, base: string): Uint8Array {
  const raiz = `${PROJETO} - Power BI`
  const entries: Record<string, Uint8Array> = {}
  const enc = new TextEncoder()
  for (const rel of listarPasta(dir)) {
    const buf = readFileSync(join(dir, ...rel.split('/')))
    entries[`${raiz}/${rel}`] = rel === EXPRESSIONS_FILE ? enc.encode(comEndereco(buf.toString('utf8'), base)) : new Uint8Array(buf)
  }
  return zipSync(entries, { level: 6, mtime: new Date('2026-11-09T12:00:00Z') })
}
