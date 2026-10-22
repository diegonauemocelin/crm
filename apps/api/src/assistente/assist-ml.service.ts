import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { ML_API } from '../marketplaces/mercadolivre'
import { MercadoLivreService } from '../marketplaces/mercadolivre.service'
import { AssistService } from './assist.service'
import type { StoreSettings } from './constantes'

export interface MlQuestionApi {
  id: number | string
  item_id: string
  text: string
  status: string
  date_created?: string
  from?: { id?: number | string }
  answer?: { text?: string; status?: string; date_created?: string } | null
}

interface MlItemApi {
  id: string
  seller_id?: number | string | null
  official_store_id?: number | string | null
  title?: string
  permalink?: string
  price?: number
  currency_id?: string
  available_quantity?: number
  status?: string
  seller_custom_field?: string | null
  attributes?: { id?: string; name?: string; value_name?: string | null }[]
  last_updated?: string
}

const ML_HOST = /(^|\.)mercado(livre|libre)\.com(\.[a-z]{2})?$/i

/** Chamadas do assistente ao Mercado Livre, com o token da conexão de Marketplaces (renovado automaticamente). */
@Injectable()
export class AssistMlService {
  constructor(
    private readonly ml: MercadoLivreService,
    private readonly assist: AssistService,
  ) {}

  /** O assistente só trabalha no Mercado Livre depois que o CRM assumiu o atendimento e a conexão foi testada. */
  async active(tenantId: string) {
    const [c, integ, st] = await Promise.all([this.ml.config(tenantId), this.assist.integration(tenantId), this.assist.state(tenantId)])
    return integ.active && c.status === 'CONECTADO' && !!c.userId && !!c.refreshTokenEnc && !!st.lastTestOk
  }

  async sellerId(tenantId: string) {
    return (await this.ml.config(tenantId)).userId
  }

  get<T>(tenantId: string, path: string, params: Record<string, string | number> = {}) {
    return this.ml.apiGet<T>(tenantId, path, params)
  }

  getQuestion(tenantId: string, id: string) {
    return this.get<MlQuestionApi>(tenantId, `/questions/${encodeURIComponent(id)}`, { api_version: 4 })
  }

  postAnswer(tenantId: string, questionId: string, text: string) {
    return this.ml.apiPost<{ id?: number | string; status?: string; answer?: { text?: string; status?: string; date_created?: string } }>(tenantId, '/answers', { question_id: Number(questionId), text })
  }

  /** Apelido público do comprador (sem token). */
  async publicUser(id: string | number) {
    try {
      const res = await fetch(`${ML_API}/users/${encodeURIComponent(String(id))}`, { signal: AbortSignal.timeout(8000) })
      return res.ok ? ((await res.json()) as { nickname?: string; site_id?: string; permalink?: string }) : null
    } catch {
      return null
    }
  }

  async listUnanswered(tenantId: string, sellerId: string) {
    const out: MlQuestionApi[] = []
    for (let offset = 0; offset < 1000; offset += 50) {
      const page = await this.get<{ questions?: MlQuestionApi[]; total?: number }>(tenantId, '/questions/search', { seller_id: sellerId, status: 'UNANSWERED', api_version: 4, limit: 50, offset })
      out.push(...(page.questions ?? []))
      if (!page.questions?.length || out.length >= (page.total ?? 0)) break
    }
    return out
  }

  /** Pedido de venda (exige a permissão de Vendas no aplicativo do Mercado Livre). */
  getOrder(tenantId: string, id: string) {
    return this.get<Record<string, unknown>>(tenantId, `/orders/${encodeURIComponent(id)}`)
  }

  /** Pedidos do vendedor criados no intervalo (mais antigos primeiro). */
  async searchOrders(tenantId: string, sellerId: string, from: Date, to: Date, max = 5000) {
    const fmt = (d: Date) => d.toISOString().replace('Z', '-00:00')
    const out: Record<string, unknown>[] = []
    for (let offset = 0; offset < max; offset += 50) {
      const page = await this.get<{ results?: Record<string, unknown>[]; paging?: { total?: number } }>(tenantId, '/orders/search', {
        seller: sellerId,
        'order.date_created.from': fmt(from),
        'order.date_created.to': fmt(to),
        sort: 'date_asc',
        limit: 50,
        offset,
      })
      out.push(...(page.results ?? []))
      if (!page.results?.length || out.length >= (page.paging?.total ?? 0)) break
    }
    return out
  }

  async listSellerItemIds(tenantId: string, sellerId: string) {
    const ids: string[] = []
    let scrollId: string | null = null
    for (let i = 0; i < 500; i++) {
      const page: { results?: string[]; scroll_id?: string } = await this.get(tenantId, `/users/${sellerId}/items/search`, { search_type: 'scan', limit: 100, ...(scrollId ? { scroll_id: scrollId } : {}) })
      if (!page.results?.length) break
      ids.push(...page.results)
      scrollId = page.scroll_id ?? null
      if (!scrollId) break
    }
    return ids
  }

