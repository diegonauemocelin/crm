import { amazon } from './amazon'
import { shopee } from './shopee'
import type { ChannelAdapter, ChannelKey } from './tipos'
import { tiktok } from './tiktok'

/** Integrações dos marketplaces além do Mercado Livre (cada uma pela API oficial da plataforma). */
export const ADAPTERS: Record<ChannelKey, ChannelAdapter> = { shopee, amazon, tiktok }
