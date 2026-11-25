import { useQuery } from '@tanstack/react-query'
import { PrinterIcon } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router'
import { ErrorState, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { code128c } from '@/lib/code128'

/** Lê o XML guardado do CT-e (o mesmo do botão XML). */
async function fetchXml(id: string) {
  const res = await fetch(`/api/fretes/ctes/${id}/xml`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(res.status === 404 ? 'O XML deste CT-e não foi guardado.' : res.status === 403 ? 'Sem permissão para baixar o CT-e (exportar).' : `Não foi possível ler o XML (HTTP ${res.status}).`)
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML do CT-e ilegível.')
  return doc
}

const first = (root: Element | Document | null | undefined, name: string): Element | null => (root ? (root.getElementsByTagNameNS('*', name)[0] ?? null) : null)
const all = (root: Element | Document | null | undefined, name: string): Element[] => (root ? Array.from(root.getElementsByTagNameNS('*', name)) : [])
const txt = (root: Element | Document | null | undefined, name: string) => first(root, name)?.textContent?.trim() ?? ''
const money = (v: string) => (v ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
const doc = (v: string) => (v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v.length === 11 ? v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : v)
const cep = (v: string) => (v.length === 8 ? `${v.slice(0, 5)}-${v.slice(5)}` : v)
const when = (v: string) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
const MODAL: Record<string, string> = { '01': 'Rodoviário', '02': 'Aéreo', '03': 'Aquaviário', '04': 'Ferroviário', '05': 'Dutoviário', '06': 'Multimodal' }
const TIPO: Record<string, string> = { '0': 'Normal', '1': 'Complementar', '2': 'Anulação', '3': 'Substituto' }
const SERV: Record<string, string> = { '0': 'Normal', '1': 'Subcontratação', '2': 'Redespacho', '3': 'Redespacho intermediário', '4': 'Serviço vinculado a multimodal' }
const TOMA: Record<string, string> = { '0': 'Remetente', '1': 'Expedidor', '2': 'Recebedor', '3': 'Destinatário', '4': 'Outros' }
const UNID: Record<string, string> = { '00': 'M3', '01': 'KG', '02': 'TON', '03': 'UNIDADE', '04': 'LITROS', '05': 'MMBTU' }

function Party({ title, el, addrTag }: { title: string; el: Element | null; addrTag: string }) {
  const a = first(el, addrTag)
  return (
    <div className="dacte-box">
      <div className="dacte-label">{title}</div>
      {el ? (
        <>
          <div className="dacte-strong">{txt(el, 'xNome')}</div>
          {a && (
            <div>
              {[txt(a, 'xLgr'), txt(a, 'nro'), txt(a, 'xCpl'), txt(a, 'xBairro')].filter(Boolean).join(', ')}
            </div>
          )}
          {a && (
            <div>
              {txt(a, 'xMun')} / {txt(a, 'UF')} · CEP {cep(txt(a, 'CEP'))}
            </div>
          )}
          <div>
            CNPJ/CPF {doc(txt(el, 'CNPJ') || txt(el, 'CPF'))}
            {txt(el, 'IE') && ` · IE ${txt(el, 'IE')}`}
            {txt(el, 'fone') && ` · Fone ${txt(el, 'fone')}`}
          </div>
        </>
      ) : (
        <div className="dacte-muted">—</div>
      )}
    </div>
  )
}

function Barcode({ value }: { value: string }) {
  const bars = code128c(value)
  if (!bars) return null
  const starts = bars.map((_, i) => bars.slice(0, i).reduce((s, b) => s + b, 0))
  const total = bars.reduce((s, b) => s + b, 0)
  return (
    <svg viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" style={{ width: '100%', height: 46 }} role="img" aria-label={`Código de barras da chave ${value}`}>
      {bars.map((w, i) => (i % 2 === 0 ? <rect key={i} x={starts[i]} y={0} width={w} height={40} fill="#000" /> : null))}
    </svg>
  )
}

function Dacte({ xml }: { xml: Document }) {
  const inf = first(xml, 'infCte')
  const ide = first(inf, 'ide')
  const emit = first(inf, 'emit')
  const ender = first(emit, 'enderEmit')
  const key = (inf?.getAttribute('Id') ?? '').replace(/^CTe/, '')
  const prot = first(xml, 'infProt')
  const toma3 = first(ide, 'toma3') ?? first(ide, 'toma03')
  const toma4 = first(ide, 'toma4') ?? first(ide, 'toma04')
  const tomaCode = toma3 ? txt(toma3, 'toma') : toma4 ? '4' : ''
  const parties: Record<string, Element | null> = { '0': first(inf, 'rem'), '1': first(inf, 'exped'), '2': first(inf, 'receb'), '3': first(inf, 'dest'), '4': toma4 }
  const tomaAddr: Record<string, string> = { '0': 'enderReme', '1': 'enderExped', '2': 'enderReceb', '3': 'enderDest', '4': 'enderToma' }
  const vPrest = first(inf, 'vPrest')
  const comps = all(vPrest, 'Comp')
  const infCarga = first(inf, 'infCarga')
  const quants = all(infCarga, 'infQ')
  const icms = first(first(inf, 'imp'), 'ICMS')
  const icmsGroup = icms?.firstElementChild ?? null
  const nfes = all(inf, 'infNFe').map((n) => txt(n, 'chave'))
  const others = all(inf, 'infOutros').map((o) => [txt(o, 'descOutros') || 'Outros', txt(o, 'nDoc'), money(txt(o, 'vDocFisc'))].filter(Boolean).join(' · '))
  const obs = txt(first(inf, 'compl'), 'xObs')
  const fisco = all(first(inf, 'compl'), 'ObsFisco').map((o) => `${txt(o, 'xCampo')}: ${txt(o, 'xTexto')}`)
  const cancelled = !!txt(xml, 'tpEvento') && txt(xml, 'tpEvento') === '110111'
  return (
    <div className="dacte">
      <div className="dacte-grid dacte-head">
        <div className="dacte-box">
          <div className="dacte-strong dacte-big">{txt(emit, 'xNome')}</div>
          {txt(emit, 'xFant') && <div>{txt(emit, 'xFant')}</div>}
          <div>{[txt(ender, 'xLgr'), txt(ender, 'nro'), txt(ender, 'xBairro')].filter(Boolean).join(', ')}</div>
          <div>
            {txt(ender, 'xMun')} / {txt(ender, 'UF')} · CEP {cep(txt(ender, 'CEP'))}
            {txt(ender, 'fone') && ` · Fone ${txt(ender, 'fone')}`}
          </div>
          <div>
            CNPJ {doc(txt(emit, 'CNPJ'))} · IE {txt(emit, 'IE')}
          </div>
        </div>
        <div className="dacte-box dacte-center">
          <div className="dacte-strong dacte-big">DACTE</div>
          <div>Documento Auxiliar do Conhecimento de Transporte Eletrônico</div>
          <div className="dacte-row3">
            <span>Modal: {MODAL[txt(ide, 'modal')] ?? txt(ide, 'modal')}</span>
            <span>Modelo {txt(ide, 'mod')}</span>
            <span>Série {txt(ide, 'serie')}</span>
            <span className="dacte-strong">Nº {txt(ide, 'nCT')}</span>
          </div>
          <div>Emissão: {when(txt(ide, 'dhEmi'))}</div>
        </div>
      </div>
      <div className="dacte-box">
        <Barcode value={key} />
        <div className="dacte-label">Chave de acesso</div>
        <div className="dacte-strong dacte-mono">{key.replace(/(\d{4})(?=\d)/g, '$1 ')}</div>
        <div>
          Protocolo de autorização: {txt(prot, 'nProt') || '—'} {txt(prot, 'dhRecbto') && `· ${when(txt(prot, 'dhRecbto'))}`}
        </div>
        <div className="dacte-muted">Consulta de autenticidade no portal nacional do CT-e: www.cte.fazenda.gov.br/portal</div>
      </div>
      {cancelled && <div className="dacte-box dacte-strong">CT-e CANCELADO</div>}
      <div className="dacte-grid dacte-4">
        <div className="dacte-box">
          <div className="dacte-label">Tipo do CT-e</div>
          {TIPO[txt(ide, 'tpCTe')] ?? txt(ide, 'tpCTe')}
        </div>
        <div className="dacte-box">
          <div className="dacte-label">Tipo do serviço</div>
          {SERV[txt(ide, 'tpServ')] ?? txt(ide, 'tpServ')}
        </div>
        <div className="dacte-box">
          <div className="dacte-label">Tomador do serviço</div>
          {TOMA[tomaCode] ?? '—'}
        </div>
        <div className="dacte-box">
          <div className="dacte-label">Forma de pagamento</div>
          {txt(ide, 'forPag') === '0' ? 'Pago' : txt(ide, 'forPag') === '1' ? 'A pagar' : txt(ide, 'forPag') === '2' ? 'Outros' : '—'}
        </div>
      </div>
      <div className="dacte-box">
        <div className="dacte-label">CFOP · natureza da operação</div>
        {txt(ide, 'CFOP')} · {txt(ide, 'natOp')}
      </div>
      <div className="dacte-grid dacte-2">
        <div className="dacte-box">
          <div className="dacte-label">Início da prestação</div>
          {txt(ide, 'xMunIni')} / {txt(ide, 'UFIni')}
        </div>
        <div className="dacte-box">
          <div className="dacte-label">Término da prestação</div>
          {txt(ide, 'xMunFim')} / {txt(ide, 'UFFim')}
        </div>
      </div>
      <div className="dacte-grid dacte-2">
        <Party title="Remetente" el={parties['0']!} addrTag="enderReme" />
        <Party title="Destinatário" el={parties['3']!} addrTag="enderDest" />
        <Party title="Expedidor" el={parties['1']!} addrTag="enderExped" />
        <Party title="Recebedor" el={parties['2']!} addrTag="enderReceb" />
      </div>
      <Party title="Tomador do serviço" el={parties[tomaCode] ?? null} addrTag={tomaAddr[tomaCode] ?? 'enderToma'} />
      <div className="dacte-grid dacte-3">
        <div className="dacte-box">
          <div className="dacte-label">Produto predominante</div>
          {txt(infCarga, 'proPred') || '—'}
        </div>
        <div className="dacte-box">
          <div className="dacte-label">Outras características</div>
          {txt(infCarga, 'xOutCat') || '—'}
        </div>
        <div className="dacte-box">
          <div className="dacte-label">Valor total da carga</div>
          R$ {money(txt(infCarga, 'vCarga'))}
        </div>
      </div>
      <div className="dacte-box">
        <div className="dacte-label">Quantidades</div>
        {quants.length ? quants.map((q, i) => <span key={i} className="dacte-chip">{txt(q, 'tpMed') || 'Quantidade'}: {Number(txt(q, 'qCarga')).toLocaleString('pt-BR')} {UNID[txt(q, 'cUnid')] ?? txt(q, 'cUnid')}</span>) : '—'}
      </div>
      <div className="dacte-box">
        <div className="dacte-label">Componentes do valor da prestação do serviço</div>
        <div className="dacte-comps">
          {comps.map((c, i) => (
            <div key={i}>
              <span>{txt(c, 'xNome')}</span>
              <span>R$ {money(txt(c, 'vComp'))}</span>
            </div>
          ))}
        </div>
        <div className="dacte-row3 dacte-strong">
          <span>Valor total do serviço: R$ {money(txt(vPrest, 'vTPrest'))}</span>
          <span>Valor a receber: R$ {money(txt(vPrest, 'vRec'))}</span>
        </div>
      </div>
      <div className="dacte-box">
        <div className="dacte-label">Informações relativas ao imposto</div>
        <div className="dacte-row3">
          <span>Situação tributária: {txt(icmsGroup, 'CST') || icmsGroup?.localName || '—'}</span>
          <span>Base de cálculo: R$ {money(txt(icmsGroup, 'vBC'))}</span>
          <span>Alíquota: {txt(icmsGroup, 'pICMS') ? `${Number(txt(icmsGroup, 'pICMS')).toLocaleString('pt-BR')}%` : '—'}</span>
          <span>Valor do ICMS: R$ {money(txt(icmsGroup, 'vICMS'))}</span>
          {txt(icmsGroup, 'pRedBC') && <span>Redução da base: {txt(icmsGroup, 'pRedBC')}%</span>}
        </div>
      </div>
      <div className="dacte-box">
        <div className="dacte-label">Documentos originários</div>
        {nfes.length || others.length ? (
          <div className="dacte-docs">
            {nfes.map((k) => (
              <div key={k} className="dacte-mono">
                NF-e {k.replace(/(\d{4})(?=\d)/g, '$1 ')}
              </div>
            ))}
            {others.map((o, i) => (
              <div key={i}>{o}</div>
            ))}
          </div>
        ) : (
          '—'
        )}
      </div>
      {(obs || fisco.length > 0) && (
        <div className="dacte-box">
          <div className="dacte-label">Observações</div>
          {obs && <div>{obs}</div>}
          {fisco.map((f, i) => (
            <div key={i}>{f}</div>
          ))}
        </div>
      )}
      <div className="dacte-muted dacte-foot">Impresso pelo CRM a partir do XML do CT-e autorizado.</div>
    </div>
  )
}

const CSS = `
.dacte-root { position: fixed; inset: 0; z-index: 60; overflow: auto; background: #e5e7eb; }
.dacte-bar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #fff; border-bottom: 1px solid #d1d5db; }
.dacte { width: 194mm; margin: 12px auto; background: #fff; color: #000; padding: 6mm; font: 9px/1.35 Arial, Helvetica, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
.dacte-box { border: 1px solid #000; padding: 3px 5px; margin: -1px 0 0 0; }
.dacte-grid { display: grid; }
.dacte-grid > .dacte-box { margin-left: -1px; }
.dacte-head { grid-template-columns: 1.3fr 1fr; }
.dacte-2 { grid-template-columns: 1fr 1fr; }
.dacte-3 { grid-template-columns: 1.4fr 1.4fr 1fr; }
.dacte-4 { grid-template-columns: repeat(4, 1fr); }
.dacte-label { font-size: 7px; text-transform: uppercase; color: #333; margin-bottom: 1px; }
.dacte-strong { font-weight: 700; }
.dacte-big { font-size: 12px; }
.dacte-center { text-align: center; }
.dacte-mono { font-family: 'Courier New', monospace; letter-spacing: .3px; }
.dacte-muted { color: #555; }
.dacte-row3 { display: flex; flex-wrap: wrap; gap: 4px 14px; justify-content: space-between; }
.dacte-center .dacte-row3 { justify-content: center; margin: 3px 0; }
.dacte-comps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px 14px; margin-bottom: 3px; }
.dacte-comps > div { display: flex; justify-content: space-between; border-bottom: 1px dotted #999; }
.dacte-chip { display: inline-block; margin-right: 14px; }
.dacte-docs { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 14px; }
.dacte-foot { margin-top: 4px; font-size: 7px; text-align: right; }
@media print {
  @page { size: A4; margin: 8mm; }
  body > *:not(.dacte-root) { display: none !important; }
  .dacte-root { position: static; background: #fff; overflow: visible; }
  .dacte-bar { display: none; }
  .dacte { margin: 0; box-shadow: none; padding: 0; width: auto; }
}
`

/** DACTE para imprimir ou salvar em PDF (pelo navegador), montado do XML guardado do CT-e. */
export function FretesCteDactePage() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['fretes', 'cte-xml', id], queryFn: () => fetchXml(id!), enabled: !!id, retry: false })
  const number = txt(q.data, 'nCT')
  useEffect(() => {
    if (!q.data) return
    const before = document.title
    document.title = `DACTE ${number}`
    const t = setTimeout(() => window.print(), 600)
    return () => {
      clearTimeout(t)
      document.title = before
    }
  }, [q.data, number])
  return (
    <RequirePermission module="fretes_cte" action="export">
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        createPortal(
          <div className="dacte-root">
            <style>{CSS}</style>
            <div className="dacte-bar">
              <Button onClick={() => window.print()}>
                <PrinterIcon aria-hidden /> Imprimir ou salvar em PDF
              </Button>
              <Button variant="outline" onClick={() => window.close()}>
                Fechar
              </Button>
            </div>
            <Dacte xml={q.data} />
          </div>,
          document.body,
        )
      )}
    </RequirePermission>
  )
}
