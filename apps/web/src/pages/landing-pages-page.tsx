import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, FileIcon, LayoutTemplateIcon, Loader2Icon, PlusIcon, SettingsIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { isDirty, useCloseGuard } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { type Block, type LandingConfig, type LandingListItem, type LandingOptions, type LandingPage, type Seo, STATUS_LABEL } from '@/lib/landing'
import { usePageTitle } from '@/lib/page-title'

const GOALS: Record<string, string> = { orcamento: 'Orçamento', promocao: 'Promoção', marca: 'Por marca', lancamento: 'Lançamento', evento: 'Evento', obrigado: 'Obrigado' }

export function LandingPagesPage() {
  usePageTitle('Landing pages')
  const [creating, setCreating] = useState(false)
  const [config, setConfig] = useState(false)
  const list = useQuery({ queryKey: ['landing-pages'], queryFn: () => api.get<LandingListItem[]>('/landing') })
  const opts = useQuery({ queryKey: ['landing-opcoes'], queryFn: () => api.get<LandingOptions>('/landing/opcoes') })
  return (
    <RequirePermission module="email_marketing">
      <PageHeader
        title="Landing pages"
        description="Páginas para anúncios e campanhas, montadas em blocos, a partir de modelos ou com a IA. Só quem preenche o formulário vira lead."
        actions={
          <>
            <Can module="email_marketing" action="edit">
              <Button variant="outline" onClick={() => setConfig(true)} disabled={!opts.data}>
                <SettingsIcon /> Subdomínio e medição
              </Button>
            </Can>
            <Can module="email_marketing" action="create">
              <Button onClick={() => setCreating(true)} disabled={!opts.data}>
                <PlusIcon /> Nova landing page
              </Button>
            </Can>
          </>
        }
      />
      {opts.data && !opts.data.config.domain && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          O subdomínio ainda não está configurado: as páginas ficam no endereço do CRM ({opts.data.base}). Configure em <b>Subdomínio e medição</b> (ex.: lp.usaparts.com.br).
        </p>
      )}
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <TableSkeleton rows={4} />
      ) : !list.data.length ? (
        <EmptyState icon={LayoutTemplateIcon} title="Nenhuma landing page ainda" description="Comece por um modelo pronto (orçamento, material rodante, filtros, por marca...) ou peça para a IA montar a partir do objetivo." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Página</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Visitantes (30 dias)</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Conversão</TableHead>
                <TableHead>Atualizada</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-6">
                    <Link to={`/landing-pages/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{p.url}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === 'PUBLICADA' ? 'default' : 'secondary'}>{STATUS_LABEL[p.status]}</Badge>
                    {p.abActive && (
                      <Badge variant="outline" className="ml-1">
                        Teste A/B
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.visitors30.toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.leads30.toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.conversion30 === null ? '—' : `${p.conversion30.toLocaleString('pt-BR')}%`}</TableCell>
                  <TableCell className="text-sm">{formatDateTime(p.updatedAt)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    {p.status === 'PUBLICADA' && (
                      <Button asChild size="icon-sm" variant="ghost" aria-label={`Abrir a página ${p.name}`}>
                        <a href={p.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLinkIcon />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {creating && opts.data && <NewLandingDialog options={opts.data} onClose={() => setCreating(false)} />}
      {config && opts.data && <ConfigDialog initial={opts.data.config} onClose={() => setConfig(false)} />}
    </RequirePermission>
  )
}

function NewLandingDialog({ options, onClose }: { options: LandingOptions; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [tab, setTab] = useState('modelos')
  const create = useMutation({
    mutationFn: (body: { name?: string; template?: string; blocks?: Block[]; seo?: Seo; theme?: object }) => api.post<LandingPage>('/landing', body),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['landing-pages'] })
      toast.success('Página criada. Ajuste os textos e as imagens e publique.')
      navigate(`/landing-pages/${p.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova landing page</DialogTitle>
          <DialogDescription>Escolha um modelo pronto, peça para a IA montar ou comece em branco. Tudo pode ser ajustado depois.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="lp-name">Nome da página (opcional)</Label>
          <Input id="lp-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Filtros Komatsu PC200 - Google Ads" />
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="modelos">
              <LayoutTemplateIcon /> Modelos prontos
            </TabsTrigger>
            <TabsTrigger value="ia">
              <SparklesIcon /> Criar com IA
            </TabsTrigger>
            <TabsTrigger value="branco">
              <FileIcon /> Em branco
            </TabsTrigger>
          </TabsList>
          <TabsContent value="modelos" className="mt-3 grid gap-3 sm:grid-cols-2">
            {options.templates.map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={create.isPending}
                onClick={() => create.mutate({ name: name || undefined, template: t.key })}
                className="rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-muted/40 disabled:opacity-50"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="secondary">{GOALS[t.goal] ?? t.goal}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">{t.blocks.map((b) => options.blocks.find((d) => d.type === b)?.label.split(' (')[0] ?? b).join(' · ')}</p>
              </button>
            ))}
          </TabsContent>
          <TabsContent value="ia" className="mt-3">
            <AiCreator options={options} busy={create.isPending} onCreate={(r) => create.mutate({ name: name || r.name, blocks: r.blocks, seo: r.seo, theme: r.theme })} />
          </TabsContent>
          <TabsContent value="branco" className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">Começa com um topo e um formulário. Você adiciona os outros blocos no editor.</p>
            <Button onClick={() => create.mutate({ name: name || undefined })} disabled={create.isPending}>
              {create.isPending && <Loader2Icon className="animate-spin" />} Criar página em branco
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

interface Outline {
  title: string
  angle: string
  blocks: string[]
}

/** IA: descreve o objetivo, escolhe uma das estruturas sugeridas e a IA escreve a página. */
function AiCreator({ options, busy, onCreate }: { options: LandingOptions; busy: boolean; onCreate: (r: { name: string; blocks: Block[]; seo: Seo; theme: object }) => void }) {
  const [brief, setBrief] = useState({ goal: '', audience: '', offer: '', channel: 'Google Ads', language: 'pt' as 'pt' | 'es' })
  const [outlines, setOutlines] = useState<Outline[] | null>(null)
  const suggest = useMutation({
    mutationFn: () => api.post<{ options: Outline[] }>('/landing/ia/estruturas', brief),
    onSuccess: (r) => setOutlines(r.options),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const build = useMutation({
    mutationFn: (o: Outline) => api.post<{ blocks: Block[]; seo: Seo; theme: object }>('/landing/ia/montar', { ...brief, outline: o }),
    onSuccess: (r, o) => onCreate({ name: r.seo.title || o.title, ...r }),
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  if (!options.aiAvailable) return <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Para criar com IA, cadastre a chave do Gemini em Configurações › E-mail marketing (é gratuita no Google AI Studio).</p>
  const label = (t: string) => options.blocks.find((d) => d.type === t)?.label.split(' (')[0] ?? t
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="ia-goal" required>
          Objetivo da página
        </Label>
        <Textarea id="ia-goal" rows={2} maxLength={600} value={brief.goal} onChange={(e) => setBrief({ ...brief, goal: e.target.value })} placeholder="Ex.: captar pedidos de orçamento de filtros para Komatsu PC200 vindos do Google Ads" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ia-aud">Público</Label>
          <Input id="ia-aud" maxLength={300} value={brief.audience} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} placeholder="Ex.: frotistas e oficinas do Sul" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ia-offer">Oferta ou condição (confirmada)</Label>
          <Input id="ia-offer" maxLength={400} value={brief.offer} onChange={(e) => setBrief({ ...brief, offer: e.target.value })} placeholder="Deixe vazio se não houver" />
        </div>
        <div className="space-y-1.5">
          <Label>Tráfego principal</Label>
          <Select value={brief.channel} onValueChange={(v) => setBrief({ ...brief, channel: v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['Google Ads', 'Meta Ads (Facebook e Instagram)', 'TikTok Ads', 'E-mail marketing', 'WhatsApp', 'Orgânico (redes e site)'].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Idioma</Label>
          <Select value={brief.language} onValueChange={(v) => setBrief({ ...brief, language: v as 'pt' | 'es' })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt">Português (Brasil)</SelectItem>
              <SelectItem value="es">Espanhol (América Latina)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={() => suggest.mutate()} disabled={suggest.isPending || brief.goal.trim().length < 10}>
        {suggest.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Sugerir estruturas
      </Button>
      {outlines && (
        <div className="grid gap-3 sm:grid-cols-3">
          {outlines.map((o) => (
            <div key={o.title} className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="font-medium">{o.title}</p>
              <p className="text-sm text-muted-foreground">{o.angle}</p>
              <ol className="list-decimal pl-5 text-xs text-muted-foreground">
                {o.blocks.map((b, i) => (
                  <li key={`${b}${i}`}>{label(b)}</li>
                ))}
              </ol>
              <Button size="sm" className="mt-auto" onClick={() => build.mutate(o)} disabled={build.isPending || busy}>
                {build.isPending && build.variables === o ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Montar esta
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">A IA escreve os textos sem inventar preço, prazo, estoque ou garantia: onde faltar dado, deixa [entre colchetes] para alguém completar.</p>
    </div>
  )
}

function ConfigDialog({ initial, onClose }: { initial: LandingConfig; onClose: () => void }) {
  const qc = useQueryClient()
  const [c, setC] = useState(initial)
  const guard = useCloseGuard(isDirty(initial, c), onClose, 'as configurações')
  const save = useMutation({
    mutationFn: () => api.put<LandingConfig>('/landing/config', { ...c }),
    onSuccess: () => {
      toast.success('Configurações salvas.')
      void qc.invalidateQueries({ queryKey: ['landing-opcoes'] })
      void qc.invalidateQueries({ queryKey: ['landing-pages'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const set = (patch: Partial<LandingConfig>) => setC({ ...c, ...patch })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Subdomínio e medição</DialogTitle>
          <DialogDescription>Onde as páginas ficam no ar e quais ferramentas medem as visitas e as conversões.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cfg-domain">Subdomínio das páginas</Label>
            <Input id="cfg-domain" value={c.domain} onChange={(e) => set({ domain: e.target.value })} placeholder="lp.usaparts.com.br" />
            <p className="text-xs text-muted-foreground">O TI aponta o DNS deste subdomínio para o servidor do CRM e instala o certificado (passo a passo em deploy/LANDING-PAGES.md). Enquanto isso, as páginas funcionam no endereço do CRM, em /lp/.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-home">Quem abrir o subdomínio sem página vai para</Label>
            <Input id="cfg-home" value={c.homeUrl} onChange={(e) => set({ homeUrl: e.target.value })} placeholder="https://www.usaparts.com.br" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-ga4">GA4: ID de medição</Label>
              <Input id="cfg-ga4" value={c.ga4Id} onChange={(e) => set({ ga4Id: e.target.value })} placeholder="G-XXXXXXXXXX" />
              <p className="text-xs text-muted-foreground">GA4 › Administrador › Fluxos de dados › Web. Use o mesmo do site para ver tudo junto.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-pixel">Meta Pixel: ID</Label>
              <Input id="cfg-pixel" value={c.pixelId} onChange={(e) => set({ pixelId: e.target.value })} placeholder="Só números" />
              <p className="text-xs text-muted-foreground">Gerenciador de Eventos da Meta › Fontes de dados.</p>
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <Switch checked={c.useAdsTag} onCheckedChange={(v) => set({ useAdsTag: v })} aria-label="Usar a tag de conversão do Google Ads" />
            <span>
              <b>Conversões do Google Ads</b>
              <br />
              <span className="text-muted-foreground">Usa a tag e as conversões cadastradas em Captura › Google Ads (formulário enviado e clique no WhatsApp).</span>
            </span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-cookie">Aviso de cookies (LGPD)</Label>
            <Textarea id="cfg-cookie" rows={2} maxLength={300} value={c.cookieText} onChange={(e) => set({ cookieText: e.target.value })} />
            <p className="text-xs text-muted-foreground">GA4, Meta Pixel e Google Ads só carregam depois que o visitante aceita. As contagens do próprio CRM (visitas, cliques, leads) não usam dado pessoal.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
