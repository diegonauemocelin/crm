import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CopyIcon, LayoutTemplateIcon, Loader2Icon, MonitorIcon, PlusIcon, RotateCcwIcon, SaveIcon, SmartphoneIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useParams } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import {
  type Align,
  type Block,
  BLOCK_INFO,
  type BlockType,
  type Box,
  type Design,
  type EditorData,
  type EditorKind,
  FONT_LABEL,
  fromLegacy,
  MOBILE_POSITION_LABEL,
  type Mobile,
  newBlock,
  POSITION_LABEL,
  SHADOW_LABEL,
  TEMPLATES,
  uid,
} from '@/lib/design'
import { cn } from '@/lib/utils'

const KIND_BY_PARAM: Record<string, EditorKind> = { popup: 'popup', formulario: 'form' }

export function CapturaEditorPage() {
  return (
    <RequirePermission module="captura">
      <Loader />
    </RequirePermission>
  )
}

function Loader() {
  const { tipo = '', id = '' } = useParams()
  const kind = KIND_BY_PARAM[tipo]
  const q = useQuery({ queryKey: ['captura-editor', tipo, id], queryFn: () => api.get<EditorData>(`/captura/editor/${tipo}/${id}`), enabled: !!kind, refetchOnWindowFocus: false })
  if (!kind) return <ErrorState error={new Error('Endereço inválido.')} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={8} />
  return <Editor key={q.data.id} data={q.data} param={tipo} />
}

