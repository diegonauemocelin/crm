// E-mails da Fidelidade (convite para avaliar, link de acesso, código): HTML simples com tabelas e estilos inline.

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function emailHtml(
  brand: { appName: string; shortName?: string; brandColor?: string; primaryColor: string; logoUrl?: string | null },
  c: { title: string; body: string; buttonLabel?: string; buttonUrl?: string; footnote?: string },
  baseUrl = '',
) {
  const raw = brand.brandColor || brand.primaryColor
  const color = /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#1d4ed8'
  const paragraphs = c.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<tr><td style="font-size:15px;line-height:22px;padding-bottom:12px">${esc(p).replace(/\n/g, '<br>')}</td></tr>`)
    .join('')
  const button =
    c.buttonLabel && c.buttonUrl
      ? `<tr><td style="padding:12px 0 24px"><a href="${esc(c.buttonUrl)}" style="background:${color};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:600">${esc(c.buttonLabel)}</a></td></tr>`
      : ''
  const logo = brand.logoUrl && baseUrl ? `<tr><td style="padding-bottom:16px"><img src="${esc(baseUrl + brand.logoUrl)}" alt="${esc(brand.shortName || brand.appName)}" style="max-height:48px"></td></tr>` : ''
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px">
${logo}<tr><td style="font-size:20px;font-weight:700;padding-bottom:16px">${esc(c.title)}</td></tr>
${paragraphs}
${button}
${c.footnote ? `<tr><td style="font-size:12px;line-height:18px;color:#6b7280">${esc(c.footnote)}</td></tr>` : ''}
</table>
<p style="font-size:12px;color:#9ca3af;margin-top:16px">${esc(brand.shortName || brand.appName)}</p>
</td></tr></table></body></html>`
}
