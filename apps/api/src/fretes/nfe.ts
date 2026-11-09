// Leitura do XML da NF-e (modelo 55, nfeProc com protNFe) e do evento de cancelamento (procEventoNFe 110111), e a
// abertura segura do .zip enviado na importação. Não valida assinatura: os dados servem para os pedidos de frete e o
// confronto com o CT-e, não como documento fiscal. Sem banco e sem rede (test/fretes-nfe.spec.ts).
import { unzipSync } from 'fflate'

const str = (v: string | null, max = 200) => {
  if (v === null) return null
  const s = v.replace(/[\u0000-\u001f]/g, ' ').trim()
  return s ? s.slice(0, max) : null
}
const num = (s: string | null) => (s === null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s))
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d
const digits = (v: string | null) => String(v ?? '').replace(/\D/g, '')
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)
  return m ? decode(m[1]!.trim()) : null
}
const block = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)
  return m ? m[1]! : null
}

/** DTD e entidades nunca são aceitos (XXE): NF-e e eventos da SEFAZ não têm DOCTYPE. */
export function unsafeXml(xml: string) {
  return /<!DOCTYPE|<!ENTITY/i.test(xml)
}

export interface NfeData {
  key: string
  number: string | null
  series: string | null
  issuedAt: string | null
  model: string | null
  /** tpNF: 0 entrada, 1 saída. */
  direction: string | null
  emitCnpj: string | null
  value: number | null
  freightValue: number | null
  /** 0 emitente (CIF), 1 destinatário (FOB), 2 terceiros, 3/4 próprio, 9 sem frete. */
  freightMode: string | null
  carrierCnpj: string | null
  carrierName: string | null
  volumes: number | null
  grossWeight: number | null
  netWeight: number | null
  destName: string | null
  /** Só CNPJ; destinatário pessoa física fica só como PF (o CPF não sai do XML). */
  destCnpj: string | null
  destPersonType: 'PF' | 'PJ' | null
  destZip: string | null
  destCity: string | null
  destUf: string | null
  destIbge: string | null
  /** cStat do protocolo (100/150 = autorizada); null quando o XML veio sem protocolo. */
  protocolStatus: string | null
}

