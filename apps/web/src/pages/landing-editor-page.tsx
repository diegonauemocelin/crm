import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CopyIcon, ExternalLinkIcon, EyeIcon, Loader2Icon, MonitorIcon, PauseIcon, PlusIcon, RocketIcon, SaveIcon, SmartphoneIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { isDirty, useConfirm, useUnsavedChangesPrompt } from '@/components/confirm'
import { CopyButton } from '@/components/landing/copiar'
import { Fields } from '@/components/landing/campos'
import { ErrorState, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type Block, type LandingMetrics, type LandingOptions, type LandingPage, newBlock, type Seo, slugify, STATUS_LABEL, type Theme, UTM_CHANNELS, utmUrl } from '@/lib/landing'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'

interface Draft {
  name: string
  slug: string
  theme: Theme
  blocks: Block[]
  blocksB: Block[] | null
  abActive: boolean
  abSplit: number
  seo: Seo
}
const draftOf = (p: LandingPage): Draft => ({ name: p.name, slug: p.slug, theme: p.theme, blocks: p.blocks, blocksB: p.blocksB, abActive: p.abActive, abSplit: p.abSplit, seo: p.seo })

export function LandingEditorPage() {
  const { id = '' } = useParams()
  const page = useQuery({ queryKey: ['landing-page', id], queryFn: () => api.get<LandingPage>(`/landing/${id}`) })
  const opts = useQuery({ queryKey: ['landing-opcoes'], queryFn: () => api.get<LandingOptions>('/landing/opcoes') })
  usePageTitle(page.data?.name ?? 'Landing page')
  return (
    <RequirePermission module="email_marketing">
      {page.error || opts.error ? <ErrorState error={page.error ?? opts.error} onRetry={() => void page.refetch()} /> : !page.data || !opts.data ? <TableSkeleton rows={6} /> : <Editor key={page.data.updatedAt} page={page.data} options={opts.data} />}
    </RequirePermission>
  )
}

