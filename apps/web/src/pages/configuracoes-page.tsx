import {
  BotIcon,
  BotMessageSquareIcon,
  Building2Icon,
  ChartLineIcon,
  ChartNoAxesCombinedIcon,
  ContactRoundIcon,
  DatabaseIcon,
  FileSpreadsheetIcon,
  GaugeIcon,
  type LucideIcon,
  MailIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  NetworkIcon,
  PaletteIcon,
  RadarIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  StoreIcon,
  TagIcon,
  TagsIcon,
  TargetIcon,
  UserCogIcon,
  UsersIcon,
  ClockIcon,
  FlaskConicalIcon,
  PlugIcon,
  SparklesIcon,
  ListChecksIcon,
  WorkflowIcon,
} from 'lucide-react'
import { lazy, type ReactNode, Suspense, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { PageHeader, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import type { Action } from '@/lib/types'
import { cn } from '@/lib/utils'

// Cada seção vem da tela onde já existia (carregada só quando aberta).
const lazyNamed = <M extends Record<string, unknown>, K extends keyof M>(load: () => Promise<M>, name: K) =>
  lazy(async () => ({ default: (await load())[name] as React.ComponentType<Record<string, unknown>> }))

const settingsPage = () => import('./settings-page')
const cadastros = () => import('./cadastros-page')
const whatsapp = () => import('./whatsapp-numeros-page')
const leadsConfig = () => import('./leads-config-page')

const BrandingTab = lazyNamed(settingsPage, 'BrandingTab')
const AppearanceTab = lazyNamed(settingsPage, 'AppearanceTab')
const SmtpTab = lazyNamed(settingsPage, 'SmtpTab')
const CompanyRenameCard = lazyNamed(() => import('@/components/company-rename'), 'CompanyRenameCard')
const UnitsTab = lazyNamed(cadastros, 'UnitsTab')
const SellersTab = lazyNamed(cadastros, 'SellersTab')
const ListsTab = lazyNamed(cadastros, 'ListsTab')
const AlertsTab = lazyNamed(cadastros, 'AlertsTab')
const ImportTab = lazyNamed(cadastros, 'ImportTab')
const UsersContent = lazyNamed(() => import('./users-page'), 'UsersContent')
const RolesContent = lazyNamed(() => import('./roles-page'), 'RolesContent')
const Numbers = lazyNamed(whatsapp, 'Numbers')
const Rules = lazyNamed(whatsapp, 'Rules')
const QuickReplies = lazyNamed(whatsapp, 'QuickReplies')
const SectorsSettings = lazyNamed(() => import('@/components/whatsapp/setores'), 'SectorsSettings')
const ChatbotSettings = lazyNamed(() => import('@/components/whatsapp/chatbot'), 'ChatbotSettings')
const LabelsManager = lazyNamed(() => import('@/components/chat/organizar'), 'LabelsManager')
const FieldsTab = lazyNamed(leadsConfig, 'FieldsTab')
const ScoringTab = lazyNamed(leadsConfig, 'ScoringTab')
const TagsTab = lazyNamed(leadsConfig, 'TagsTab')
const EmailSettingsTab = lazyNamed(() => import('./email-page'), 'SettingsTab')
const PrivacyCard = lazyNamed(() => import('./captura-page'), 'PrivacyCard')
const AdsTagCard = lazyNamed(() => import('./captura-page'), 'AdsTagCard')
const TrackingTab = lazyNamed(() => import('./settings/tracking-tab'), 'TrackingTab')
const MagazordTab = lazyNamed(() => import('./settings/magazord-tab'), 'MagazordTab')
const MarketingSettingsTab = lazyNamed(() => import('./settings/marketing-tab'), 'MarketingSettingsTab')
const MetaTab = lazyNamed(() => import('./settings/meta-tab'), 'MetaTab')
const Ga4Tab = lazyNamed(() => import('./settings/ga4-tab'), 'Ga4Tab')
const GoogleAdsTab = lazyNamed(() => import('./settings/google-ads-tab'), 'GoogleAdsTab')
const MarketplacesConexoes = lazyNamed(() => import('./marketplaces'), 'MarketplacesConexoes')
const assistente = () => import('./assistente/configuracoes')
const AssistenteIntegracao = lazyNamed(assistente, 'AssistenteIntegracao')
const AssistenteRespostas = lazyNamed(assistente, 'AssistenteRespostas')
const AssistenteMotor = lazyNamed(assistente, 'AssistenteMotor')
const AssistenteTestar = lazyNamed(assistente, 'AssistenteTestar')
const TcarTab = lazyNamed(() => import('./settings/tcar-tab'), 'TcarTab')

interface Section {
  id: string
  group: string
  title: string
  /** O que a seção ajusta (aparece no topo dela e entra na busca). */
  description: string
  icon: LucideIcon
  /** Permissão que libera a seção (a mesma que a API exige). */
  module: string
  action?: Action
  /** Só o administrador do sistema. */
  adminOnly?: boolean
  /** A própria seção já tem título e botões (usuários, perfis, números). */
  ownHeader?: boolean
  /** Palavras extras para a busca. */
  keywords?: string
  render: (can: (module: string, action?: Action) => boolean) => ReactNode
}

/**
 * Tudo o que é ajuste do sistema, num lugar só, organizado por assunto. Cada empresa (cliente do CRM) tem os próprios
 * ajustes; cada seção aparece para quem tem a permissão dela.
 */
const SECTIONS: Section[] = [
  // ---------- Empresa ----------
  {
    id: 'empresa',
    group: 'Empresa',
    title: 'Identidade da empresa',
    description: 'Nome do sistema e da empresa, cores, logo, ícone da aba e textos da tela de login. E a troca do nome da empresa em todos os textos já escritos.',
    icon: Building2Icon,
    module: 'configuracoes',
    keywords: 'marca logo cor nome empresa favicon login renomear trocar nome',
    render: () => (
      <div className="space-y-6">
        <BrandingTab />
        <CompanyRenameCard />
      </div>
    ),
  },
  { id: 'aparencia', group: 'Empresa', title: 'Aparência', description: 'Layout padrão (Moderno ou Clássico), modelo das telas e se cada pessoa pode escolher o seu.', icon: PaletteIcon, module: 'configuracoes', keywords: 'layout tema telas', render: () => <AppearanceTab /> },
  { id: 'unidades', group: 'Empresa', title: 'Unidades', description: 'Lojas e filiais da empresa. Usadas no atendimento, nos vendedores e nos números de WhatsApp.', icon: StoreIcon, module: 'cadastros', keywords: 'lojas filiais matriz', render: () => <UnitsTab /> },

  // ---------- Equipe e acesso ----------
  { id: 'usuarios', group: 'Equipe e acesso', title: 'Usuários', description: 'Quem acessa o sistema: convite, perfil, unidade, bloqueio, 2FA e aparelhos conectados.', icon: UsersIcon, module: 'usuarios', ownHeader: true, keywords: 'login senha acesso convite 2fa', render: () => <UsersContent /> },
  { id: 'perfis', group: 'Equipe e acesso', title: 'Perfis de acesso', description: 'O que cada perfil pode ver e fazer em cada módulo.', icon: ShieldCheckIcon, module: 'perfis', ownHeader: true, keywords: 'permissões papéis', render: () => <RolesContent /> },
  { id: 'vendedores', group: 'Equipe e acesso', title: 'Vendedores', description: 'Vendedores do atendimento: unidade, telefone (para o resumo do dia), e-mail e usuário ligado.', icon: UserCogIcon, module: 'cadastros', keywords: 'equipe comercial', render: () => <SellersTab /> },

  // ---------- Atendimento ----------
  { id: 'listas', group: 'Pré e Pós-Vendas', title: 'Listas do atendimento', description: 'Origens, tipos de cliente, marcas da máquina, tipos de peça e motivos de perda. Itens são desativados, nunca apagados.', icon: ListChecksIcon, module: 'cadastros', keywords: 'origem marca peça motivo perda tipo cliente cadastros', render: () => <ListsTab /> },
  { id: 'prazos', group: 'Pré e Pós-Vendas', title: 'Prazos e alertas', description: 'Aviso de pré-venda nova, retorno do vendedor, prazo para chamar o cliente em negociação e pós-venda automático.', icon: ClockIcon, module: 'cadastros', keywords: 'alerta prazo sino retorno negociação pós-venda', render: () => <AlertsTab only="prazos" /> },
  { id: 'mensagens-automaticas', group: 'Pré e Pós-Vendas', title: 'Mensagens automáticas', description: 'Mensagem de WhatsApp no dia seguinte para quem abriu pré-venda e resumo do dia para cada vendedor.', icon: BotMessageSquareIcon, module: 'cadastros', keywords: 'dia seguinte resumo vendedores rotina whatsapp', render: () => <AlertsTab only="mensagens" /> },
  { id: 'importar', group: 'Pré e Pós-Vendas', title: 'Importar planilha', description: 'Trazer o histórico de atendimentos de uma planilha.', icon: FileSpreadsheetIcon, module: 'cadastros', adminOnly: true, keywords: 'importação csv google sheets', render: () => <ImportTab /> },

  // ---------- WhatsApp ----------
  { id: 'whatsapp-numeros', group: 'WhatsApp', title: 'Números de WhatsApp', description: 'Números da empresa ligados ao CRM: conexão por QR Code, quem atende, setores e atendimento dividido.', icon: SmartphoneIcon, module: 'whatsapp', ownHeader: true, keywords: 'qr code conectar número chip', render: () => <Numbers /> },
  {
    id: 'setores',
    group: 'WhatsApp',
    title: 'Setores e equipes',
    description: 'Setores de atendimento (Vendas, Pós-venda, Financeiro...): em que números atendem, quem atende, quem gerencia e o que cada um vê. E os gestores de cada vendedor, que acompanham as conversas da equipe.',
    icon: NetworkIcon,
    module: 'whatsapp',
    keywords: 'setor fila gestor gerente equipe monitorar supervisor atendentes multiatendimento',
    render: () => <SectorsSettings />,
  },
  {
    id: 'chatbot',
    group: 'WhatsApp',
    title: 'Chatbot de atendimento',
    description: 'Fluxos sem IA que recebem o cliente, mostram um menu, fazem perguntas e passam a conversa para o setor ou a pessoa certa. Com simulador para testar antes de ligar.',
    icon: BotIcon,
    module: 'whatsapp',
    keywords: 'robô bot fluxo menu ura direcionar triagem automático respostas',
    render: () => <ChatbotSettings />,
  },
  { id: 'whatsapp-regras', group: 'WhatsApp', title: 'Regras e horário', description: 'Contato novo e lead conhecido, cores de espera, horário comercial, mensagem de ausência e prazo de guarda das conversas (LGPD).', icon: SlidersHorizontalIcon, module: 'whatsapp', keywords: 'ausência horário comercial lgpd retenção cores espera', render: (can) => <Rules editable={can('whatsapp', 'edit')} /> },
  { id: 'respostas-rapidas', group: 'WhatsApp', title: 'Respostas rápidas', description: 'Respostas prontas da empresa, para toda a equipe usar no chat.', icon: MessageSquareTextIcon, module: 'whatsapp', keywords: 'atalho mensagem pronta', render: (can) => <QuickReplies editable={can('whatsapp', 'edit')} /> },
  { id: 'etiquetas', group: 'WhatsApp', title: 'Etiquetas do chat', description: 'Etiquetas para organizar as conversas (padrão da empresa ou de cada pessoa).', icon: TagIcon, module: 'whatsapp', keywords: 'organizar conversas cor', render: () => <LabelsManager /> },

  // ---------- Leads e marketing ----------
  { id: 'leads-campos', group: 'Leads e marketing', title: 'Campos personalizados', description: 'Campos extras na ficha do lead.', icon: DatabaseIcon, module: 'configuracoes', action: 'edit', keywords: 'lead campo extra', render: () => <FieldsTab /> },
  { id: 'leads-pontuacao', group: 'Leads e marketing', title: 'Pontuação dos leads', description: 'Lead scoring: pesos, faixas e regras de perfil e de interesse.', icon: GaugeIcon, module: 'configuracoes', action: 'edit', keywords: 'scoring nota lead', render: () => <ScoringTab /> },
  { id: 'leads-tags', group: 'Leads e marketing', title: 'Tags dos leads', description: 'Renomear, juntar ou remover tags em todos os leads.', icon: TagsIcon, module: 'configuracoes', action: 'edit', keywords: 'etiqueta lead', render: () => <TagsTab /> },
  { id: 'email-marketing', group: 'Leads e marketing', title: 'E-mail marketing', description: 'Remetente das campanhas, rodapé, redes sociais, logo dos e-mails, ritmo de envio e a IA (Gemini) que escreve e transcreve áudios.', icon: MailIcon, module: 'email_marketing', keywords: 'remetente rodapé gemini ia chave transcrição', render: () => <EmailSettingsTab /> },
  {
    id: 'captura',
    group: 'Leads e marketing',
    title: 'Captura no site',
    description: 'Política de privacidade dos formulários e a tag do Google Ads usada pelos formulários e botões de WhatsApp do site.',
    icon: MegaphoneIcon,
    module: 'captura',
    keywords: 'privacidade lgpd tag google ads conversão site',
    render: () => (
      <div className="space-y-4">
        <PrivacyCard />
        <AdsTagCard />
      </div>
    ),
  },

  // ---------- Integrações ----------
  { id: 'marketing-inteligente', group: 'Leads e marketing', title: 'Marketing Inteligente', description: 'Regras das análises (lead qualificado, margem, custos fixos, atribuição) e as contas de Meta Ads, Instagram/Facebook, TikTok Ads e Search Console.', icon: ChartNoAxesCombinedIcon, module: 'mi_config', keywords: 'meta tiktok search console margem roi atribuição lead qualificado instagram facebook', render: () => <MarketingSettingsTab /> },
  { id: 'smtp', group: 'Integrações', title: 'Servidor de e-mail (SMTP)', description: 'Servidor que envia os e-mails do sistema e das campanhas.', icon: ServerIcon, module: 'configuracoes', keywords: 'smtp locaweb envio email senha', render: () => <SmtpTab /> },
  { id: 'rastreamento', group: 'Integrações', title: 'Rastreamento do site', description: 'Script de visitas do site e do app, domínios, consentimento e prazo de guarda.', icon: RadarIcon, module: 'configuracoes', keywords: 'script visitas utm cookies', render: () => <TrackingTab /> },
  { id: 'loja', group: 'Integrações', title: 'Loja virtual (Magazord)', description: 'Pedidos, carrinhos e catálogo da loja virtual.', icon: ShoppingBagIcon, module: 'configuracoes', keywords: 'ecommerce magazord pedidos carrinho', render: () => <MagazordTab /> },
  { id: 'meta', group: 'Integrações', title: 'Meta Lead Ads', description: 'Leads dos formulários do Facebook e do Instagram.', icon: WorkflowIcon, module: 'configuracoes', keywords: 'facebook instagram formulário', render: () => <MetaTab /> },
  { id: 'ga4', group: 'Integrações', title: 'Google Analytics', description: 'Dados do GA4 nos relatórios.', icon: ChartLineIcon, module: 'configuracoes', keywords: 'analytics ga4 relatórios', render: () => <Ga4Tab /> },
  { id: 'google-ads', group: 'Integrações', title: 'Google Ads', description: 'Conversões dos atendimentos enviadas às campanhas.', icon: TargetIcon, module: 'configuracoes', keywords: 'conversões offline campanhas', render: () => <GoogleAdsTab /> },
  { id: 'tcar', group: 'Integrações', title: 'Tcar (ERP)', description: 'Estoque e preços do ERP na consulta de produtos.', icon: ContactRoundIcon, module: 'configuracoes', keywords: 'erp estoque preço produtos', render: () => <TcarTab /> },
  // ---------- Marketplaces ----------
  {
    id: 'marketplaces-conexoes',
    group: 'Marketplaces',
    title: 'Conexões dos marketplaces',
    description: 'Conta do Mercado Livre (anúncios e Mercado Livre Ads), sincronização e o histórico trazido do Usaparts BI.',
    icon: PlugIcon,
    module: 'marketplaces',
    ownHeader: true,
    keywords: 'mercado livre ml ads conectar conta oauth bi histórico shopee',
    render: () => <MarketplacesConexoes />,
  },
  {
    id: 'assistente-ml',
    group: 'Marketplaces',
    title: 'Assistente ML: integração',
    description: 'Atendimento das perguntas do Mercado Livre pelo CRM: conexão, notificações do Mercado Livre, loja oficial e anúncios, e o registro.',
    icon: BotIcon,
    module: 'assist_config',
    keywords: 'assistente perguntas mercado livre webhook notificações painel',
    render: () => <AssistenteIntegracao />,
  },
  {
    id: 'assistente-respostas',
    group: 'Marketplaces',
    title: 'Assistente ML: respostas',
    description: 'Instruções que a IA recebe, envio das respostas, frete pela Magazord, quando pedir informação ou encaminhar, venda adicional e categorias.',
    icon: MessageSquareTextIcon,
    module: 'assist_config',
    keywords: 'resposta instruções envio frete magazord encaminhar venda adicional categorias',
    render: () => <AssistenteRespostas />,
  },
  {
    id: 'assistente-ia',
    group: 'Marketplaces',
    title: 'Assistente ML: motor de IA',
    description: 'Motor de respostas (sem IA, Gemini ou Claude), modelo, aprendizado e as chaves de IA.',
    icon: SparklesIcon,
    module: 'assist_config',
    keywords: 'ia claude gemini chave modelo motor',
    render: () => <AssistenteMotor />,
  },
  {
    id: 'assistente-testar',
    group: 'Marketplaces',
    title: 'Assistente ML: testar',
    description: 'Faça uma pergunta de teste e veja a resposta e a decisão do assistente.',
    icon: FlaskConicalIcon,
    module: 'assist_config',
    keywords: 'teste simular pergunta resposta',
    render: () => <AssistenteTestar />,
  },
]

/** Endereços antigos (?aba=...) das telas que viraram seções. */
const OLD_TABS: Record<string, string> = { marca: 'empresa', email: 'smtp' }

const GROUPS = [...new Set(SECTIONS.map((s) => s.group))]

/** Seções que a pessoa pode ver (a mesma regra da API: cada uma pelo próprio módulo). */
function useSettingsSections() {
  const { can, me } = useAuth()
  return SECTIONS.filter((s) => can(s.module, s.action ?? 'view') && (!s.adminOnly || !!me?.role.isSystem))
}

const norm = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function ConfiguracoesPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const sections = useSettingsSections()
  const [search, setSearch] = useState('')
  const asked = params.get('secao') ?? OLD_TABS[params.get('aba') ?? ''] ?? params.get('aba')
  const current = sections.find((s) => s.id === asked) ?? sections[0]
  const filtered = useMemo(() => {
    const q = norm(search.trim())
    return q ? sections.filter((s) => norm(`${s.title} ${s.description} ${s.group} ${s.keywords ?? ''}`).includes(q)) : sections
  }, [sections, search])

  if (!sections.length) return <Navigate to="/" replace />
  const go = (id: string) => setParams({ secao: id }, { replace: false })

  return (
    <div>
      <PageHeader title="Configurações" description="Todos os ajustes do sistema num lugar só. Você vê as seções que o seu perfil permite." />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ajuste (ex.: horário, logo)" className="pl-8" aria-label="Buscar nas configurações" />
          </div>
          {/* Celular: lista de seções num seletor. */}
          <div className="lg:hidden">
            <Select value={current?.id} onValueChange={go}>
              <SelectTrigger className="w-full" aria-label="Seção">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => {
                  const items = filtered.filter((s) => s.group === g)
                  return items.length ? (
                    <SelectGroup key={g}>
                      <SelectLabel>{g}</SelectLabel>
                      {items.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null
                })}
              </SelectContent>
            </Select>
          </div>
          <nav className="hidden max-h-[calc(100dvh-12rem)] space-y-4 overflow-y-auto pr-1 lg:block" aria-label="Seções das configurações">
            {GROUPS.map((g) => {
              const items = filtered.filter((s) => s.group === g)
              if (!items.length) return null
              return (
                <div key={g}>
                  <p className="mb-1 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g}</p>
                  <ul className="space-y-0.5">
                    {items.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => go(s.id)}
                          aria-current={current?.id === s.id ? 'page' : undefined}
                          className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted', current?.id === s.id && 'bg-muted font-medium text-foreground')}
                        >
                          <s.icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{s.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
            {!filtered.length && <p className="px-2 text-sm text-muted-foreground">Nada encontrado com “{search}”.</p>}
          </nav>
        </aside>
        <section className="min-w-0" aria-labelledby={current?.ownHeader ? undefined : 'cfg-title'}>
          {current && !current.ownHeader && (
            <div className="mb-5 border-b pb-4">
              <p className="text-xs font-medium text-muted-foreground">{current.group}</p>
              <h2 id="cfg-title" className="flex items-center gap-2 text-lg font-semibold">
                <current.icon className="size-5 text-muted-foreground" /> {current.title}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{current.description}</p>
            </div>
          )}
          <Suspense fallback={<TableSkeleton rows={4} />}>{current?.render(can)}</Suspense>
          {search && filtered.length > 0 && !filtered.some((s) => s.id === current?.id) && (
            <Button variant="link" className="mt-4 px-0" onClick={() => go(filtered[0]!.id)}>
              Ir para {filtered[0]!.title}
            </Button>
          )}
        </section>
      </div>
    </div>
  )
}
