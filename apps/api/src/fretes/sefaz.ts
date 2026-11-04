// Captura de CT-e na SEFAZ pela Distribuição DF-e (web service CTeDistribuicaoDFe do Ambiente Nacional). Aqui só o que
// não depende de rede nem de banco (test/fretes-sefaz.spec.ts): o envelope SOAP, a leitura da resposta, os documentos
// compactados, o filtro de data e a leitura do certificado A1.

import { X509Certificate } from 'node:crypto'
import { createSecureContext } from 'node:tls'
import { gunzipSync } from 'node:zlib'

export const SEFAZ_ENDPOINT = {
  PRODUCAO: 'https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
  HOMOLOGACAO: 'https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
} as const
export type SefazEnv = keyof typeof SEFAZ_ENDPOINT

/** Intervalos de busca automática (horas). 0 = desligada. */
export const SEFAZ_INTERVALS = [0, 4, 8, 12, 24] as const
/** Depois de "nenhum documento" (137) ou de consumo indevido (656), a SEFAZ pede 1 hora antes da próxima consulta. */
export const SEFAZ_WAIT_MS = 60 * 60_000
export const MAX_LOOKBACK_DAYS = 7

/** Código IBGE das UFs (cUFAutor). */
export const UF_CODE: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
}

const NS = 'http://www.portalfiscal.inf.br/cte'
const WSDL = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe'

/** Envelope SOAP 1.2 da consulta por último NSU (distNSU). */
export function distEnvelope(p: { env: SefazEnv; ufCode: number; cnpj: string; ultNsu: string }) {
  const nsu = p.ultNsu.replace(/\D/g, '').padStart(15, '0').slice(-15)
  const body = `<distDFeInt xmlns="${NS}" versao="1.00"><tpAmb>${p.env === 'PRODUCAO' ? 1 : 2}</tpAmb><cUFAutor>${p.ufCode}</cUFAutor><CNPJ>${p.cnpj.replace(/\D/g, '')}</CNPJ><distNSU><ultNSU>${nsu}</ultNSU></distNSU></distDFeInt>`
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDistDFeInteresse xmlns="${WSDL}"><cteDadosMsg>${body}</cteDadosMsg></cteDistDFeInteresse></soap12:Body></soap12:Envelope>`
}
export const SOAP_ACTION = `${WSDL}/cteDistDFeInteresse`

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)
  return m ? m[1]!.trim() : null
}

export interface DistDoc {
  nsu: string
  schema: string
  xml: string
}
export interface DistResponse {
  cStat: string
  xMotivo: string
  ultNsu: string | null
  maxNsu: string | null
  docs: DistDoc[]
}

/** Lê o retDistDFeInt. Documentos que não abrem (base64/gzip inválidos) são descartados. */
export function parseDistResponse(xml: string): DistResponse {
  const ret = /<(?:\w+:)?retDistDFeInt[\s\S]*?<\/(?:\w+:)?retDistDFeInt>/.exec(xml)?.[0]
  if (!ret) {
    const fault = tag(xml, 'Text') ?? tag(xml, 'faultstring')
    throw new Error(fault ? `SEFAZ: ${fault}` : 'Resposta da SEFAZ sem retDistDFeInt.')
  }
  const docs: DistDoc[] = []
  for (const m of ret.matchAll(/<(?:\w+:)?docZip\b([^>]*)>([^<]+)<\/(?:\w+:)?docZip>/g)) {
    const attrs = m[1]!
    const nsu = /NSU="(\d+)"/.exec(attrs)?.[1] ?? ''
    const schema = /schema="([^"]+)"/.exec(attrs)?.[1] ?? ''
    const text = unzipDoc(m[2]!)
    if (text) docs.push({ nsu, schema, xml: text })
  }
  return { cStat: tag(ret, 'cStat') ?? '', xMotivo: tag(ret, 'xMotivo') ?? '', ultNsu: tag(ret, 'ultNSU'), maxNsu: tag(ret, 'maxNSU'), docs }
}

/** docZip: base64 de um XML compactado com gzip. */
export function unzipDoc(b64: string): string | null {
  try {
    return gunzipSync(Buffer.from(b64.replace(/\s+/g, ''), 'base64'), { maxOutputLength: 10 * 1024 * 1024 }).toString('utf8')
  } catch {
    return null
  }
}

/** Tipo do documento distribuído: CT-e completo, evento (cancelamento etc.) ou outro (resumo, CT-e OS...). */
export function docKind(d: Pick<DistDoc, 'schema' | 'xml'>): 'CTE' | 'EVENTO' | 'OUTRO' {
  if (/^procCTe/i.test(d.schema) || /<(?:\w+:)?cteProc[\s>]/.test(d.xml)) return 'CTE'
  if (/^procEventoCTe/i.test(d.schema) || /<(?:\w+:)?procEventoCTe[\s>]/.test(d.xml)) return 'EVENTO'
  return 'OUTRO'
}

/** Data de emissão do CT-e (dhEmi) dentro dos últimos N dias? Sem data, entra. */
export function withinDays(xml: string, days: number, now = new Date()) {
  const dh = tag(xml, 'dhEmi')
  if (!dh) return true
  const t = Date.parse(dh)
  return Number.isNaN(t) || t >= now.getTime() - days * 86_400_000
}

/** Compara NSUs (texto com zeros à esquerda). */
export const nsuLess = (a: string | null | undefined, b: string | null | undefined) => BigInt((a ?? '0').replace(/\D/g, '') || '0') < BigInt((b ?? '0').replace(/\D/g, '') || '0')

export interface CertInfo {
  subject: string
  cnpj: string | null
  validFrom: Date
  validTo: Date
}

// OID 2.16.76.1.3.3 (CNPJ do titular no e-CNPJ ICP-Brasil), codificado em DER.
const OID_CNPJ = Buffer.from([0x06, 0x05, 0x60, 0x4c, 0x01, 0x03, 0x03])

/**
 * Lê o certificado A1 (.pfx/.p12): confere a senha (erro "senha incorreta"), titular, validade e o CNPJ (campo
 * 2.16.76.1.3.3 do ICP-Brasil, senão o ":CNPJ" do nome, senão o serialNumber do titular).
 */
export function readCertificate(pfx: Buffer, passphrase: string): CertInfo {
  let der: Buffer
  try {
    const ctx = createSecureContext({ pfx, passphrase }) as unknown as { context: { getCertificate(): Buffer | null } }
    const c = ctx.context.getCertificate()
    if (!c) throw new Error('sem certificado')
    der = c
  } catch (e) {
    const msg = (e as Error).message
    if (/mac verify|bad decrypt|invalid password/i.test(msg)) throw new Error('Senha do certificado incorreta.')
    throw new Error('Não foi possível abrir o certificado. Envie o arquivo .pfx ou .p12 do certificado A1.')
  }
  const x = new X509Certificate(der)
  let cnpj: string | null = null
  const at = der.indexOf(OID_CNPJ)
  if (at >= 0) cnpj = /\d{14}/.exec(der.subarray(at, at + 60).toString('latin1'))?.[0] ?? null
  cnpj ??= /:(\d{14})(?:\D|$)/.exec(x.subject)?.[1] ?? /serialNumber=(?:\D*)(\d{14})/i.exec(x.subject)?.[1] ?? null
  const cn = /CN=([^\n]+)/.exec(x.subject)?.[1]?.trim() ?? x.subject.replace(/\n/g, ', ')
  return { subject: cn.slice(0, 200), cnpj, validFrom: new Date(x.validFrom), validTo: new Date(x.validTo) }
}