function Editor({ page, options }: { page: LandingPage; options: LandingOptions }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { can } = useAuth()
  const canEdit = can('email_marketing', 'edit')
  const [saved, setSaved] = useState(() => draftOf(page))
  const [d, setD] = useState(saved)
  const [variant, setVariant] = useState<'A' | 'B'>('A')
  const [sel, setSel] = useState<string | null>(d.blocks[0]?.id ?? null)
  const [tab, setTab] = useState('bloco')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const dirty = isDirty(saved, d)
  useUnsavedChangesPrompt(dirty)

  const blocks = variant === 'B' && d.blocksB ? d.blocksB : d.blocks
  const setBlocks = (next: Block[]) => setD((x) => (variant === 'B' && x.blocksB ? { ...x, blocksB: next } : { ...x, blocks: next }))
  const selected = blocks.find((b) => b.id === sel) ?? null
  const def = selected ? options.blocks.find((b) => b.type === selected.type) : null

  const save = useMutation({
    mutationFn: () => api.put<LandingPage>(`/landing/${page.id}`, { ...d }),
    onSuccess: (p) => {
      const next = draftOf(p)
      setSaved(next)
      setD(next)
      qc.setQueryData(['landing-page', page.id], p)
      void qc.invalidateQueries({ queryKey: ['landing-pages'] })
      toast.success('Página salva.')
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const publish = useMutation({
    mutationFn: async (on: boolean) => {
      if (dirty) await save.mutateAsync()
      return api.post<LandingPage>(`/landing/${page.id}/publicacao`, { publish: on })
    },
    onSuccess: (p, on) => {
      qc.setQueryData(['landing-page', page.id], p)
      void qc.invalidateQueries({ queryKey: ['landing-pages'] })
      toast.success(on ? 'Página no ar.' : 'Página pausada: quem abrir o endereço vê "página não encontrada".')
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 10000 }),
  })
  const duplicate = useMutation({
    mutationFn: () => api.post<LandingPage>(`/landing/${page.id}/duplicar`),
    onSuccess: (p) => navigate(`/landing-pages/${p.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/landing/${page.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['landing-pages'] })
      navigate('/landing-pages')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const updateBlock = (b: Block) => setBlocks(blocks.map((x) => (x.id === b.id ? b : x)))
  const move = (i: number, dir: number) => {
    const next = [...blocks]
    const [x] = next.splice(i, 1)
    next.splice(i + dir, 0, x!)
    setBlocks(next)
  }
  const addBlock = (type: string) => {
    const bd = options.blocks.find((b) => b.type === type)!
    const b = newBlock(bd)
    if (type === 'formulario' && options.forms[0]) b.formId = options.forms[0].id
    const at = sel ? blocks.findIndex((x) => x.id === sel) + 1 : blocks.length
    setBlocks([...blocks.slice(0, at), b, ...blocks.slice(at)])
    setSel(b.id)
    setTab('bloco')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="icon-sm" variant="ghost" aria-label="Voltar para as landing pages">
          <Link to="/landing-pages">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className="h-9 max-w-sm font-semibold" aria-label="Nome da página" disabled={!canEdit} />
        <Badge variant={page.status === 'PUBLICADA' ? 'default' : 'secondary'}>{STATUS_LABEL[page.status]}</Badge>
        {dirty && <span className="text-xs text-amber-600">Alterações não salvas</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {page.status === 'PUBLICADA' && (
            <Button asChild size="sm" variant="outline">
              <a href={page.url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon /> Abrir
              </a>
            </Button>
          )}
          {canEdit && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    Mais
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => duplicate.mutate()}>
                    <CopyIcon /> Duplicar página
                  </DropdownMenuItem>
                  {can('email_marketing', 'delete') && (
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={async () => {
                        if (await confirm({ title: 'Excluir esta landing page?', description: 'Ela sai do ar e da lista. Os leads que ela gerou continuam na base.', confirmLabel: 'Excluir' })) remove.mutate()
                      }}
                    >
                      <Trash2Icon /> Excluir
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Salvar
              </Button>
              {page.status === 'PUBLICADA' ? (
                <Button size="sm" variant="outline" onClick={() => publish.mutate(false)} disabled={publish.isPending}>
                  <PauseIcon /> Pausar
                </Button>
              ) : null}
              <Button size="sm" onClick={() => publish.mutate(true)} disabled={publish.isPending}>
                {publish.isPending ? <Loader2Icon className="animate-spin" /> : <RocketIcon />} {page.status === 'PUBLICADA' ? (dirty ? 'Salvar e atualizar' : 'Publicada') : 'Publicar'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
        {/* Blocos */}
        <Card className="h-fit gap-2 py-3">
          <CardContent className="space-y-2 px-3">
            {d.abActive && d.blocksB && (
              <ToggleGroup type="single" variant="outline" size="sm" value={variant} onValueChange={(v) => v && (setVariant(v as 'A' | 'B'), setSel(null))} className="w-full">
                <ToggleGroupItem value="A" className="flex-1">
                  Versão A
                </ToggleGroupItem>
                <ToggleGroupItem value="B" className="flex-1">
                  Versão B
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <p className="text-xs font-medium text-muted-foreground">Blocos da página {d.abActive && d.blocksB ? `(versão ${variant})` : ''}</p>
            <ol className="space-y-1">
              {blocks.map((b, i) => {
                const bd = options.blocks.find((x) => x.type === b.type)
                const title = String(b.title || b.eyebrow || '')
                return (
                  <li key={b.id}>
                    <div className={cn('group flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm', sel === b.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (setSel(b.id), setTab('bloco'))}>
                        <span className="block truncate font-medium">{bd?.label.split(' (')[0] ?? b.type}</span>
                        {title && <span className="block truncate text-xs text-muted-foreground">{title}</span>}
                      </button>
                      {canEdit && (
                        <span className="flex shrink-0 opacity-60 group-hover:opacity-100">
                          <Button type="button" size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir bloco">
                            <ArrowUpIcon />
                          </Button>
                          <Button type="button" size="icon-sm" variant="ghost" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="Descer bloco">
                            <ArrowDownIcon />
                          </Button>
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="w-full">
                    <PlusIcon /> Adicionar bloco
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-96 w-72 overflow-y-auto">
                  {options.blocks.map((b) => (
                    <DropdownMenuItem key={b.type} onClick={() => addBlock(b.type)} className="flex-col items-start gap-0">
                      <span className="font-medium">{b.label}</span>
                      <span className="text-xs text-muted-foreground">{b.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CardContent>
        </Card>

        {/* Prévia */}
        <Preview draft={d} blocks={blocks} pageId={page.id} device={device} onDevice={setDevice} />

        {/* Painel */}
        <Card className="h-fit gap-2 py-3">
          <CardContent className="px-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-3 w-full">
                <TabsTrigger value="bloco">Bloco</TabsTrigger>
                <TabsTrigger value="tema">Tema</TabsTrigger>
                <TabsTrigger value="pagina">Página</TabsTrigger>
                <TabsTrigger value="metricas">Métricas</TabsTrigger>
                <TabsTrigger value="links">Links</TabsTrigger>
              </TabsList>
              <TabsContent value="bloco">
                {selected && def ? (
                  <BlockPanel
                    key={selected.id}
                    block={selected}
                    def={def}
                    options={options}
                    disabled={!canEdit}
                    onChange={updateBlock}
                    onDuplicate={() => {
                      const copy = { ...selected, id: `b${Date.now().toString(36)}` }
                      const i = blocks.findIndex((b) => b.id === selected.id)
                      setBlocks([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)])
                      setSel(copy.id)
                    }}
                    onRemove={() => {
                      setBlocks(blocks.filter((b) => b.id !== selected.id))
                      setSel(null)
                    }}
                  />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Escolha um bloco na lista para editar, ou adicione um novo.</p>
                )}
              </TabsContent>
              <TabsContent value="tema">
                <ThemePanel theme={d.theme} fonts={options.fonts} disabled={!canEdit} onChange={(theme) => setD({ ...d, theme })} />
              </TabsContent>
              <TabsContent value="pagina">
                <PagePanel draft={d} base={options.base} disabled={!canEdit} onChange={setD} onVariant={setVariant} />
              </TabsContent>
              <TabsContent value="metricas">
                <MetricsPanel pageId={page.id} />
              </TabsContent>
              <TabsContent value="links">
                <LinksPanel url={page.url} slug={d.slug} published={page.status === 'PUBLICADA'} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/** Prévia ao vivo: o servidor monta o mesmo HTML da página publicada (sem scripts), a cada pausa na digitação. */
function Preview({ draft, blocks, pageId, device, onDevice }: { draft: Draft; blocks: Block[]; pageId: string; device: 'desktop' | 'mobile'; onDevice: (d: 'desktop' | 'mobile') => void }) {
  const body = useMemo(() => ({ id: pageId, name: draft.name, slug: draft.slug, theme: draft.theme, blocks, seo: draft.seo }), [pageId, draft.name, draft.slug, draft.theme, blocks, draft.seo])
  const [debounced, setDebounced] = useState(body)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(body), 500)
    return () => clearTimeout(t)
  }, [body])
  const q = useQuery({ queryKey: ['landing-previa', debounced], queryFn: () => api.post<{ html: string }>('/landing/previa', debounced), placeholderData: keepPreviousData })
  return (
    <Card className="gap-2 overflow-hidden py-0">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <EyeIcon className="size-3.5" /> Prévia {q.isFetching && <Loader2Icon className="size-3.5 animate-spin" />}
        </span>
        <ToggleGroup type="single" size="sm" variant="outline" value={device} onValueChange={(v) => v && onDevice(v as 'desktop' | 'mobile')}>
          <ToggleGroupItem value="desktop" aria-label="Prévia no computador">
            <MonitorIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="Prévia no celular">
            <SmartphoneIcon />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex justify-center bg-muted/40 p-3">
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <iframe title="Prévia da landing page" sandbox="" srcDoc={q.data?.html ?? ''} className={cn('h-[calc(100vh-13rem)] min-h-[520px] rounded-md border bg-white shadow-sm transition-all', device === 'mobile' ? 'w-[390px]' : 'w-full')} />
        )}
      </div>
    </Card>
  )
}

function BlockPanel({ block, def, options, disabled, onChange, onDuplicate, onRemove }: { block: Block; def: LandingOptions['blocks'][number]; options: LandingOptions; disabled: boolean; onChange: (b: Block) => void; onDuplicate: () => void; onRemove: () => void }) {
  const [instruction, setInstruction] = useState('')
  const improve = useMutation({
    mutationFn: () => api.post<{ block: Block }>('/landing/ia/melhorar', { block, instruction }),
    onSuccess: (r) => {
      onChange({ ...r.block, id: block.id })
      toast.success('Textos do bloco reescritos pela IA. Confira antes de publicar.')
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{def.label}</p>
        <p className="text-xs text-muted-foreground">{def.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {def.variants && (
          <div className="space-y-1">
            <Label className="text-xs">Layout</Label>
            <Select value={block.variant} onValueChange={(v) => onChange({ ...block, variant: v })} disabled={disabled}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {def.variants.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className={cn('space-y-1', !def.variants && 'col-span-2')}>
          <Label className="text-xs">Fundo</Label>
          <Select value={block.background ?? 'padrao'} onValueChange={(v) => onChange({ ...block, background: v })} disabled={disabled || (block.type === 'hero' && block.variant === 'imagem-fundo')}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.backgrounds.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Fields fields={def.fields} value={block} onChange={(v) => onChange(v as Block)} options={options} disabled={disabled} idPrefix={block.id} />
      {!disabled && options.aiAvailable && (
        <div className="space-y-2 rounded-md border border-dashed p-2.5">
          <Label htmlFor="ia-instr" className="text-xs">
            <SparklesIcon className="size-3.5" /> Melhorar os textos com IA
          </Label>
          <Input id="ia-instr" value={instruction} maxLength={300} onChange={(e) => setInstruction(e.target.value)} placeholder="Opcional: ex.: mais curto, foco em frotistas" />
          <Button size="sm" variant="outline" className="w-full" onClick={() => improve.mutate()} disabled={improve.isPending}>
            {improve.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Reescrever este bloco
          </Button>
        </div>
      )}
      {!disabled && (
        <div className="flex gap-2 border-t pt-3">
          <Button size="sm" variant="outline" onClick={onDuplicate}>
            <CopyIcon /> Duplicar
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
            <Trash2Icon /> Remover bloco
          </Button>
        </div>
      )}
    </div>
  )
}

function ColorInput({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9 w-11 cursor-pointer rounded-md border bg-transparent p-1" aria-label={`${label}: seletor`} />
        <Input id={id} value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} className="font-mono" disabled={disabled} />
      </div>
    </div>
  )
}

function ThemePanel({ theme, fonts, disabled, onChange }: { theme: Theme; fonts: string[]; disabled: boolean; onChange: (t: Theme) => void }) {
  const set = (p: Partial<Theme>) => onChange({ ...theme, ...p })
  const pick = <K extends keyof Theme>(key: K, label: string, opts: [string, string][]) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={String(theme[key])} onValueChange={(v) => set({ [key]: v } as Partial<Theme>)} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">As cores começam com as da marca (Configurações › Marca) e podem ser trocadas só nesta página.</p>
      <div className="grid grid-cols-2 gap-2">
        <ColorInput id="t-primary" label="Cor principal" value={theme.primary} onChange={(v) => set({ primary: v })} disabled={disabled} />
        <ColorInput id="t-accent" label="Cor dos botões" value={theme.accent} onChange={(v) => set({ accent: v })} disabled={disabled} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {pick('mode', 'Fundo da página', [
          ['claro', 'Claro'],
          ['escuro', 'Escuro'],
        ])}
        {pick(
          'font',
          'Fonte',
          fonts.map((f) => [f, f === 'Sistema' ? 'Do aparelho (mais rápida)' : f]),
        )}
        {pick('radius', 'Cantos', [
          ['reto', 'Retos'],
          ['suave', 'Levemente arredondados'],
          ['arredondado', 'Arredondados'],
        ])}
        {pick('button', 'Botões', [
          ['solido', 'Preenchidos'],
          ['contorno', 'Só contorno'],
          ['pilula', 'Pílula (bem redondos)'],
        ])}
        {pick('width', 'Largura do conteúdo', [
          ['normal', 'Normal'],
          ['larga', 'Larga'],
        ])}
        {pick('header', 'Topo da página', [
          ['logo-botao', 'Logo e botão'],
          ['logo', 'Só o logo'],
          ['nenhum', 'Sem topo'],
        ])}
      </div>
      {theme.header === 'logo-botao' && (
        <div className="space-y-1">
          <Label htmlFor="t-hcta" className="text-xs">
            Texto do botão do topo
          </Label>
          <Input id="t-hcta" value={theme.headerCta} maxLength={30} onChange={(e) => set({ headerCta: e.target.value })} disabled={disabled} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="t-wa" className="text-xs">
          WhatsApp dos botões (com DDD)
        </Label>
        <Input id="t-wa" value={theme.whatsapp} inputMode="tel" placeholder="55 49 98863-2548" onChange={(e) => set({ whatsapp: e.target.value.replace(/\D/g, '') })} disabled={disabled} />
        <p className="text-xs text-muted-foreground">Usado nos botões "Abrir o WhatsApp". Clique no WhatsApp não vira lead; é contado nas métricas.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="t-wam" className="text-xs">
          Mensagem que já vem escrita
        </Label>
        <Textarea id="t-wam" rows={2} value={theme.whatsappMessage} maxLength={300} onChange={(e) => set({ whatsappMessage: e.target.value })} disabled={disabled} />
        <p className="text-xs text-muted-foreground">{'{pagina}'} vira o nome da página.</p>
      </div>
    </div>
  )
}

function PagePanel({ draft, base, disabled, onChange, onVariant }: { draft: Draft; base: string; disabled: boolean; onChange: (d: Draft) => void; onVariant: (v: 'A' | 'B') => void }) {
  const seo = draft.seo
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="p-slug" className="text-xs">
          Endereço
        </Label>
        <div className="flex items-center gap-1 text-sm">
          <span className="shrink-0 text-muted-foreground">{base}</span>
          <Input id="p-slug" value={draft.slug} onChange={(e) => onChange({ ...draft, slug: slugify(e.target.value) })} disabled={disabled} />
        </div>
        <p className="text-xs text-muted-foreground">Mudar o endereço de uma página no ar quebra os anúncios que usam o antigo.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-title" className="text-xs">
          Título no Google e nas redes
        </Label>
        <Input id="p-title" value={seo.title} maxLength={70} placeholder={draft.name} onChange={(e) => onChange({ ...draft, seo: { ...seo, title: e.target.value } })} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-desc" className="text-xs">
          Descrição
        </Label>
        <Textarea id="p-desc" rows={2} value={seo.description} maxLength={170} onChange={(e) => onChange({ ...draft, seo: { ...seo, description: e.target.value } })} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-img" className="text-xs">
          Imagem de compartilhamento (https)
        </Label>
        <Input id="p-img" value={seo.image} onChange={(e) => onChange({ ...draft, seo: { ...seo, image: e.target.value } })} disabled={disabled} placeholder="https://… (1200 × 630)" />
      </div>
      <label className="flex items-start gap-3 rounded-md border p-2.5 text-sm">
        <Switch checked={seo.noindex} onCheckedChange={(v) => onChange({ ...draft, seo: { ...seo, noindex: v } })} disabled={disabled} aria-label="Não aparecer no Google" />
        <span>
          Não aparecer no Google
          <br />
          <span className="text-xs text-muted-foreground">Para páginas só de anúncio ou de obrigado.</span>
        </span>
      </label>
      <div className="space-y-2 rounded-md border p-2.5">
        <label className="flex items-start gap-3 text-sm">
          <Switch
            checked={draft.abActive}
            disabled={disabled}
            aria-label="Teste A/B"
            onCheckedChange={(on) => {
              onChange({ ...draft, abActive: on, blocksB: on ? (draft.blocksB ?? draft.blocks.map((b) => ({ ...b }))) : draft.blocksB })
              if (on) onVariant('B')
              else onVariant('A')
            }}
          />
          <span>
            Teste A/B
            <br />
            <span className="text-xs text-muted-foreground">Duas versões da página no mesmo endereço; cada visitante vê sempre a mesma. As métricas comparam visitantes, cliques, leads e vendas.</span>
          </span>
        </label>
        {draft.abActive && (
          <div className="space-y-1">
            <Label className="text-xs">Visitas que veem a versão B</Label>
            <Select value={String(draft.abSplit)} onValueChange={(v) => onChange({ ...draft, abSplit: Number(v) })} disabled={disabled}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.blocksB && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  onChange({ ...draft, blocksB: draft.blocks.map((b) => ({ ...b })) })
                  onVariant('B')
                }}
              >
                Copiar a versão A para a B de novo
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MetricsPanel({ pageId }: { pageId: string }) {
  const [days, setDays] = useState('30')
  const [to] = useState(() => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10))
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (Number(days) - 1) * 86_400_000).toISOString().slice(0, 10)
  const q = useQuery({ queryKey: ['landing-metricas', pageId, from, to], queryFn: () => api.get<LandingMetrics>(`/landing/${pageId}/metricas?de=${from}&ate=${to}`) })
  const m = q.data
  const n = (v: number) => v.toLocaleString('pt-BR')
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return (
    <div className="space-y-3">
      <Select value={days} onValueChange={setDays}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7">Últimos 7 dias</SelectItem>
          <SelectItem value="30">Últimos 30 dias</SelectItem>
          <SelectItem value="90">Últimos 90 dias</SelectItem>
        </SelectContent>
      </Select>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !m ? (
        <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Visitantes', n(m.totals.visitors)],
              ['Cliques (botão e WhatsApp)', n(m.totals.cta)],
              ['Leads', n(m.totals.leads)],
              ['Conversão', m.totals.visitors ? `${((m.totals.leads / m.totals.visitors) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'],
              ['Vendas (Pré-Vendas)', n(m.totals.sales)],
              ['Faturamento', brl(m.totals.revenue)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border p-2">
                <p className="text-[11px] text-muted-foreground">{k}</p>
                <p className="text-lg font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          {m.variants.length > 1 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versão</TableHead>
                  <TableHead className="text-right">Visit.</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.variants.map((v) => (
                  <TableRow key={v.variant}>
                    <TableCell>{v.variant}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(v.visitors)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(v.leads)}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.conversion === null ? '—' : `${v.conversion.toLocaleString('pt-BR')}%`}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(v.sales)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div>
            <p className="mb-1 text-xs font-medium">Origem das visitas</p>
            {m.bySource.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Origem / campanha</TableHead>
                    <TableHead className="text-right">Visit.</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.bySource.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-44">
                        <span className="block truncate text-sm">
                          {s.source}
                          {s.medium ? ` / ${s.medium}` : ''}
                        </span>
                        {s.campaign && <span className="block truncate text-xs text-muted-foreground">{s.campaign}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.visitors)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.leads)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Sem visitas no período.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Contagem do próprio CRM (sem dado pessoal). GA4, Meta e Google Ads também recebem as visitas e as conversões de quem aceitou os cookies. Vendas: atendimentos de Pré-Vendas marcados como venda dos leads desta página.</p>
        </>
      )}
    </div>
  )
}

/** Gerador de links com UTM: o mesmo endereço, marcado por canal, para saber de onde veio cada lead. */
function LinksPanel({ url, slug, published }: { url: string; slug: string; published: boolean }) {
  const [campaign, setCampaign] = useState(slug)
  const [content, setContent] = useState('')
  return (
    <div className="space-y-3">
      {!published && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">Publique a página antes de usar os links nos anúncios.</p>}
      <div className="space-y-1">
        <Label className="text-xs">Endereço da página</Label>
        <div className="flex gap-2">
          <Input readOnly value={url} className="font-mono text-xs" />
          <CopyButton text={url} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="utm-c" className="text-xs">
            Campanha (utm_campaign)
          </Label>
          <Input id="utm-c" value={campaign} onChange={(e) => setCampaign(slugify(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="utm-ct" className="text-xs">
            Anúncio / variação (opcional)
          </Label>
          <Input id="utm-ct" value={content} onChange={(e) => setContent(slugify(e.target.value))} placeholder="ex.: video-15s" />
        </div>
      </div>
      <div className="space-y-2">
        {UTM_CHANNELS.map((c) => {
          const link = utmUrl(url, c.source, c.medium, campaign, content)
          return (
            <div key={c.key} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{c.label}</span>
                <CopyButton text={link} />
              </div>
              <p className="break-all font-mono text-[11px] text-muted-foreground">{link}</p>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">No Google Ads, com a marcação automática (gclid) ligada, o CRM reconhece o anúncio mesmo sem UTM.</p>
    </div>
  )
}