  /** IDs dos anúncios da loja (conta conectada: todos; outra conta: os públicos ativos). */
  async listStoreItemIds(tenantId: string, store: StoreSettings) {
    const seller = await this.sellerId(tenantId)
    if (seller && seller === store.seller_id) return this.listSellerItemIds(tenantId, seller)
    const ids: string[] = []
    for (let offset = 0; offset < 1000; offset += 50) {
      const page = await this.get<{ results?: { id: string }[]; paging?: { total?: number } }>(tenantId, `/sites/${store.site_id || 'MLB'}/search`, {
        seller_id: store.seller_id!,
        ...(store.official_store_id ? { official_store_id: store.official_store_id } : {}),
        limit: 50,
        offset,
      })
      ids.push(...(page.results ?? []).map((r) => r.id))
      if (!page.results?.length || ids.length >= (page.paging?.total ?? 0)) break
    }
    return ids
  }

  /**
   * Busca anúncios em lotes de 20 (3 lotes por vez) e grava a cópia local. A descrição só é baixada de novo quando o
   * anúncio mudou desde a última sincronização.
   */
  async fetchAndStoreItems(tenantId: string, ids: string[], onProgress?: (done: number, total: number) => void) {
    let stored = 0
    let done = 0
    const batches: string[][] = []
    for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20))
    await mapLimit(batches, 3, async (batch) => {
      const results = await this.get<{ code: number; body?: MlItemApi }[]>(tenantId, '/items', { ids: batch.join(',') })
      const items = (results ?? []).filter((r) => r.code === 200 && r.body).map((r) => r.body!)
      for (const it of items) {
        const local = await this.assist.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: it.id } }, select: { description: true, mlLastUpdated: true } })
        let description = local?.description ?? null
        if (!(local?.description && it.last_updated && local.mlLastUpdated === it.last_updated)) {
          description = await this.get<{ plain_text?: string }>(tenantId, `/items/${it.id}/description`)
            .then((d) => d.plain_text ?? null)
            .catch(() => local?.description ?? null)
        }
        const attr = (id: string) => it.attributes?.find((a) => a.id === id)?.value_name ?? null
        const data = {
          sellerId: it.seller_id == null ? null : String(it.seller_id),
          officialStoreId: it.official_store_id == null ? null : String(it.official_store_id),
          title: it.title ?? null,
          permalink: it.permalink ?? null,
          price: it.price ?? null,
          currency: it.currency_id ?? null,
          availableQuantity: it.available_quantity ?? null,
          status: it.status ?? null,
          sellerSku: attr('SELLER_SKU') ?? it.seller_custom_field ?? null,
          partNumber: attr('PART_NUMBER') ?? attr('MPN') ?? attr('OEM') ?? null,
          brand: attr('BRAND'),
          description,
          attributes: (it.attributes ?? []).map((a) => ({ id: a.id, name: a.name, value: a.value_name })) as Prisma.InputJsonValue,
          mlLastUpdated: it.last_updated ?? null,
          syncedAt: new Date(),
        }
        await this.assist.prisma.assistItem.upsert({ where: { tenantId_id: { tenantId, id: it.id } }, create: { tenantId, id: it.id, ...data }, update: data })
        stored++
      }
      done += batch.length
      onProgress?.(done, ids.length)
    })
    return stored
  }

  /** Anúncio pela cópia local; atualiza pela API se não existir ou tiver mais de 6 horas. */
  async getItemCached(tenantId: string, itemId: string | null) {
    if (!itemId) return null
    const local = await this.assist.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: itemId } } })
    const stale = !local || Date.now() - local.syncedAt.getTime() > 6 * 3_600_000
    if (stale) {
      try {
        await this.fetchAndStoreItems(tenantId, [itemId])
      } catch (e) {
        if (!local) throw e
        await this.assist.log(tenantId, 'warn', `Usando cópia local do anúncio ${itemId}: ${(e as Error).message}`)
      }
    }
    return this.assist.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: itemId } } })
  }

  async testConnection(tenantId: string) {
    try {
      const me = await this.get<{ id: number; nickname?: string; site_id?: string }>(tenantId, '/users/me')
      await this.assist.patchState(tenantId, { lastTestAt: new Date().toISOString(), lastTestOk: true })
      return { ok: true, nickname: me.nickname ?? null, sellerId: String(me.id), siteId: me.site_id ?? null }
    } catch (e) {
      await this.assist.patchState(tenantId, { lastTestAt: new Date().toISOString(), lastTestOk: false })
      await this.assist.log(tenantId, 'error', (e as Error).message)
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Anúncios ativos da loja oficial configurada (únicos que podem ser citados com link nas respostas). */
  async allowedLinkItemIds(tenantId: string) {
    const s = await this.assist.store(tenantId)
    if (!s.seller_id) return new Set<string>()
    const rows = await this.assist.prisma.assistItem.findMany({
      where: { tenantId, sellerId: s.seller_id, status: 'active', ...(s.official_store_id ? { officialStoreId: s.official_store_id } : {}) },
      select: { id: true, permalink: true },
    })
    return new Set(rows.filter((r) => /^https:\/\/([a-z0-9-]+\.)*mercado(livre|libre)\.com(\.[a-z]{2})?\//i.test(r.permalink ?? '')).map((r) => r.id))
  }

  /**
   * Identifica a loja pelo que foi informado: link da loja oficial, do perfil, de uma listagem, de qualquer anúncio,
   * apelido ou ID do vendedor.
   */
  async resolveStore(tenantId: string, input: string): Promise<StoreSettings & { is_connected_account: boolean }> {
    const raw = String(input ?? '').trim()
    if (!raw) throw new Error('Informe o link da loja oficial.')
    let sellerId: string | null = null
    let nickname: string | null = null
    let officialStoreId: string | null = null
    let slug: string | null = null
    let itemId: string | null = null
    let url: URL | null = null
    if (/^https?:\/\//i.test(raw) || /mercado(livre|libre)\./i.test(raw)) {
      try {
        url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      } catch {
        throw new Error('Link inválido.')
      }
      if (!ML_HOST.test(url.hostname)) throw new Error('O link precisa ser do Mercado Livre (mercadolivre.com.br).')
      const full = decodeURIComponent(url.href)
      sellerId = full.match(/_CustId_(\d+)/i)?.[1] ?? url.searchParams.get('seller_id')
      officialStoreId = full.match(/_Tienda_[^_/]*?(\d+)/i)?.[1] ?? url.searchParams.get('official_store_id')
      nickname = url.pathname.match(/\/perfil\/([^/?#]+)/i)?.[1] ?? null
      slug = url.pathname.match(/\/(?:loja|pagina|tienda)\/([^/?#]+)/i)?.[1] ?? null
      itemId = full.match(/\b(ML[A-Z])-?(\d{6,})/)?.slice(1).join('') ?? null
    } else if (/^\d+$/.test(raw)) sellerId = raw
    else if (/^ML[A-Z]-?\d{6,}$/i.test(raw)) itemId = raw.toUpperCase().replace('-', '')
    else nickname = raw

    if (!sellerId && itemId && !slug && !nickname) {
      const it = await this.get<MlItemApi>(tenantId, `/items/${itemId}`)
      sellerId = String(it.seller_id)
      officialStoreId ||= it.official_store_id ? String(it.official_store_id) : null
    }
    if (!sellerId && slug && url) {
      try {
        const res = await fetch(url.href, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CRM)', Accept: 'text/html' }, signal: AbortSignal.timeout(15_000) })
        const html = res.ok ? await res.text() : ''
        officialStoreId ||= html.match(/official_store_id["']?\s*[:=]\s*["']?(\d+)/i)?.[1] ?? html.match(/"officialStoreId"\s*:\s*"?(\d+)/i)?.[1] ?? null
        sellerId = html.match(/"seller_?[iI]d"\s*:\s*"?(\d+)/)?.[1] ?? html.match(/_CustId_(\d+)/)?.[1] ?? null
      } catch {
        // segue tentando pela busca
      }
      if (!sellerId && officialStoreId) {
        const s = await this.get<{ results?: { seller?: { id?: number } }[] }>(tenantId, '/sites/MLB/search', { official_store_id: officialStoreId, limit: 1 })
        sellerId = s.results?.[0]?.seller?.id ? String(s.results[0].seller.id) : null
      }
    }
    if (!sellerId && nickname) {
      const s = await this.get<{ seller?: { id?: number }; results?: { seller?: { id?: number } }[] }>(tenantId, '/sites/MLB/search', { nickname, limit: 1 })
      sellerId = s.seller?.id ? String(s.seller.id) : s.results?.[0]?.seller?.id ? String(s.results[0].seller.id) : null
    }
    if (!sellerId) throw new Error('Não foi possível identificar a loja por este link. Cole o link de qualquer anúncio da sua loja ou o link do perfil do vendedor (mercadolivre.com.br/perfil/APELIDO).')
    const user = await this.get<{ nickname?: string; site_id?: string; permalink?: string }>(tenantId, `/users/${sellerId}`)
    const search = await this.get<{ paging?: { total?: number } }>(tenantId, `/sites/${user.site_id || 'MLB'}/search`, { seller_id: sellerId, ...(officialStoreId ? { official_store_id: officialStoreId } : {}), limit: 1 }).catch(() => null)
    const mine = await this.sellerId(tenantId)
    return {
      input: raw,
      seller_id: sellerId,
      nickname: user.nickname ?? nickname,
      site_id: user.site_id ?? 'MLB',
      official_store_id: officialStoreId,
      permalink: user.permalink ?? (url ? url.href : null),
      active_items: search?.paging?.total ?? null,
      is_connected_account: !!mine && mine === sellerId,
    }
  }
}

/** Executa fn para cada item com no máximo `limit` chamadas ao mesmo tempo. */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T, i: number) => Promise<R>) {
  const out = new Array<R>(list.length)
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      out[i] = await fn(list[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
  return out
}
