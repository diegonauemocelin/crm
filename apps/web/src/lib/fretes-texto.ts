/** Texto para pedir cotação às transportadoras sem tabela (WhatsApp), no formato que a expedição já usa. */
export interface CarrierTextInput {
  senderDoc: string | null
  senderName: string | null
  seller?: string | null
  quoteNumber?: string | null
  recipientDoc: string | null
  cargoValue: number | null
  payer?: 'CIF' | 'FOB'
  volumes: { quantity: number; weight: number; length: number; width: number; height: number }[]
  totalWeight?: number | null
  destZip: string | null
  destCity: string | null
  destUf: string | null
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
const fmtDoc = (s: string | null | undefined) => {
  const d = digits(s)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return s?.trim() || '—'
}
const n = (v: number, dec = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: dec })

export function carrierQuoteText(d: CarrierTextInput) {
  const vols = d.volumes.filter((v) => v.quantity > 0 && (v.length || v.width || v.height || v.weight))
  const count = vols.reduce((s, v) => s + v.quantity, 0)
  const dims = vols.flatMap((v) => Array.from({ length: Math.min(v.quantity, 20) }, () => `${n(v.length, 1)} x ${n(v.width, 1)} x ${n(v.height, 1)}`))
  const weight = d.totalWeight && d.totalWeight > 0 ? d.totalWeight : vols.reduce((s, v) => s + v.quantity * v.weight, 0)
  const extra = [d.seller && `Vendedor ${d.seller}`, d.quoteNumber && `Orçamento ${d.quoteNumber}`].filter(Boolean).join(' · ')
  const zip = digits(d.destZip)
  return [
    `✅ CNPJ/CPF do REMETENTE: ${fmtDoc(d.senderDoc)} ${d.senderName ?? ''}${extra ? ` (${extra})` : ''}`.trim(),
    `✅ DESTINATÁRIO CNPJ/CPF: ${fmtDoc(d.recipientDoc)}`,
    `✅ Valor da nota fiscal: ${d.cargoValue !== null ? `R$ ${d.cargoValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}`,
    `✅ Tomador do frete: ${d.payer ?? 'CIF'}`,
    `✅ Quantidade de volumes: ${count || '—'}`,
    `✅ Medida e peso: ${dims.length ? dims.join(' / ') : '—'} - ${weight > 0 ? `${n(weight, 3)} kg` : '—'}`,
    `✅ CEP DE DESTINO: ${zip.length === 8 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : '—'}${d.destCity ? ` ${d.destCity}${d.destUf ? ` - ${d.destUf}` : ''}` : ''}`,
  ].join('\n')
}
