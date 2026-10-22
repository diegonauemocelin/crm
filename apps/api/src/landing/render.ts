/**
 * Landing page em HTML: rápida (sem framework, CSS próprio), pensada primeiro para o celular e no padrão visual
 * do shadcn/ui (cartões com borda fina, sombras leves, tipografia firme). Função pura (testada em test/landing.spec.ts).
 */
import type { Block, Seo, Theme } from './blocos'
import { ICONS } from './blocos'

export interface LpField {
  key: string
  label: string
  required: boolean
  type?: string
  options?: string[]
}

export interface RenderInput {
  page: { id: string; name: string; slug: string; theme: Theme; blocks: Block[]; seo: Seo }
  variant: 'A' | 'B'
  brand: { name: string; logoUrl: string | null; companyInfo: string; privacyUrl: string | null }
  /** Formulários de captura usados na página (campos, botão, mensagem e consentimento). */
  forms: Record<string, { fields: LpField[]; submitLabel: string; successMessage: string; consentText: string | null }>
  /** Botões de WhatsApp da captura (pedem nome e WhatsApp antes). */
  whatsapps: Record<string, { fields: LpField[]; buttonText: string }>
  tracking: { ga4: string | null; pixel: string | null; ads: { tagId: string; formSendTo: string; whatsappSendTo: string } | null; crmScript: string | null; cookieText: string }
  /** Endereço público da página (canonical e compartilhamento). */
  url: string
  /** Prévia no editor: sem scripts, links desligados. */
  preview?: boolean
  now?: number
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
const txt = (b: Record<string, unknown>, k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '')
/** Texto com quebras: parágrafos separados por linha em branco, quebra simples vira <br>. */
const paras = (s: string, cls = '') =>
  s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ''}>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Texto legível (preto ou branco) sobre a cor. */
export const onColor = (hex: string) => (luminance(hex) > 0.4 ? '#0f172a' : '#ffffff')

const icon = (name: string, size = 22) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ICONS[name] ?? ICONS.check!).svg}</svg>`
const WA_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.8h-.01a9.8 9.8 0 0 1-5-1.37l-.36-.21-3.72.98 1-3.63-.24-.37a9.82 9.82 0 0 1-1.5-5.22c0-5.43 4.42-9.85 9.86-9.85a9.8 9.8 0 0 1 6.96 2.89 9.78 9.78 0 0 1 2.88 6.97c0 5.43-4.42 9.84-9.85 9.84zm8.39-18.23A11.78 11.78 0 0 0 12.05 0C5.5 0 .17 5.33.16 11.88c0 2.1.55 4.14 1.59 5.94L.06 24l6.31-1.65a11.86 11.86 0 0 0 5.67 1.45h.01c6.55 0 11.88-5.33 11.89-11.88a11.82 11.82 0 0 0-3.5-8.4z"/></svg>'

function waLink(phone: string, message: string) {
  const digits = phone.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}` : ''
}