function Editor({ data, param }: { data: EditorData; param: string }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const canEdit = can('captura', 'edit')
  const [design, setDesign] = useState<Design>(() => data.design ?? fromLegacy(data))
  const [saved, setSaved] = useState(() => JSON.stringify(data.design ?? null))
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState('blocos')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const dirty = JSON.stringify(design) !== saved
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)

  const setBox = (patch: Partial<Box>) => setDesign((d) => ({ ...d, box: { ...d.box, ...patch } }))
  const setMobile = (patch: Partial<Mobile>) => setDesign((d) => ({ ...d, mobile: { ...d.mobile, ...patch } }))
  const updateBlock = (id: string, patch: Partial<Block>) => setDesign((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)) }))
  const move = (id: string, dir: -1 | 1) =>
    setDesign((d) => {
      const i = d.blocks.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= d.blocks.length) return d
      const blocks = [...d.blocks]
      ;[blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!]
      return { ...d, blocks }
    })
  const remove = (id: string) => {
    setDesign((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }))
    if (selected === id) setSelected(null)
  }
  const duplicate = (id: string) =>
    setDesign((d) => {
      const i = d.blocks.findIndex((b) => b.id === id)
      const b = d.blocks[i]
      if (!b || b.type === 'formulario') return d
      const blocks = [...d.blocks]
      blocks.splice(i + 1, 0, { ...b, id: uid() })
      return { ...d, blocks }
    })
  const add = (type: BlockType) => {
    const accent = (design.blocks.find((b) => b.type === 'formulario') as Extract<Block, { type: 'formulario' }> | undefined)?.buttonBg
    const b = newBlock(type, accent)
    setDesign((d) => {
      // Novo bloco entra antes do formulário (título, texto, imagem) ou no fim (cupom, "não, obrigado").
      const formAt = d.blocks.findIndex((x) => x.type === 'formulario')
      const at = ['cupom', 'recusar', 'divisor', 'espaco'].includes(type) || formAt < 0 ? d.blocks.length : formAt
      const blocks = [...d.blocks]
      blocks.splice(at, 0, b)
      return { ...d, blocks }
    })
    setSelected(b.id)
    setTab('bloco')
  }

  const save = async () => {
    setBusy('save')
    try {
      const r = await api.put<EditorData>(`/captura/editor/${param}/${data.id}`, { design })
      setDesign(r.design!)
      setSaved(JSON.stringify(r.design))
      qc.setQueryData(['captura-editor', param, data.id], r)
      void qc.invalidateQueries({ queryKey: ['captura-popups'] })
      toast.success(data.active ? 'Layout salvo. Já vale no site.' : 'Layout salvo. Ative para aparecer no site.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const resetToSimple = async () => {
    setBusy('reset')
    try {
      const r = await api.put<EditorData>(`/captura/editor/${param}/${data.id}`, { design: null })
      setSaved(JSON.stringify(null))
      setDesign(fromLegacy(r))
      toast.success('Voltou ao layout simples.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
      setResetOpen(false)
    }
  }

  const onPreviewSelect = useCallback((id: string) => {
    setSelected(id)
    setTab('bloco')
  }, [])

  const block = design.blocks.find((b) => b.id === selected) ?? null
  const kindLabel = data.kind === 'popup' ? 'Pop-up' : 'Formulário'
  const back = data.kind === 'popup' ? '/captura?aba=popups' : '/captura?aba=formularios'

  return (
    <>
      <PageHeader
        title={`${kindLabel}: ${data.name}`}
        description={
          data.kind === 'popup'
            ? 'Monte o layout do pop-up. Quando e onde ele aparece continua nas configurações do pop-up.'
            : 'Monte o layout do formulário embutido na página. O código para colar continua o mesmo.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to={back}>
                <ArrowLeftIcon /> Captura
              </Link>
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
                  <LayoutTemplateIcon /> Modelos prontos
                </Button>
                {data.design && (
                  <Button variant="outline" onClick={() => setResetOpen(true)}>
                    <RotateCcwIcon /> Voltar ao simples
                  </Button>
                )}
                <Button onClick={() => void save()} disabled={busy !== null || !dirty}>
                  {busy === 'save' ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                  {dirty ? 'Salvar' : 'Salvo'}
                </Button>
              </>
            )}
          </div>
        }
      />
      {!data.design && (
        <p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Este {data.kind === 'popup' ? 'pop-up' : 'formulário'} ainda usa o layout simples. O editor começou com o que já existe; ao salvar, o novo layout passa a valer no site.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="self-start py-3">
          <CardContent className="px-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-3 grid w-full grid-cols-4">
                <TabsTrigger value="blocos">Blocos</TabsTrigger>
                <TabsTrigger value="bloco">Editar</TabsTrigger>
                <TabsTrigger value="caixa">Caixa</TabsTrigger>
                <TabsTrigger value="celular">Celular</TabsTrigger>
              </TabsList>
              <TabsContent value="blocos">
                <BlockList
                  design={design}
                  kind={data.kind}
                  selected={selected}
                  onSelect={(id) => {
                    setSelected(id)
                    setTab('bloco')
                  }}
                  onMove={move}
                  onRemove={remove}
                  onDuplicate={duplicate}
                  onAdd={add}
                  disabled={!canEdit}
                />
              </TabsContent>
              <TabsContent value="bloco">
                {block ? (
                  <BlockEditor key={block.id} block={block} form={data.form} onChange={(p) => updateBlock(block.id, p)} />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Clique num bloco da lista ou na prévia para editar.</p>
                )}
              </TabsContent>
              <TabsContent value="caixa">
                <BoxEditor box={design.box} kind={data.kind} onChange={setBox} />
              </TabsContent>
              <TabsContent value="celular">
                <MobileEditor mobile={design.mobile} kind={data.kind} onChange={setMobile} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="self-start py-3 xl:sticky xl:top-4">
          <CardContent className="space-y-3 px-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ToggleGroup type="single" variant="outline" size="sm" value={device} onValueChange={(v) => v && setDevice(v as typeof device)} aria-label="Aparelho da prévia">
                <ToggleGroupItem value="desktop" className="px-3">
                  <MonitorIcon /> Computador
                </ToggleGroupItem>
                <ToggleGroupItem value="mobile" className="px-3">
                  <SmartphoneIcon /> Celular
                </ToggleGroupItem>
              </ToggleGroup>
              <span className="text-xs text-muted-foreground">Prévia com o mesmo código do site. Pode testar: o envio aqui não grava nada.</span>
            </div>
            <PreviewFrame data={data} design={design} device={device} onSelect={onPreviewSelect} />
          </CardContent>
        </Card>
      </div>

      <TemplatesDialog
        open={templatesOpen}
        kind={data.kind}
        onClose={() => setTemplatesOpen(false)}
        onPick={(d) => {
          setDesign(d)
          setSelected(null)
          setTemplatesOpen(false)
          setTab('blocos')
        }}
      />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar ao layout simples?</AlertDialogTitle>
            <AlertDialogDescription>O site volta a mostrar o {data.kind === 'popup' ? 'pop-up' : 'formulário'} no modelo simples. O layout do editor é descartado.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void resetToSimple()} disabled={busy !== null}>
              Voltar ao simples
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>As mudanças no layout ainda não foram salvas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Sair sem salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------- Prévia ----------------

const FRAME = { desktop: { w: 1200, h: 720 }, mobile: { w: 390, h: 760 } }
// Página de fundo genérica (linhas cinzas imitando conteúdo) e o mesmo script de desenho do site.
const SRCDOC = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;min-height:100%}body{min-height:100vh;background:#f8fafc repeating-linear-gradient(180deg,transparent 0 46px,#e2e8f0 46px 58px);background-size:100% 58px;background-position:0 90px}
</style></head><body><script src="/api/captura/previa.js"></script></body></html>`

function PreviewFrame({ data, design, device, onSelect }: { data: EditorData; design: Design; device: 'desktop' | 'mobile'; onSelect: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(800)
  // Conta os carregamentos do quadro (trocar computador/celular cria um quadro novo).
  const [loads, setLoads] = useState(0)
  const size = FRAME[device]
  const scale = Math.min(1, width / size.w)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const id = (e.data as { crmBlock?: unknown } | null)?.crmBlock
      if (typeof id === 'string') onSelect(id)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onSelect])

  // Cada mudança redesenha a prévia (com um pequeno atraso para não piscar ao digitar).
  const cfg = useMemo(
    () => ({
      privacyUrl: data.privacyUrl,
      form: data.form,
      popup: data.kind === 'popup' && data.popup ? { ...data.popup, frequencyDays: 0, design } : null,
      design,
    }),
    [data, design],
  )
  useEffect(() => {
    if (!loads) return
    const t = setTimeout(() => {
      const w = frame.current?.contentWindow as (Window & { __crmPreview?: (c: unknown) => void }) | null
      if (!w?.__crmPreview) return
      const f = { ...cfg.form, design: data.kind === 'form' ? cfg.design : null }
      w.__crmPreview({ privacyUrl: cfg.privacyUrl, form: f, popup: cfg.popup })
    }, 150)
    return () => clearTimeout(t)
  }, [cfg, loads, data.kind])

  return (
    <div ref={wrap} className="w-full overflow-hidden rounded-md border bg-muted/30" style={{ height: size.h * scale }}>
      <iframe
        key={device}
        ref={frame}
        title="Prévia"
        srcDoc={SRCDOC}
        onLoad={() => setLoads((n) => n + 1)}
        className="origin-top-left border-0 bg-white"
        style={{ width: size.w, height: size.h, transform: `scale(${scale})`, marginLeft: device === 'mobile' ? Math.max(0, (width - size.w * scale) / 2) : 0 }}
      />
    </div>
  )
}

// ---------------- Blocos ----------------

function summary(b: Block) {
  if (b.type === 'titulo' || b.type === 'texto' || b.type === 'recusar') return b.text
  if (b.type === 'imagem') return b.url ? 'Imagem definida' : 'Sem imagem (escolha uma)'
  if (b.type === 'cupom') return `${b.code}${b.afterSubmit ? ' · aparece depois do envio' : ''}`
  if (b.type === 'formulario') return `${b.columns === 2 ? '2 colunas' : '1 coluna'} · botão ${b.buttonText ?? 'do formulário'}`
  if (b.type === 'espaco') return `${b.height} px`
  return ''
}

function BlockList({
  design,
  kind,
  selected,
  onSelect,
  onMove,
  onRemove,
  onDuplicate,
  onAdd,
  disabled,
}: {
  design: Design
  kind: EditorKind
  selected: string | null
  onSelect: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  onDuplicate: (id: string) => void
  onAdd: (t: BlockType) => void
  disabled: boolean
}) {
  const types = (Object.keys(BLOCK_INFO) as BlockType[]).filter((t) => !(BLOCK_INFO[t].popupOnly && kind !== 'popup') && !(BLOCK_INFO[t].unique && design.blocks.some((b) => b.type === t)))
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {design.blocks.map((b, i) => {
          const info = BLOCK_INFO[b.type]
          const Icon = info.icon
          return (
            <li
              key={b.id}
              className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', selected === b.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
            >
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(b.id)}>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{info.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{summary(b)}</span>
                </span>
              </button>
              {!disabled && (
                <span className="flex shrink-0">
                  <Button variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => onMove(b.id, -1)} aria-label="Subir">
                    <ArrowUpIcon />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={i === design.blocks.length - 1} onClick={() => onMove(b.id, 1)} aria-label="Descer">
                    <ArrowDownIcon />
                  </Button>
                  {b.type !== 'formulario' && (
                    <>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => onDuplicate(b.id)} aria-label="Duplicar">
                        <CopyIcon />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => onRemove(b.id)} aria-label="Remover">
                        <Trash2Icon />
                      </Button>
                    </>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {!disabled && design.blocks.length < 20 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="w-full">
              <PlusIcon /> Adicionar bloco
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {types.map((t) => {
              const Icon = BLOCK_INFO[t].icon
              return (
                <DropdownMenuItem key={t} onSelect={() => onAdd(t)}>
                  <Icon />
                  <span>
                    <span className="block">{BLOCK_INFO[t].label}</span>
                    <span className="block text-xs text-muted-foreground">{BLOCK_INFO[t].hint}</span>
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <p className="text-xs text-muted-foreground">Dica: clique em qualquer parte da prévia para editar aquele bloco.</p>
    </div>
  )
}

// ---------------- Campos de edição ----------------

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5" />
        <Input
          className="h-8 font-mono text-xs"
          value={text}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value)
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase())
          }}
        />
      </div>
    </Row>
  )
}

function RangeField({ label, value, min, max, step = 1, unit = 'px', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <Row label={`${label}: ${value}${unit}`}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </Row>
  )
}

function SwitchField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

function AlignField({ value, onChange }: { value: Align; onChange: (v: Align) => void }) {
  return (
    <Row label="Alinhamento">
      <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v as Align)}>
        <ToggleGroupItem value="esquerda" className="px-3">Esquerda</ToggleGroupItem>
        <ToggleGroupItem value="centro" className="px-3">Centro</ToggleGroupItem>
        <ToggleGroupItem value="direita" className="px-3">Direita</ToggleGroupItem>
      </ToggleGroup>
    </Row>
  )
}

function ChoiceField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <Row label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(options) as T[]).map((k) => (
            <SelectItem key={k} value={k}>
              {options[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  )
}

function BlockEditor({ block: b, form, onChange }: { block: Block; form: EditorData['form']; onChange: (p: Partial<Block>) => void }) {
  const info = BLOCK_INFO[b.type]
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{info.label}</p>
      {b.type === 'titulo' && (
        <>
          <Row label="Texto">
            <Input value={b.text} maxLength={160} onChange={(e) => onChange({ text: e.target.value })} />
          </Row>
          <RangeField label="Tamanho" value={b.size} min={14} max={48} onChange={(size) => onChange({ size })} />
          <AlignField value={b.align} onChange={(align) => onChange({ align })} />
          <ColorField label="Cor" value={b.color} onChange={(color) => onChange({ color })} />
          <SwitchField label="Negrito" checked={b.bold} onChange={(bold) => onChange({ bold })} />
        </>
      )}
      {b.type === 'texto' && (
        <>
          <Row label="Texto" hint="Quebras de linha aparecem no site.">
            <Textarea rows={4} value={b.text} maxLength={1000} onChange={(e) => onChange({ text: e.target.value })} />
          </Row>
          <RangeField label="Tamanho" value={b.size} min={11} max={24} onChange={(size) => onChange({ size })} />
          <AlignField value={b.align} onChange={(align) => onChange({ align })} />
          <ColorField label="Cor" value={b.color} onChange={(color) => onChange({ color })} />
        </>
      )}
      {b.type === 'imagem' && <ImageEditor block={b} onChange={onChange} />}
      {b.type === 'formulario' && (
        <>
          <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Campos do formulário “{form.name}”: {form.fields.map((f) => f.label).join(', ')}. Para mudar os campos, a mensagem de sucesso ou o consentimento, edite o formulário na aba Formulários.
          </p>
          <Row label="Texto do botão" hint={`Vazio usa o do formulário (“${form.submitLabel}”).`}>
            <Input value={b.buttonText ?? ''} maxLength={60} placeholder={form.submitLabel} onChange={(e) => onChange({ buttonText: e.target.value || null })} />
          </Row>
          <ColorField label="Cor do botão" value={b.buttonBg} onChange={(buttonBg) => onChange({ buttonBg })} />
          <ColorField label="Cor do texto do botão" value={b.buttonColor} onChange={(buttonColor) => onChange({ buttonColor })} />
          <RangeField label="Cantos do botão" value={b.buttonRadius} min={0} max={40} onChange={(buttonRadius) => onChange({ buttonRadius })} />
          <SwitchField label="Botão na largura toda" checked={b.buttonFull} onChange={(buttonFull) => onChange({ buttonFull })} />
          <SwitchField label="Campos em 2 colunas" hint="No celular fica sempre 1 coluna." checked={b.columns === 2} onChange={(v) => onChange({ columns: v ? 2 : 1 })} />
          <SwitchField label="Mostrar o nome acima dos campos" hint="Desligado, o nome vai dentro do campo." checked={b.showLabels} onChange={(showLabels) => onChange({ showLabels })} />
          <ColorField label="Cor dos nomes dos campos" value={b.labelColor} onChange={(labelColor) => onChange({ labelColor })} />
          <ColorField label="Fundo dos campos" value={b.inputBg} onChange={(inputBg) => onChange({ inputBg })} />
          <ColorField label="Borda dos campos" value={b.inputBorder} onChange={(inputBorder) => onChange({ inputBorder })} />
          <RangeField label="Cantos dos campos" value={b.inputRadius} min={0} max={24} onChange={(inputRadius) => onChange({ inputRadius })} />
        </>
      )}
      {b.type === 'cupom' && (
        <>
          <Row label="Código do cupom" hint="Só letras, números, hífen e sublinhado. Crie o mesmo cupom na loja virtual.">
            <Input value={b.code} maxLength={40} className="font-mono uppercase" onChange={(e) => onChange({ code: e.target.value.toUpperCase() })} />
          </Row>
          <Row label="Texto acima do código">
            <Input value={b.label} maxLength={120} onChange={(e) => onChange({ label: e.target.value })} />
          </Row>
          <SwitchField label="Mostrar só depois do envio" hint="O visitante só vê o cupom depois de se cadastrar." checked={b.afterSubmit} onChange={(afterSubmit) => onChange({ afterSubmit })} />
          <ColorField label="Fundo" value={b.bg} onChange={(bg) => onChange({ bg })} />
          <ColorField label="Cor do texto" value={b.color} onChange={(color) => onChange({ color })} />
        </>
      )}
      {b.type === 'espaco' && <RangeField label="Altura" value={b.height} min={4} max={80} onChange={(height) => onChange({ height })} />}
      {b.type === 'divisor' && <ColorField label="Cor da linha" value={b.color} onChange={(color) => onChange({ color })} />}
      {b.type === 'recusar' && (
        <>
          <Row label="Texto do link" hint="Fecha o pop-up (e ele não volta pelos dias definidos nas configurações).">
            <Input value={b.text} maxLength={80} onChange={(e) => onChange({ text: e.target.value })} />
          </Row>
          <ColorField label="Cor" value={b.color} onChange={(color) => onChange({ color })} />
        </>
      )}
    </div>
  )
}

function ImageEditor({ block: b, onChange }: { block: Extract<Block, { type: 'imagem' }>; onChange: (p: Partial<Block>) => void }) {
  const qc = useQueryClient()
  const gallery = useQuery({ queryKey: ['captura-imagens'], queryFn: () => api.get<{ id: string; url: string }[]>('/captura/imagens') })
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const r = await api.post<{ url: string }>('/captura/imagens', body)
      onChange({ url: r.url })
      void qc.invalidateQueries({ queryKey: ['captura-imagens'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <>
      <div className="space-y-2">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Enviar imagem do computador
        </Button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        <p className="text-xs text-muted-foreground">PNG, JPG, GIF ou WEBP até 1,5 MB.</p>
      </div>
      {!!gallery.data?.length && (
        <Row label="Ou escolha uma já enviada">
          <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto">
            {gallery.data.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onChange({ url: g.url })}
                className={cn('aspect-square overflow-hidden rounded border', b.url === g.url && 'ring-2 ring-primary')}
                aria-label="Usar esta imagem"
              >
                <img src={g.url} alt="" className="size-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </Row>
      )}
      <Row label="Ou cole o endereço (https://)">
        <Input value={b.url} placeholder="https://" onChange={(e) => onChange({ url: e.target.value.trim() })} />
      </Row>
      <RangeField label="Altura" value={b.height} min={60} max={480} onChange={(height) => onChange({ height })} />
      <ChoiceField label="Encaixe" value={b.fit} options={{ cobrir: 'Preencher (corta as bordas)', conter: 'Mostrar inteira' }} onChange={(fit) => onChange({ fit })} />
      <SwitchField label="De ponta a ponta" hint="Encosta nas bordas da caixa (no topo, fica sem margem)." checked={b.bleed} onChange={(bleed) => onChange({ bleed })} />
      {!b.bleed && <RangeField label="Cantos" value={b.radius} min={0} max={32} onChange={(radius) => onChange({ radius })} />}
      <Row label="Link ao clicar (opcional)">
        <Input value={b.link ?? ''} placeholder="https://" onChange={(e) => onChange({ link: e.target.value.trim() || null })} />
      </Row>
    </>
  )
}

function BoxEditor({ box, kind, onChange }: { box: Box; kind: EditorKind; onChange: (p: Partial<Box>) => void }) {
  return (
    <div className="space-y-4">
      {kind === 'popup' && <ChoiceField label="Posição na tela (computador)" value={box.position} options={POSITION_LABEL} onChange={(position) => onChange({ position })} />}
      <RangeField label="Largura máxima" value={box.width} min={280} max={760} step={10} onChange={(width) => onChange({ width })} />
      <RangeField label="Espaço interno" value={box.padding} min={8} max={48} onChange={(padding) => onChange({ padding })} />
      <RangeField label="Cantos arredondados" value={box.radius} min={0} max={32} onChange={(radius) => onChange({ radius })} />
      <ChoiceField label="Sombra" value={box.shadow} options={SHADOW_LABEL} onChange={(shadow) => onChange({ shadow })} />
      <ChoiceField label="Fonte" value={box.font} options={FONT_LABEL} onChange={(font) => onChange({ font })} />
      <ColorField label="Fundo da caixa" value={box.bg} onChange={(bg) => onChange({ bg })} />
      <ColorField label="Cor do texto" value={box.text} onChange={(text) => onChange({ text })} />
      {kind === 'popup' && (
        <>
          <ColorField label="Cor do botão de fechar (×)" value={box.closeColor} onChange={(closeColor) => onChange({ closeColor })} />
          <SwitchField label="Escurecer o site atrás" hint="Só no centro da tela; nos cantos o site continua clicável." checked={box.overlay} onChange={(overlay) => onChange({ overlay })} />
          {box.overlay && <RangeField label="Escurecimento" value={box.overlayOpacity} min={0} max={90} unit="%" onChange={(overlayOpacity) => onChange({ overlayOpacity })} />}
        </>
      )}
    </div>
  )
}

function MobileEditor({ mobile, kind, onChange }: { mobile: Mobile; kind: EditorKind; onChange: (p: Partial<Mobile>) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Ajustes que valem só no celular. Veja o resultado com a prévia em “Celular”.</p>
      {kind === 'popup' && <ChoiceField label="Posição no celular" value={mobile.position} options={MOBILE_POSITION_LABEL} onChange={(position) => onChange({ position })} />}
      <RangeField label="Tamanho dos textos" value={mobile.fontScale} min={80} max={120} unit="%" onChange={(fontScale) => onChange({ fontScale })} />
      <SwitchField label="Esconder imagens" hint="Deixa o pop-up mais curto em telas pequenas." checked={mobile.hideImages} onChange={(hideImages) => onChange({ hideImages })} />
    </div>
  )
}

function TemplatesDialog({ open, kind, onClose, onPick }: { open: boolean; kind: EditorKind; onClose: () => void; onPick: (d: Design) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modelos prontos</DialogTitle>
          <DialogDescription>Escolha um ponto de partida. Ele substitui o layout atual (só vale depois de Salvar).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const d = t.build(kind)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t.build(kind))}
                className="rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="mb-2 flex h-20 items-center justify-center rounded-md" style={{ background: d.box.bg, color: d.box.text, border: '1px solid #e2e8f0' }}>
                  <span className="px-2 text-center text-sm font-semibold">{(d.blocks.find((b) => b.type === 'titulo') as Extract<Block, { type: 'titulo' }> | undefined)?.text}</span>
                </div>
                <p className="flex items-center gap-2 font-medium">
                  {t.name}
                  {d.box.position !== 'centro' && kind === 'popup' && <Badge variant="outline">canto</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
                {t.tip && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t.tip}</p>}
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