/** Lê o XML da NF-e (ou do nfeProc). Lança erro se não parecer uma NF-e. */
export function parseNfeXml(raw: string): NfeData {
  const xml = raw.replace(/^﻿/, '')
  if (unsafeXml(xml)) throw new Error('XML com DOCTYPE/entidades não é aceito.')
  const inf = block(xml, 'infNFe')
  const ide = inf ? block(inf, 'ide') : null
  if (!inf || !ide) throw new Error('O conteúdo não é um XML de NF-e.')
  const key = /<(?:\w+:)?infNFe[^>]*\bId="NFe(\d{44})"/.exec(xml)?.[1] ?? tag(xml, 'chNFe')
  if (!key || !/^\d{44}$/.test(key)) throw new Error('NF-e sem chave de acesso.')
  const tot = block(inf, 'ICMSTot') ?? ''
  const transp = block(inf, 'transp') ?? ''
  const transporta = block(transp, 'transporta') ?? ''
  const vols = [...transp.matchAll(/<(?:\w+:)?vol(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?vol>/g)].map((m) => m[1]!)
  const sum = (field: string, d: number) => {
    const vals = vols.map((v) => num(tag(v, field))).filter((n): n is number => n !== null)
    return vals.length ? round(vals.reduce((s, n) => s + n, 0), d) : null
  }
  const dest = block(inf, 'dest') ?? ''
  const ender = block(dest, 'enderDest') ?? ''
  const destCnpj = tag(dest, 'CNPJ')
  const destCpf = tag(dest, 'CPF')
  const zip = digits(tag(ender, 'CEP'))
  const uf = tag(ender, 'UF')
  const ibge = digits(tag(ender, 'cMun'))
  const carrierCnpj = digits(tag(transporta, 'CNPJ'))
  const emitCnpj = digits(tag(block(inf, 'emit') ?? '', 'CNPJ'))
  const prot = block(xml, 'infProt')
  const qVol = sum('qVol', 0)
  return {
    key,
    number: tag(ide, 'nNF'),
    series: tag(ide, 'serie'),
    issuedAt: tag(ide, 'dhEmi') ?? tag(ide, 'dEmi'),
    model: tag(ide, 'mod'),
    direction: tag(ide, 'tpNF'),
    emitCnpj: emitCnpj.length === 14 ? emitCnpj : null,
    value: num(tag(tot, 'vNF')),
    freightValue: num(tag(tot, 'vFrete')),
    freightMode: tag(transp, 'modFrete'),
    carrierCnpj: carrierCnpj.length === 14 ? carrierCnpj : null,
    carrierName: str(tag(transporta, 'xNome'), 160),
    volumes: qVol === null ? null : Math.round(qVol),
    grossWeight: sum('pesoB', 3),
    netWeight: sum('pesoL', 3),
    destName: str(tag(dest, 'xNome'), 160),
    destCnpj: destCnpj && /^\d{14}$/.test(destCnpj) ? destCnpj : null,
    destPersonType: destCnpj ? 'PJ' : destCpf ? 'PF' : null,
    destZip: zip.length === 8 ? zip : null,
    destCity: str(tag(ender, 'xMun'), 120),
    destUf: uf && /^[A-Z]{2}$/.test(uf) ? uf : null,
    destIbge: ibge.length === 7 ? ibge : null,
    protocolStatus: prot ? tag(prot, 'cStat') : null,
  }
}

/** Nota com transporte a conciliar: frete do emitente, do destinatário ou de terceiros (não próprio nem sem frete). */
export function hasFreight(nf: Pick<NfeData, 'freightMode'>) {
  return nf.freightMode === '0' || nf.freightMode === '1' || nf.freightMode === '2'
}

export interface NfeEvent {
  key: string
  type: string
  /** cStat do retorno do evento (135/136 = registrado). */
  status: string | null
  emitCnpj: string | null
}

/** Evento da NF-e (procEventoNFe). null quando o XML não é um evento de NF-e. */
export function parseNfeEvent(raw: string): NfeEvent | null {
  const xml = raw.replace(/^﻿/, '')
  if (unsafeXml(xml)) return null
  const ev = block(xml, 'infEvento')
  if (!ev) return null
  const key = tag(ev, 'chNFe')
  const type = tag(ev, 'tpEvento')
  if (!key || !/^\d{44}$/.test(key) || !type) return null
  const ret = block(xml, 'retEvento')
  const cnpj = digits(tag(ev, 'CNPJ'))
  return { key, type, status: ret ? tag(ret, 'cStat') : null, emitCnpj: cnpj.length === 14 ? cnpj : null }
}

/** Cancelamento registrado na SEFAZ (110111, retorno 135/136; sem retorno no arquivo, vale o evento). */
export function isCancellation(e: NfeEvent) {
  return e.type === '110111' && (e.status === null || e.status === '135' || e.status === '136' || e.status === '155')
}

export const NFE_IMPORT_LIMITS = { files: 2000, entryBytes: 2 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 }

/**
 * Arquivos enviados: XMLs soltos ou .zip com XMLs. Do .zip só entram arquivos .xml (o caminho é descartado: só o nome),
 * até 2 MB cada, 2.000 arquivos e 100 MB no total; zip com senha ou corrompido dá erro.
 */
export function expandUpload(files: { name: string; buffer: Buffer }[], limits = NFE_IMPORT_LIMITS): { docs: { name: string; text: string }[]; skipped: { name: string; reason: string }[] } {
  const docs: { name: string; text: string }[] = []
  const skipped: { name: string; reason: string }[] = []
  let total = 0
  const add = (name: string, data: Uint8Array) => {
    total += data.length
    if (total > limits.totalBytes) throw new Error('Arquivos grandes demais: envie até 100 MB de XML por vez.')
    if (docs.length >= limits.files) throw new Error(`Envie até ${limits.files} XMLs por vez.`)
    docs.push({ name, text: Buffer.from(data).toString('utf8') })
  }
  for (const f of files) {
    const base = (f.name.split(/[\\/]/).pop() ?? 'arquivo').slice(0, 120)
    if (f.buffer[0] === 0x50 && f.buffer[1] === 0x4b) {
      let entries: Record<string, Uint8Array>
      let count = 0
      try {
        entries = unzipSync(f.buffer, {
          filter: (e) => {
            const name = e.name.split(/[\\/]/).pop() ?? ''
            if (!/\.xml$/i.test(name)) return false
            if (e.originalSize > limits.entryBytes) {
              skipped.push({ name: `${base} › ${name.slice(0, 120)}`, reason: 'XML maior que 2 MB.' })
              return false
            }
            if (++count > limits.files) throw new Error(`O .zip tem mais de ${limits.files} XMLs.`)
            return true
          },
        })
      } catch (e) {
        throw new Error((e as Error).message.startsWith('O .zip') ? (e as Error).message : `Não foi possível abrir ${base} (zip com senha ou corrompido?).`)
      }
      for (const [name, data] of Object.entries(entries)) {
        // O tamanho declarado no zip pode mentir: confere o real.
        if (data.length > limits.entryBytes) skipped.push({ name: `${base} › ${name}`, reason: 'XML maior que 2 MB.' })
        else add(`${base} › ${(name.split(/[\\/]/).pop() ?? name).slice(0, 120)}`, data)
      }
    } else if (/\.xml$/i.test(base) || f.buffer.subarray(0, 200).toString('utf8').trimStart().startsWith('<')) {
      if (f.buffer.length > limits.entryBytes) skipped.push({ name: base, reason: 'XML maior que 2 MB.' })
      else add(base, f.buffer)
    } else skipped.push({ name: base, reason: 'Não é .xml nem .zip.' })
  }
  return { docs, skipped }
}
