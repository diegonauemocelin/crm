/**
 * Modo "Sem IA" (custo zero): responde só com informação aprovada da base (mesma lógica do painel).
 *  - Compatibilidade: "sim" só quando há aplicação CONFIRMADA do anúncio para o modelo citado.
 *  - Dúvidas frequentes: usa a resposta aprovada do conhecimento cuja pergunta for muito parecida.
 *  - Todo o resto é encaminhado para a equipe (nada é inventado).
 */
import type { AiSettings } from './constantes'
import type { AiResult, AssistContext } from './ia'
import { norm, normCode, tokenize } from './texto'

const COMPAT = /\b(serve|servem|compativel|compatibilidade|aplica|aplicacao|encaixa|funciona|cabe|da certo|vale para|usa n[ao])\b/
const COMMERCIAL = /\b(desconto|frete|prazo|entrega|parcel\w*|pix|boleto|nota fiscal|garantia|troca|devolu\w*|estoque|disponive\w*|pronta entrega|preco|valor|quanto (custa|sai|fica)|negocia\w*)\b/
const INTENT = /\b(comprar|compro|quero|preciso|vou levar|fechar|tem\b|teria|consegue)/

const modelKey = (m: unknown) => norm(m).replace(/[^a-z0-9]+/g, '')

function similarity(a: string, b: string) {
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return (2 * inter) / (A.size + B.size)
}

const result = (o: Partial<AiResult>): AiResult => ({
  decision: 'encaminhar',
  answer: '',
  confidence: 0,
  pending_reason: 'G',
  reason_explanation: '',
  found_info: [],
  missing_info: [],
  knowledge_ids_used: [],
  complementary_item_ids: [],
  detected_brand: '',
  detected_model: '',
  detected_part_code: '',
  purchase_intent: false,
  suggested_routing: '',
  ...o,
})