export function renderLanding(x: RenderInput): string {
  const t = x.page.theme
  const blocks = x.page.blocks
  const hasForm = blocks.some((b) => b.type === 'formulario' && txt(b, 'formId'))
  const hasWaBlock = blocks.some((b) => b.type === 'whatsapp')
  const waMessage = t.whatsappMessage.replace(/\{pagina\}/g, x.page.name)
  const waDirect = waLink(t.whatsapp, waMessage)
  /** Destino de um botão: formulário da página, WhatsApp ou endereço. */
  const target = (action: string, url: string): { href: string; wa: boolean } => {
    if (action === 'link' && url) return { href: url, wa: false }
    if (action === 'whatsapp') return waDirect ? { href: waDirect, wa: true } : { href: hasWaBlock ? '#whatsapp' : '#formulario', wa: false }
    return { href: hasForm ? '#formulario' : waDirect || '#whatsapp', wa: !hasForm && !!waDirect }
  }
  const button = (label: string, action: string, url: string, cls = '') => {
    if (!label) return ''
    const d = target(action, url)
    const ext = /^https?:/.test(d.href)
    return `<a class="btn ${cls}" href="${esc(d.href)}"${ext ? ' target="_blank" rel="noopener"' : ''} ${d.wa ? 'data-lp-wa' : 'data-lp-cta'}>${d.wa ? WA_ICON : ''}${esc(label)}</a>`
  }
  // Sem imagem: na prévia aparece um espaço indicando onde ela entra; publicada, a página se ajusta sem ela.
  const img = (src: string, alt: string, cls = '') => (src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">` : x.preview ? '<div class="ph">Adicione uma imagem</div>' : '')
  let formAnchor = false

  const fieldHtml = (f: LpField, scope: string) => {
    const id = `${scope}-${f.key.replace(/[^a-z0-9]/gi, '')}`
    const req = f.required ? ' required' : ''
    const label = `<label for="${id}">${esc(f.label)}${f.required ? ' <span aria-hidden="true">*</span>' : ''}</label>`
    const type = f.type ?? (f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : f.key === 'message' ? 'textarea' : f.key === 'state' ? 'uf' : 'text')
    let input: string
    if (type === 'textarea') input = `<textarea id="${id}" name="${esc(f.key)}" rows="3"${req}></textarea>`
    else if (type === 'uf' || f.options?.length) {
      const opts = type === 'uf' ? UFS : (f.options ?? [])
      input = `<select id="${id}" name="${esc(f.key)}"${req}><option value="">Selecione</option>${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
    } else input = `<input id="${id}" name="${esc(f.key)}" type="${type === 'email' ? 'email' : type === 'tel' ? 'tel' : type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}"${type === 'tel' ? ' inputmode="tel" autocomplete="tel"' : type === 'email' ? ' autocomplete="email"' : f.key === 'name' ? ' autocomplete="name"' : ''}${req}>`
    return `<div class="fld${type === 'textarea' ? ' full' : ''}">${label}${input}<small class="err" data-err="${esc(f.key)}"></small></div>`
  }
  const formHtml = (kind: 'form' | 'whatsapp', id: string, fields: LpField[], submit: string, consent: string | null) => {
    const scope = `${kind}-${id.slice(0, 8)}`
    return `<form class="lp-form" data-lp-form data-kind="${kind}" data-id="${esc(id)}" novalidate>
<div class="grid-f">${fields.map((f) => fieldHtml(f, scope)).join('')}</div>
<div class="hp" aria-hidden="true"><label>Não preencha<input name="_hp" tabindex="-1" autocomplete="off"></label></div>
${consent ? `<label class="consent"><input type="checkbox" name="_consent"> <span>${esc(consent)}${x.brand.privacyUrl ? ` <a href="${esc(x.brand.privacyUrl)}" target="_blank" rel="noopener">Política de privacidade</a>` : ''}</span></label>` : ''}
<button class="btn full" type="submit">${kind === 'whatsapp' ? WA_ICON : ''}${esc(submit)}</button>
<p class="msg" role="status" aria-live="polite"></p>
</form>`
  }

  const section = (b: Block, inner: string, extraCls = '', id = '') => `<section${id ? ` id="${id}"` : ''} class="s bg-${b.background ?? 'padrao'} ${extraCls}" data-block="${esc(b.id)}">${inner}</section>`
  const head = (b: Block, center = true) => {
    const title = txt(b, 'title')
    const sub = txt(b, 'subtitle')
    return title || sub ? `<div class="head${center ? ' center' : ''}">${title ? `<h2>${esc(title)}</h2>` : ''}${sub ? paras(sub, 'lead') : ''}</div>` : ''
  }
  const list = (b: Block) => (Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [])

  const render = (b: Block): string => {
    switch (b.type) {
      case 'hero': {
        const v = b.variant ?? 'imagem-direita'
        const text = `${txt(b, 'eyebrow') ? `<span class="eyebrow">${esc(txt(b, 'eyebrow'))}</span>` : ''}<h1>${esc(txt(b, 'title'))}</h1>${paras(txt(b, 'subtitle'), 'lead')}<div class="actions">${button(txt(b, 'ctaText'), txt(b, 'action'), txt(b, 'url'), 'lg')}</div>${txt(b, 'note') ? `<p class="note">${icon('check', 16)} ${esc(txt(b, 'note'))}</p>` : ''}`
        if (v === 'imagem-fundo') {
          const bg = txt(b, 'image')
          return `<section class="s hero hero-bg" data-block="${esc(b.id)}"${bg ? ` style="background-image:linear-gradient(90deg,rgba(2,6,23,.86),rgba(2,6,23,.45)),url('${esc(bg)}')"` : ''}><div class="c"><div class="hero-text">${text}</div></div></section>`
        }
        if (v === 'centro') return section(b, `<div class="c center narrow">${text}</div>${txt(b, 'image') ? `<div class="c"><div class="hero-media wide">${img(txt(b, 'image'), txt(b, 'title'))}</div></div>` : ''}`, 'hero')
        if (!txt(b, 'image') && !x.preview) return section(b, `<div class="c center narrow">${text}</div>`, 'hero')
        return section(b, `<div class="c split"><div class="hero-text">${text}</div><div class="hero-media">${img(txt(b, 'image'), txt(b, 'title'))}</div></div>`, 'hero')
      }
      case 'numeros':
        return section(b, `<div class="c"><div class="stats">${list(b).map((i) => `<div class="stat"><strong>${esc(i.value)}</strong><span>${esc(i.label)}</span></div>`).join('')}</div></div>`, 'tight')
      case 'beneficios': {
        const items = list(b)
        if (b.variant === 'lista')
          return section(b, `<div class="c">${head(b)}<ul class="checks cols">${items.map((i) => `<li><span class="ic">${icon(String(i.icon), 18)}</span><div><strong>${esc(i.title)}</strong>${i.text ? `<p>${esc(i.text)}</p>` : ''}</div></li>`).join('')}</ul></div>`)
        const cols = items.length <= 3 ? Math.max(items.length, 1) : items.length === 4 ? 4 : 3
        return section(b, `<div class="c">${head(b)}<div class="cards g${cols}">${items.map((i) => `<div class="card"><span class="ic">${icon(String(i.icon))}</span><h3>${esc(i.title)}</h3>${i.text ? `<p>${esc(i.text)}</p>` : ''}</div>`).join('')}</div></div>`)
      }
      case 'imagem-texto': {
        const left = b.variant === 'imagem-esquerda'
        const media = txt(b, 'image') || x.preview ? `<div class="media">${img(txt(b, 'image'), txt(b, 'title'))}</div>` : ''
        const text = `<div>${txt(b, 'title') ? `<h2>${esc(txt(b, 'title'))}</h2>` : ''}${paras(txt(b, 'text'))}<div class="actions">${button(txt(b, 'ctaText'), txt(b, 'action'), txt(b, 'url'))}</div></div>`
        return section(b, `<div class="c split">${left ? media + text : text + media}</div>`)
      }
      case 'produtos':
        return section(
          b,
          `<div class="c">${head(b)}<div class="cards g3 products">${list(b)
            .map((i) => {
              const label = txt(i as Block, 'ctaText') || 'Quero este'
              const href = txt(i as Block, 'url')
              return `<div class="card prod">${i.image ? `<div class="pimg">${img(String(i.image), String(i.name))}</div>` : ''}<h3>${esc(i.name)}</h3>${i.text ? `<p>${esc(i.text)}</p>` : ''}${i.price ? `<p class="price">${esc(i.price)}</p>` : ''}${button(label, href ? 'link' : 'formulario', href, 'outline full')}</div>`
            })
            .join('')}</div></div>`,
        )
      case 'marcas':
        return section(b, `<div class="c">${head(b)}<div class="brands">${list(b).map((i) => (i.image ? `<span class="logo">${img(String(i.image), String(i.name))}</span>` : `<span class="chip">${esc(i.name)}</span>`)).join('')}</div></div>`, 'tight')
      case 'depoimentos':
        return section(b, `<div class="c">${head(b)}<div class="cards g3">${list(b).map((i) => `<figure class="card quote"><blockquote>“${esc(i.text)}”</blockquote><figcaption><strong>${esc(i.name)}</strong>${i.role ? `<span>${esc(i.role)}</span>` : ''}</figcaption></figure>`).join('')}</div></div>`)
      case 'oferta': {
        const ends = txt(b, 'endsAt')
        const endMs = ends ? Date.parse(`${ends}:00-03:00`) : NaN
        const live = Number.isFinite(endMs) && endMs > (x.now ?? Date.now())
        const box = (k: string, l: string) => `<div><strong data-k="${k}">--</strong><span>${l}</span></div>`
        return section(b, `<div class="c"><div class="offer"><div><h2>${esc(txt(b, 'title'))}</h2>${paras(txt(b, 'text'))}</div>${live ? `<div class="count" data-lp-ate="${endMs}" aria-label="Tempo até o fim da oferta">${box('d', 'dias')}${box('h', 'horas')}${box('m', 'min')}${box('s', 'seg')}</div>` : ''}<div class="actions">${button(txt(b, 'ctaText'), txt(b, 'action'), txt(b, 'url'), 'lg')}</div></div></div>`)
      }
      case 'galeria':
        return section(b, `<div class="c">${head(b)}<div class="gallery">${list(b).filter((i) => i.image || x.preview).map((i) => `<figure>${img(String(i.image), String(i.caption || ''))}${i.caption ? `<figcaption>${esc(i.caption)}</figcaption>` : ''}</figure>`).join('')}</div></div>`)
      case 'video': {
        const id = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(txt(b, 'url'))?.[1]
        return section(b, `<div class="c narrow">${head(b)}${id ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(txt(b, 'title') || 'Vídeo')}" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : ''}</div>`)
      }
      case 'faq':
        return section(b, `<div class="c narrow">${head(b)}<div class="faq">${list(b).map((i) => `<details><summary>${esc(i.q)}</summary>${paras(String(i.a ?? ''))}</details>`).join('')}</div></div>`)
      case 'formulario': {
        const form = x.forms[txt(b, 'formId')]
        const id = !formAnchor ? 'formulario' : ''
        formAnchor = true
        const bullets = txt(b, 'bullets')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
        const formBox = form ? `<div class="card form-card">${formHtml('form', txt(b, 'formId'), form.fields, form.submitLabel || 'Enviar', form.consentText)}<div class="ok" hidden>${icon('check', 28)}<p>${esc(form.successMessage || 'Recebemos seus dados. Em breve entraremos em contato.')}</p></div></div>` : '<div class="card form-card"><p class="muted">Escolha um formulário de captura para este bloco.</p></div>'
        const text = `<div>${txt(b, 'title') ? `<h2>${esc(txt(b, 'title'))}</h2>` : ''}${paras(txt(b, 'text'), 'lead')}${bullets.length ? `<ul class="checks">${bullets.map((s) => `<li><span class="ic">${icon('check', 16)}</span><div>${esc(s)}</div></li>`).join('')}</ul>` : ''}</div>`
        return section(b, b.variant === 'cartao' ? `<div class="c narrow center-form">${text}${formBox}</div>` : `<div class="c split form-split">${text}${formBox}</div>`, '', id)
      }
      case 'whatsapp': {
        const capture = b.mode === 'captura' ? x.whatsapps[txt(b, 'whatsappId')] : null
        const label = txt(b, 'buttonText') || 'Chamar no WhatsApp'
        const action = capture
          ? `<div class="card form-card wa-card">${formHtml('whatsapp', txt(b, 'whatsappId'), capture.fields, label, null)}</div>`
          : waDirect
            ? `<a class="btn wa lg" href="${esc(waDirect)}" target="_blank" rel="noopener" data-lp-wa>${WA_ICON}${esc(label)}</a>`
            : '<p class="muted">Informe o WhatsApp da página (Tema › WhatsApp) para o botão funcionar.</p>'
        return section(b, `<div class="c narrow center">${txt(b, 'title') ? `<h2>${esc(txt(b, 'title'))}</h2>` : ''}${paras(txt(b, 'text'), 'lead')}<div class="actions">${action}</div></div>`, '', hasWaBlock && !blocks.slice(0, blocks.indexOf(b)).some((y) => y.type === 'whatsapp') ? 'whatsapp' : '')
      }
      case 'cta':
        return section(b, `<div class="c narrow center"><h2 class="big">${esc(txt(b, 'title'))}</h2>${paras(txt(b, 'text'), 'lead')}<div class="actions">${button(txt(b, 'ctaText'), txt(b, 'action'), txt(b, 'url'), 'lg')}</div></div>`)
      case 'texto':
        return section(b, `<div class="c narrow prose">${txt(b, 'title') ? `<h2>${esc(txt(b, 'title'))}</h2>` : ''}${paras(txt(b, 'text'))}</div>`)
      default:
        return ''
    }
  }

  const body = blocks.map(render).join('\n')
  const headerCta = t.header === 'logo-botao' && t.headerCta ? button(t.headerCta, hasForm ? 'formulario' : 'whatsapp', '', 'sm') : ''
  const header =
    t.header === 'nenhum'
      ? ''
      : `<header class="top"><div class="c bar"><span class="brand">${x.brand.logoUrl ? `<img src="${esc(x.brand.logoUrl)}" alt="${esc(x.brand.name)}">` : `<strong>${esc(x.brand.name)}</strong>`}</span>${headerCta}</div></header>`
  const year = new Date(x.now ?? Date.now()).getFullYear()
  const footer = `<footer class="foot"><div class="c"><strong>${esc(x.brand.name)}</strong>${x.brand.companyInfo ? `<span>${esc(x.brand.companyInfo)}</span>` : ''}<span>© ${year} ${esc(x.brand.name)}${x.brand.privacyUrl ? ` · <a href="${esc(x.brand.privacyUrl)}" target="_blank" rel="noopener">Política de privacidade</a>` : ''}</span></div></footer>`

  const title = x.page.seo.title || x.page.name
  const desc = x.page.seo.description
  const font = t.font === 'Sistema' ? null : t.font
  const cfg = {
    p: x.page.id,
    x: x.variant,
    ga4: x.tracking.ga4,
    px: x.tracking.pixel,
    ads: x.tracking.ads,
    ck: x.tracking.cookieText,
    pv: x.brand.privacyUrl,
  }
  const tracked = !x.preview
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">` : ''}
${x.page.seo.noindex || x.preview ? '<meta name="robots" content="noindex,nofollow">' : ''}
<link rel="canonical" href="${esc(x.url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}<meta property="og:url" content="${esc(x.url)}">${x.page.seo.image ? `<meta property="og:image" content="${esc(x.page.seo.image)}">` : ''}
<meta name="theme-color" content="${t.primary}">
${font ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;600;700;800&display=swap">` : ''}
<style>${css(t, font)}${x.preview ? 'a,button,input,select,textarea,summary{pointer-events:none}' : ''}</style>
</head>
<body>
${header}
<main>
${body}
</main>
${footer}
${tracked ? `<script id="lp-cfg" type="application/json">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>\n<script src="/api/public/lp/runtime.js" defer></script>${x.tracking.crmScript ? `\n<script async src="${esc(x.tracking.crmScript)}"></script>` : ''}` : ''}
</body>
</html>`
}

function css(t: Theme, font: string | null) {
  const dark = t.mode === 'escuro'
  const r = t.radius === 'reto' ? 4 : t.radius === 'arredondado' ? 18 : 10
  const pill = t.button === 'pilula' ? '999px' : `${r}px`
  const bg = dark ? '#0b1220' : '#ffffff'
  const fg = dark ? '#e5e7eb' : '#0f172a'
  const muted = dark ? '#94a3b8' : '#475569'
  const card = dark ? '#111a2e' : '#ffffff'
  const border = dark ? 'rgba(255,255,255,.09)' : '#e2e8f0'
  const onP = onColor(t.primary)
  const onA = onColor(t.accent)
  const family = font ? `'${font}',` : ''
  return `
*,*::before,*::after{box-sizing:border-box}
:root{--p:${t.primary};--a:${t.accent};--on-p:${onP};--on-a:${onA};--bg:${bg};--fg:${fg};--muted:${muted};--card:${card};--bd:${border};--r:${r}px;--rb:${pill}}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ${family}system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
a{color:var(--a)}
h1,h2,h3{line-height:1.12;margin:0 0 .5em;letter-spacing:-.02em;font-weight:800}
h1{font-size:clamp(2.1rem,4.6vw,3.4rem)}
h2{font-size:clamp(1.6rem,3vw,2.35rem);font-weight:750}
h2.big{font-size:clamp(1.9rem,3.6vw,2.8rem)}
h3{font-size:1.1rem;font-weight:650;letter-spacing:-.01em}
p{margin:0 0 1em}
.c{width:100%;max-width:${t.width === 'larga' ? 1280 : 1120}px;margin:0 auto;padding:0 20px}
.narrow{max-width:780px}
.center{text-align:center}
.center .actions,.center .lead{justify-content:center;margin-left:auto;margin-right:auto}
.s{padding:84px 0}
.s.tight{padding:48px 0}
.bg-suave{background:color-mix(in srgb,var(--p) ${dark ? 14 : 6}%,var(--bg))}
.bg-destaque{background:var(--p);color:var(--on-p)}
.bg-escuro{background:#0b1220;color:#f1f5f9}
.bg-destaque .lead,.bg-destaque p,.bg-escuro .lead,.bg-escuro p{color:inherit;opacity:.9}
.bg-destaque .btn:not(.wa){background:var(--on-p);color:var(--p);border-color:var(--on-p)}
.bg-destaque .card,.bg-escuro .card{color:var(--fg)}
.bg-destaque .card p,.bg-escuro .card p{color:var(--muted);opacity:1}
.lead{font-size:1.125rem;color:var(--muted);max-width:62ch}
.muted{color:var(--muted)}
.head{margin-bottom:40px}
.head.center .lead{margin-left:auto;margin-right:auto}
.eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:650;letter-spacing:.02em;padding:6px 12px;border-radius:999px;background:color-mix(in srgb,var(--p) 12%,transparent);color:var(--p);margin-bottom:18px}
.bg-destaque .eyebrow,.hero-bg .eyebrow{background:rgba(255,255,255,.16);color:inherit}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 24px;font-weight:650;font-size:1rem;line-height:1.2;text-decoration:none;border-radius:var(--rb);border:2px solid var(--a);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,filter .15s ease;${t.button === 'contorno' ? 'background:transparent;color:var(--a)' : 'background:var(--a);color:var(--on-a)'}}
.btn:hover{transform:translateY(-1px);box-shadow:0 8px 20px -8px color-mix(in srgb,var(--a) 60%,transparent);filter:brightness(1.04)}
.btn:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid color-mix(in srgb,var(--a) 45%,transparent);outline-offset:2px}
.btn.lg{padding:16px 30px;font-size:1.06rem}
.btn.sm{padding:9px 16px;font-size:.92rem}
.btn.outline{background:transparent;color:var(--a)}
.btn.full{width:100%}
.btn.wa{background:#1a8d5f;border-color:#1a8d5f;color:#fff}
.note{display:flex;align-items:center;gap:6px;margin-top:14px;font-size:.92rem;color:var(--muted)}
.note svg{color:var(--p)}
.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.6) blur(10px);border-bottom:1px solid var(--bd)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.brand img{height:38px;width:auto}
.brand strong{font-size:1.15rem}
.split{display:grid;grid-template-columns:1fr;gap:40px;align-items:center}
@media(min-width:900px){.split{grid-template-columns:1.05fr 1fr;gap:64px}}
.hero{padding-top:72px}
.hero-media img,.media img{width:100%;border-radius:calc(var(--r) * 1.6);box-shadow:0 30px 60px -30px rgba(15,23,42,.35);object-fit:cover;aspect-ratio:4/3}
.hero-media.wide{margin-top:48px}
.hero-media.wide img{aspect-ratio:16/7}
.hero-bg{background:#0b1220 center/cover no-repeat;color:#fff;min-height:560px;display:flex;align-items:center}
.hero-bg .lead,.hero-bg .note{color:rgba(255,255,255,.86)}
.hero-bg .note svg{color:#fff}
.hero-text{max-width:640px}
.center .hero-text,.hero.center{margin:0 auto}
.ph{display:grid;place-items:center;aspect-ratio:4/3;border:2px dashed var(--bd);border-radius:calc(var(--r) * 1.4);color:var(--muted);font-size:.9rem;background:color-mix(in srgb,var(--p) 4%,var(--bg))}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;text-align:center}
@media(min-width:760px){.stats{grid-template-columns:repeat(4,1fr)}}
.stat strong{display:block;font-size:clamp(1.9rem,3.6vw,2.6rem);font-weight:800;color:var(--p);letter-spacing:-.02em}
.bg-destaque .stat strong{color:inherit}
.stat span{color:var(--muted);font-size:.95rem}
.bg-destaque .stat span{color:inherit;opacity:.85}
.cards{display:grid;gap:20px;grid-template-columns:1fr}
@media(min-width:640px){.cards.g2,.cards.g3,.cards.g4{grid-template-columns:repeat(2,1fr)}}
@media(min-width:960px){.cards.g3{grid-template-columns:repeat(3,1fr)}.cards.g4{grid-template-columns:repeat(4,1fr)}}
.card{background:var(--card);border:1px solid var(--bd);border-radius:calc(var(--r) * 1.4);padding:26px;box-shadow:0 1px 2px rgba(15,23,42,.04);transition:box-shadow .2s ease,transform .2s ease}
.card:hover{box-shadow:0 18px 40px -24px rgba(15,23,42,.28)}
.card p{color:var(--muted);margin:0}
.ic{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:calc(var(--r) * 1.1);background:color-mix(in srgb,var(--p) 12%,transparent);color:var(--p);margin-bottom:16px;flex-shrink:0}
.checks{list-style:none;padding:0;margin:20px 0 0;display:grid;gap:16px}
.checks.cols{grid-template-columns:1fr}
@media(min-width:760px){.checks.cols{grid-template-columns:1fr 1fr;gap:22px 40px}}
.checks li{display:flex;gap:14px;align-items:flex-start}
.checks .ic{width:30px;height:30px;margin:2px 0 0}
.checks p{margin:2px 0 0;color:var(--muted)}
.prod{display:flex;flex-direction:column;gap:10px}
.prod .btn{margin-top:auto}
.pimg{background:${dark ? '#0f172a' : '#f8fafc'};border-radius:var(--r);overflow:hidden;margin:-8px -8px 6px}
.pimg img{width:100%;aspect-ratio:4/3;object-fit:contain}
.price{font-weight:750;color:var(--p);font-size:1.15rem}
.brands{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}
.chip{padding:10px 18px;border:1px solid var(--bd);border-radius:999px;font-weight:600;background:var(--card);color:var(--fg)}
.logo img{height:42px;width:auto;filter:grayscale(1);opacity:.75;transition:all .2s}
.logo img:hover{filter:none;opacity:1}
.quote blockquote{margin:0 0 18px;font-size:1.02rem;line-height:1.65}
.quote figcaption{display:flex;flex-direction:column;font-size:.95rem}
.quote figcaption span{color:var(--muted)}
.offer{display:grid;gap:28px;align-items:center;border-radius:calc(var(--r) * 1.6);padding:40px;background:linear-gradient(135deg,var(--p),color-mix(in srgb,var(--p) 70%,#000));color:var(--on-p)}
.offer p{opacity:.9}
.offer .btn{background:var(--on-p);color:var(--p);border-color:var(--on-p)}
@media(min-width:960px){.offer{grid-template-columns:1.3fr auto auto}}
.count{display:flex;gap:10px}
.count div{min-width:72px;padding:12px 8px;text-align:center;border-radius:var(--r);background:rgba(255,255,255,.14)}
.count strong{display:block;font-size:1.8rem;font-variant-numeric:tabular-nums;line-height:1.1}
.count span{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;opacity:.85}
.gallery{display:grid;gap:14px;grid-template-columns:repeat(2,1fr)}
@media(min-width:900px){.gallery{grid-template-columns:repeat(3,1fr)}}
.gallery figure{margin:0}
.gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.gallery figcaption{font-size:.88rem;color:var(--muted);margin-top:6px}
.video{position:relative;aspect-ratio:16/9;border-radius:calc(var(--r) * 1.4);overflow:hidden;box-shadow:0 30px 60px -30px rgba(15,23,42,.4)}
.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.faq details{border:1px solid var(--bd);background:var(--card);border-radius:var(--r);padding:0 20px;margin-bottom:10px;color:var(--fg)}
.faq summary{cursor:pointer;font-weight:650;padding:18px 0;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-size:1.3rem;line-height:1;color:var(--p)}
.faq details[open] summary::after{content:'–'}
.faq details p{color:var(--muted)}
.form-split{align-items:start}
.center-form{display:grid;gap:28px;text-align:center}
.center-form .checks{justify-items:center}
.form-card{padding:28px;text-align:left}
.grid-f{display:grid;gap:14px;grid-template-columns:1fr}
@media(min-width:560px){.grid-f{grid-template-columns:1fr 1fr}.fld.full{grid-column:1/-1}}
.fld{display:flex;flex-direction:column;gap:6px}
.fld label{font-size:.9rem;font-weight:600}
.fld label span{color:#dc2626}
input,select,textarea{width:100%;font:inherit;color:var(--fg);background:var(--bg);border:1px solid ${dark ? 'rgba(255,255,255,.18)' : '#cbd5e1'};border-radius:calc(var(--r) * .8);padding:11px 13px;min-height:46px}
textarea{min-height:96px;resize:vertical}
.err{color:#dc2626;font-size:.82rem;min-height:0}
.fld.bad input,.fld.bad select,.fld.bad textarea{border-color:#dc2626}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.consent{display:flex;gap:10px;align-items:flex-start;font-size:.86rem;color:var(--muted);margin:16px 0 4px}
.consent input{width:18px;height:18px;min-height:0;margin-top:2px;flex-shrink:0}
.lp-form .btn{margin-top:16px}
.msg{margin:12px 0 0;font-size:.92rem}
.msg.bad{color:#dc2626}
.ok{text-align:center;padding:12px 0}
.ok svg{color:#16a34a;margin:0 auto 10px}
.wa-card{max-width:560px;margin:0 auto}
.prose p{font-size:1.06rem}
.foot{border-top:1px solid var(--bd);padding:32px 0;font-size:.9rem;color:var(--muted)}
.foot .c{display:flex;flex-direction:column;gap:6px;text-align:center}
.foot strong{color:var(--fg)}
.cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:50;max-width:560px;margin:0 auto;background:var(--card);color:var(--fg);border:1px solid var(--bd);border-radius:calc(var(--r) * 1.2);box-shadow:0 20px 50px -20px rgba(15,23,42,.45);padding:18px;font-size:.9rem}
.cookie p{margin:0 0 12px;color:var(--muted)}
.cookie div{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.cookie .btn{padding:9px 16px;font-size:.9rem}
@media(max-width:640px){.s{padding:60px 0}.hero{padding-top:44px}.offer{padding:28px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn,.card{transition:none}}
`
}