export function generateRules({ settings, context, question, greeting }: { settings: AiSettings; context: AssistContext; question: string; greeting: string }): AiResult {
  const q = norm(question)
  const item = context.anuncio_da_pergunta
  const det = context.dados_detectados ?? { codigos: [], marcas: [], modelos: [] }
  const links = new Set(context.anuncios_com_link_permitido ?? [])
  const itemCodes = [item?.codigo_peca, item?.sku].flatMap((c) => String(c ?? '').split(/[,;]/)).map(normCode).filter(Boolean)
  const hello = settings.greeting_by_time ? greeting : 'Olá!'
  const max = Number(settings.max_answer_chars) || 1200
  const linkLine = item && links.has(item.id) ? `\nConfira os detalhes e realize a compra pelo anúncio: {{LINK:${item.id}}}` : ''
  const base = {
    detected_brand: det.marcas[0] ?? '',
    detected_model: det.modelos[0] ?? '',
    detected_part_code: det.codigos[0] ?? itemCodes[0] ?? '',
    purchase_intent: INTENT.test(q),
  }
  // não repete o link do anúncio se a resposta aprovada já o contém
  const finish = (text: string) => `${hello}\n${text}${item && String(text).includes(`{{LINK:${item.id}}}`) ? '' : linkLine}`.slice(0, max)

  // modelos/códigos escritos na pergunta (ex.: 416E, 320D, 1R-0750)
  const modelTokens = (t: string) => new Set((String(t).toUpperCase().match(/\b[A-Z0-9-]*\d[A-Z0-9-]*\b/g) ?? []).map(normCode).filter((c) => c.length >= 2))
  const qTokens = modelTokens(question)

  /** Conhecimento aprovado com a pergunta mais parecida (respeitando código, modelo e anúncio). */
  function bestKnowledge(min: number) {
    let best: { k: AssistContext['conhecimentos_aprovados'][number]; s: number } | null = null
    for (const k of context.conhecimentos_aprovados ?? []) {
      if (!k.pergunta || !k.resposta_aprovada) continue
      if (k.anuncio_id && k.anuncio_id !== item?.id) continue
      // a resposta aprovada só vale se os modelos/códigos citados forem os mesmos (416E ≠ 320D)
      const kTokens = modelTokens(k.pergunta)
      if ((qTokens.size || kTokens.size) && (qTokens.size !== kTokens.size || [...qTokens].some((x) => !kTokens.has(x)))) continue
      const kCodes = String(k.codigo ?? '').split(/[,;]/).map(normCode).filter(Boolean)
      if (kCodes.length && !kCodes.some((c) => itemCodes.includes(c) || det.codigos.includes(c))) continue
      if (k.modelo && det.modelos.length && !String(k.modelo).split(/[,;/]/).some((m) => det.modelos.map(modelKey).includes(modelKey(m)))) continue
      const s = similarity(question, k.pergunta)
      if (s >= min && (!best || s > best.s)) best = { k, s }
    }
    return best
  }

  // Anúncios da loja que correspondem a TODOS os termos pedidos (título) ou ao código de referência/OEM
  const offers = (context.anuncios_da_loja_encontrados ?? []).filter((o) => o.corresponde_a_todos_os_termos && links.has(o.id)).slice(0, 4)
  const offerFound = () => {
    if (!offers.length) return null
    const lines = offers.map((o) => {
      const byCode = /código/.test(o.encontrado_por) ? ` (${o.encontrado_por.replace('título e ', '')} correspondente)` : ''
      return `• ${o.titulo}${byCode}: {{LINK:${o.id}}}`
    })
    const many = offers.length > 1
    return result({
      ...base,
      decision: 'responder',
      pending_reason: 'nenhum',
      confidence: 0.8,
      answer:
        `${hello}\n${many ? 'Temos estas opções' : 'Temos esta opção'} em nossa loja para o que você procura:\n${lines.join('\n')}\n` +
        `A aplicação indicada está descrita no título de ${many ? 'cada anúncio' : 'anúncio'}. ` +
        `${many ? 'Se tiver dúvida sobre qual escolher, informe o ano da máquina ou o código da peça original que indicamos a opção correta.' : 'Qualquer dúvida, estamos à disposição.'}`,
      reason_explanation: `Sem IA: ${offers.length} anúncio(s) da loja encontrado(s) por título/código de referência/código OEM.`,
      found_info: offers.map((o) => `${o.id}: ${o.titulo} (${o.encontrado_por})`),
    })
  }

  // 0) Pergunta igual ou parecida com uma já respondida e aprovada → usa a mesma resposta
  const exact = bestKnowledge(0.6)
  if (exact) {
    return result({
      ...base,
      decision: 'responder',
      pending_reason: 'nenhum',
      confidence: Math.min(0.95, 0.5 + exact.s / 2),
      answer: finish(exact.k.resposta_aprovada),
      knowledge_ids_used: [exact.k.id],
      reason_explanation: `Sem IA: pergunta igual (${Math.round(exact.s * 100)}%) a uma já respondida, conhecimento #${exact.k.id}.`,
      found_info: [`Conhecimento #${exact.k.id}: ${exact.k.titulo}`],
    })
  }

  // 1) Compatibilidade com um modelo de máquina
  if (COMPAT.test(q)) {
    const asked = det.modelos.map(modelKey)
    // cliente citou algo com cara de modelo (ex.: D6T, 320D) que não está cadastrado na base
    const modelLike = (String(question).toUpperCase().match(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{2,10}\b/g) ?? []).map(normCode).filter((t) => t && !itemCodes.includes(t))
    if (!asked.length) {
      const offered = offerFound()
      if (offered) return offered
    }
    if (!asked.length && modelLike.length) {
      return result({
        ...base,
        decision: 'encaminhar',
        pending_reason: 'A',
        confidence: 0.2,
        detected_model: modelLike[0]!,
        reason_explanation: `Sem IA: modelo citado (${modelLike.join(', ')}) não está cadastrado na base.`,
        missing_info: [`Aplicação do anúncio para ${modelLike.join(', ')}`],
        suggested_routing: 'Revisor técnico verificar a compatibilidade e cadastrar a aplicação.',
      })
    }
    if (!asked.length) {
      return result({
        ...base,
        decision: 'solicitar_info',
        pending_reason: 'B',
        confidence: 0.85,
        answer: `${hello}\nPara confirmar a compatibilidade com segurança, poderia nos informar o modelo completo da máquina, o ano e, se possível, o código da peça original?\nAssim verificamos a aplicação correta e evitamos que você adquira um item incompatível.`,
        reason_explanation: 'Sem IA: pergunta de compatibilidade sem modelo de máquina identificado.',
        missing_info: ['Modelo da máquina'],
        suggested_routing: 'Aguardar dados do cliente.',
      })
    }
    const mine = (context.aplicacoes ?? []).filter((a) => asked.includes(modelKey(a.modelo)) && ((item && a.anuncio_id === item.id) || itemCodes.includes(normCode(a.codigo))))
    const ok = mine.find((a) => a.status_validacao === 'confirmada')
    if (ok) {
      const detail = ok.aplicacao ? `\nAplicação: ${ok.aplicacao}.` : ''
      const others = offers.filter((o) => o.id !== item?.id).slice(0, 3)
      const more = others.length ? `\nOutras opções em nossa loja:\n${others.map((o) => `• ${o.titulo}: {{LINK:${o.id}}}`).join('\n')}` : ''
      return result({
        ...base,
        decision: 'responder',
        pending_reason: 'nenhum',
        confidence: 0.92,
        answer: `${hello}\nSim. Conforme nossa base técnica, ${ok.produto || item?.titulo || 'esta peça'}${ok.codigo ? ` (código ${ok.codigo})` : ''} tem aplicação confirmada para ${[ok.marca_maquina, ok.modelo].filter(Boolean).join(' ')}.${detail}${linkLine}${more}`.slice(0, max),
        reason_explanation: 'Sem IA: aplicação confirmada encontrada para o modelo citado.',
        found_info: [`Aplicação confirmada: ${ok.codigo} → ${ok.marca_maquina ?? ''} ${ok.modelo}`],
      })
    }
    const offered = offerFound()
    if (offered) return offered
    return result({
      ...base,
      decision: 'encaminhar',
      pending_reason: 'A',
      confidence: 0.3,
      reason_explanation: mine.length ? `Sem IA: aplicação para ${det.modelos.join(', ')} existe, mas não está confirmada.` : `Sem IA: não há aplicação cadastrada deste anúncio para ${det.modelos.join(', ')}.`,
      missing_info: [`Aplicação confirmada do código ${itemCodes[0] ?? '(sem código)'} para ${det.modelos.join(', ')}`],
      suggested_routing: 'Revisor técnico validar a aplicação e cadastrar na base.',
    })
  }

  // 2) Dúvida parecida com uma pergunta aprovada da base
  const best = bestKnowledge(0)
  if (best && best.s >= 0.6) {
    return result({
      ...base,
      decision: 'responder',
      pending_reason: 'nenhum',
      confidence: Math.min(0.95, 0.5 + best.s / 2),
      answer: finish(best.k.resposta_aprovada),
      knowledge_ids_used: [best.k.id],
      reason_explanation: `Sem IA: pergunta semelhante (${Math.round(best.s * 100)}%) ao conhecimento #${best.k.id}.`,
      found_info: [`Conhecimento #${best.k.id}: ${best.k.titulo}`],
    })
  }

  // 3) Procura de peça sem resposta aprovada: mostra o que a loja tem
  const commercial = COMMERCIAL.test(q)
  if (!commercial) {
    const offered = offerFound()
    if (offered) return offered
  }

  // 4) Sem resposta aprovada: encaminha
  return result({
    ...base,
    decision: 'encaminhar',
    pending_reason: commercial ? 'E' : item ? 'A' : 'D',
    confidence: 0,
    reason_explanation: best ? `Sem IA: pergunta mais parecida na base tem só ${Math.round(best.s * 100)}% de semelhança.` : 'Sem IA: nenhuma resposta aprovada correspondente.',
    missing_info: ['Resposta aprovada para esta dúvida'],
    suggested_routing: commercial ? 'Atendente comercial responder.' : 'Cadastrar a resposta na base de conhecimento após responder.',
  })
}
