import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  BoldIcon,
  CalendarClockIcon,
  CopyIcon,
  EyeIcon,
  GripVerticalIcon,
  HeadingIcon,
  HighlighterIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  Loader2Icon,
  MessageCircleIcon,
  MinusIcon,
  MonitorIcon,
  MousePointerClickIcon,
  MoveVerticalIcon,
  PaletteIcon,
  PlusIcon,
  RefreshCwIcon,
  RemoveFormattingIcon,
  SearchIcon,
  SendIcon,
  ShoppingBagIcon,
  SmartphoneIcon,
  StrikethroughIcon,
  Trash2Icon,
  TypeIcon,
  UnderlineIcon,
  UploadIcon,
  UserIcon,
  XIcon,
} from 'lucide-react'
import { type DragEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { formatDateTime, PageHeader } from '@/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import {
  type Align,
  type Block,
  BLOCK_LABEL,
  type BlockType,
  type Campaign,
  type EmailImage,
  type EmailSettings,
  formatBRL,
  newBlock,
  type ProductItem,
  productItem,
  type ProductSearch,
  type Segment,
  type WhatsappNumber,
} from '@/lib/email'
import { cleanRich, legacyToHtml } from '@/lib/rich-text'
import { cn } from '@/lib/utils'

const NONE = '__none__'

// ---------- Arrastar e soltar ----------

type Payload = { kind: 'move'; id: string } | { kind: 'new'; type: BlockType } | { kind: 'image'; url: string } | { kind: 'product'; item: ProductItem }

/** O que está sendo arrastado agora (o navegador só deixa ler os dados no "soltar"). */
let dragging: Payload | null = null

function startDrag(e: DragEvent, p: Payload) {
  dragging = p
  e.dataTransfer.effectAllowed = p.kind === 'move' ? 'move' : 'copy'
  e.dataTransfer.setData('text/plain', 'crm-email')
}

type Target = { at: number } | { on: number } | null

interface Item {
  id: string
  b: Block
}

/** Identificador só da tela (não vai para o servidor); aleatório para nunca repetir. */
const nextId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `b${Date.now()}${Math.random().toString(36).slice(2)}`)

/** Blocos salvos no formato antigo (texto com **negrito**) viram HTML do editor. */
function normalize(b: Block): Block {
  if ((b.type === 'titulo' || b.type === 'texto') && typeof b.html !== 'string') return { ...b, html: legacyToHtml((b as { text?: string }).text ?? '') }
  return b
}

const BLOCK_ICON: Record<BlockType, typeof TypeIcon> = {
  titulo: HeadingIcon,
  texto: TypeIcon,
  imagem: ImageIcon,
  botao: MousePointerClickIcon,
  whatsapp: MessageCircleIcon,
  produtos: ShoppingBagIcon,
  divisor: MinusIcon,
  espaco: MoveVerticalIcon,
}

// ---------- Editor ----------

export function Editor({ campaign }: { campaign: Campaign }) {
  const qc = useQueryClient()
  const { can, me } = useAuth()
  const canEdit = can('email_marketing', 'edit')
  const segments = useQuery({ queryKey: ['email-segments'], queryFn: () => api.get<Segment[]>('/email/segmentos') })
  const settings = useQuery({ queryKey: ['email-settings'], queryFn: () => api.get<EmailSettings>('/email/configuracoes') })
  const numbers = useQuery({ queryKey: ['email-whatsapp'], queryFn: () => api.get<WhatsappNumber[]>('/email/whatsapp') })
  const [c, setC] = useState(campaign)
  const [items, setItems] = useState<Item[]>(() => campaign.blocks.map((b) => ({ id: nextId(), b: normalize(b) })))
  const [sel, setSel] = useState<string | null>(null)
  const [tab, setTab] = useState('blocos')
  const [dirty, setDirty] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [testTo, setTestTo] = useState(me?.email ?? '')
  const [confirmSend, setConfirmSend] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const set = <K extends keyof Campaign>(k: K, v: Campaign[K]) => {
    setC((x) => ({ ...x, [k]: v }))
    setDirty(true)
  }
  const segment = segments.data?.find((s) => s.id === c.segmentId)
  const isModel = campaign.kind === 'MODELO'
  const blocks = items.map((i) => i.b)
  const selected = items.find((i) => i.id === sel) ?? null

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const change = (fn: (x: Item[]) => Item[]) => {
    setItems(fn)
    setDirty(true)
  }
  const updateBlock = (id: string, b: Block) => change((x) => x.map((i) => (i.id === id ? { ...i, b } : i)))
  const insert = (at: number, b: Block) => {
    const id = nextId()
    change((x) => [...x.slice(0, at), { id, b }, ...x.slice(at)])
    setSel(id)
    setTab('editar')
  }
  const insertAfterSelected = (b: Block) => insert(selected ? items.indexOf(selected) + 1 : items.length, b)
  const move = (id: string, to: number) =>
    change((x) => {
      const from = x.findIndex((i) => i.id === id)
      if (from < 0) return x
      const n = [...x]
      const [it] = n.splice(from, 1)
      n.splice(to > from ? to - 1 : to, 0, it!)
      return n
    })
  const remove = (id: string) => {
    change((x) => x.filter((i) => i.id !== id))
    if (sel === id) setSel(null)
  }
  const duplicate = (id: string) => {
    const at = items.findIndex((i) => i.id === id)
    if (at >= 0) insert(at + 1, structuredClone(items[at]!.b))
  }
  const select = (id: string | null) => {
    setSel(id)
    if (id) setTab('editar')
  }

  const addImage = (url: string) => {
    if (selected?.b.type === 'imagem') updateBlock(selected.id, { ...selected.b, url })
    else insertAfterSelected({ type: 'imagem', url, alt: '', width: 100 })
  }
  const addProduct = (item: ProductItem) => {
    if (selected?.b.type === 'produtos') {
      if (selected.b.items.length >= 12) return toast.error('No máximo 12 produtos por bloco.')
      updateBlock(selected.id, { ...selected.b, items: [...selected.b.items, item] })
      toast.success('Produto adicionado ao bloco selecionado.')
    } else insertAfterSelected({ type: 'produtos', columns: 3, items: [item] })
  }

  const upload = useImageUpload()
  const drop = async (target: Target, files: File[]) => {
    const p = dragging
    dragging = null
    if (!target) return
    if (!p) {
      // Arquivo arrastado do computador: envia e coloca no e-mail.
      const at = 'at' in target ? target.at : target.on
      for (const f of files.filter((x) => x.type.startsWith('image/')).reverse()) {
        const img = await upload.mutateAsync(f).catch(() => null)
        if (img) insert(at, { type: 'imagem', url: img.url, alt: '', width: 100 })
      }
      return
    }
    if ('on' in target) {
      const it = items[target.on]
      if (it && p.kind === 'image' && it.b.type === 'imagem') return updateBlock(it.id, { ...it.b, url: p.url })
      if (it && p.kind === 'product' && it.b.type === 'produtos') {
        if (it.b.items.length >= 12) return toast.error('No máximo 12 produtos por bloco.')
        return updateBlock(it.id, { ...it.b, items: [...it.b.items, p.item] })
      }
      return
    }
    if (p.kind === 'move') return move(p.id, target.at)
    if (p.kind === 'new') return insert(target.at, newBlock(p.type, numbers.data?.[0]?.phone ?? ''))
    if (p.kind === 'image') return insert(target.at, { type: 'imagem', url: p.url, alt: '', width: 100 })
    insert(target.at, { type: 'produtos', columns: 3, items: [p.item] })
  }

  const body = () => ({ name: c.name, subject: c.subject, preheader: c.preheader || null, fromName: c.fromName || null, replyTo: c.replyTo || null, segmentId: c.segmentId, blocks })
  const persist = async () => {
    await api.put<Campaign>(`/email/campanhas/${campaign.id}`, body())
    setDirty(false)
    void qc.invalidateQueries({ queryKey: ['email-campaigns'] })
  }
  const save = useMutation({ mutationFn: persist, onSuccess: () => toast.success('Campanha salva.'), onError: (err) => toast.error(errorMessage(err)) })
  const test = useMutation({
    mutationFn: async () => {
      await persist()
      return api.post(`/email/campanhas/${campaign.id}/teste`, { to: testTo })
    },
    onSuccess: () => {
      toast.success(`Teste enviado para ${testTo}.`)
      setTestOpen(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const start = useMutation({
    mutationFn: async (when: string | null) => {
      await persist()
      return api.post<{ total: number; status: string }>(`/email/campanhas/${campaign.id}/enviar`, { scheduledAt: when ? new Date(when).toISOString() : null })
    },
    onSuccess: (r) => {
      toast.success(r.status === 'AGENDADA' ? `Agendada para ${int.format(r.total)} destinatário(s).` : `Envio iniciado para ${int.format(r.total)} destinatário(s).`)
      void qc.invalidateQueries({ queryKey: ['email-campaign', campaign.id] })
      void qc.invalidateQueries({ queryKey: ['email-campaigns'] })
      setConfirmSend(false)
    },
    onError: (err) => {
      setConfirmSend(false)
      toast.error(errorMessage(err))
    },
  })

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
        <Link to={isModel ? '/email-marketing?aba=modelos' : '/email-marketing'}>
          <ArrowLeftIcon /> {isModel ? 'Modelos' : 'Campanhas'}
        </Link>
      </Button>
      <PageHeader
        title={c.name || 'Campanha'}
        description={
          isModel
            ? `Modelo usado pelas automações${campaign.sent ? ` · ${int.format(campaign.sent)} envio(s), ${campaign.sent ? Math.round((campaign.opens / campaign.sent) * 100) : 0}% abriram` : ''}. Arraste blocos, imagens e produtos; as mudanças valem para os próximos envios.`
            : campaign.status === 'AGENDADA' && campaign.scheduledAt
            ? `Agendada para ${formatDateTime(campaign.scheduledAt)}`
            : 'Arraste blocos, imagens e produtos para o e-mail. Clique em um bloco para editar.'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <EyeIcon /> Ver como fica
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setTestOpen(true)}>
                  <SendIcon /> Teste
                </Button>
                <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending && <Loader2Icon className="animate-spin" />}
                  Salvar{dirty ? ' *' : ''}
                </Button>
                {!isModel && (
                  <Button onClick={() => setConfirmSend(true)} disabled={!c.segmentId || !c.subject.trim() || !items.length}>
                    <SendIcon /> Enviar
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Nome interno" htmlFor="c-name">
            <Input id="c-name" maxLength={120} value={c.name} onChange={(e) => set('name', e.target.value)} disabled={!canEdit} />
          </Field>
          {!isModel && (
          <Field label="Segmento (quem recebe)" htmlFor="c-seg" hint={segment ? `${int.format(segment.eligible)} podem receber agora.` : 'Crie segmentos na aba Segmentos.'}>
            <Select value={c.segmentId ?? NONE} onValueChange={(v) => set('segmentId', v === NONE ? null : v)} disabled={!canEdit}>
              <SelectTrigger id="c-seg" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Escolha o segmento</SelectItem>
                {(segments.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({int.format(s.eligible)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          )}
          <Field label="Assunto" htmlFor="c-subject" hint="Use {primeiro_nome} para personalizar.">
            <Input id="c-subject" maxLength={200} placeholder="Ex.: {primeiro_nome}, peças JCB com frete grátis" value={c.subject} onChange={(e) => set('subject', e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="Pré-cabeçalho" htmlFor="c-pre" hint="Aparece ao lado do assunto na caixa de entrada.">
            <Input id="c-pre" maxLength={200} value={c.preheader ?? ''} onChange={(e) => set('preheader', e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="Nome do remetente (opcional)" htmlFor="c-from">
            <Input id="c-from" maxLength={80} placeholder="Padrão das configurações" value={c.fromName ?? ''} onChange={(e) => set('fromName', e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="Responder para (opcional)" htmlFor="c-reply">
            <Input id="c-reply" type="email" placeholder="Padrão das configurações" value={c.replyTo ?? ''} onChange={(e) => set('replyTo', e.target.value)} disabled={!canEdit} />
          </Field>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-2">
          {canEdit && <FormatBar active={selected?.b.type === 'titulo' || selected?.b.type === 'texto'} />}
          <Canvas
            items={items}
            sel={sel}
            canEdit={canEdit}
            settings={settings.data}
            onSelect={select}
            onChange={updateBlock}
            onMove={(id, d) => {
              const i = items.findIndex((x) => x.id === id)
              move(id, d < 0 ? i - 1 : i + 2)
            }}
            onDuplicate={duplicate}
            onRemove={remove}
            onDrop={drop}
          />
        </div>

        <Card className="h-fit gap-0 overflow-hidden py-0 lg:sticky lg:top-4">
          <Tabs value={tab} onValueChange={setTab} className="gap-0">
            <TabsList className="m-2 grid w-auto grid-cols-4">
              <TabsTrigger value="blocos">Blocos</TabsTrigger>
              <TabsTrigger value="imagens">Imagens</TabsTrigger>
              <TabsTrigger value="produtos">Produtos</TabsTrigger>
              <TabsTrigger value="editar" disabled={!selected}>
                Editar
              </TabsTrigger>
            </TabsList>
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto border-t p-3">
              <TabsContent value="blocos">
                <BlocksPanel canEdit={canEdit} onAdd={(t) => insertAfterSelected(newBlock(t, numbers.data?.[0]?.phone ?? ''))} />
              </TabsContent>
              <TabsContent value="imagens">
                <ImagesPanel canEdit={canEdit} onPick={addImage} replacing={selected?.b.type === 'imagem'} />
              </TabsContent>
              <TabsContent value="produtos">
                <ProductsPanel canEdit={canEdit} onPick={addProduct} intoSelected={selected?.b.type === 'produtos'} />
              </TabsContent>
              <TabsContent value="editar">
                {selected ? (
                  <Inspector key={selected.id} block={selected.b} numbers={numbers.data ?? []} disabled={!canEdit} onChange={(b) => updateBlock(selected.id, b)} onPickImage={() => setTab('imagens')} />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Clique em um bloco do e-mail para editar.</p>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </Card>
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} subject={c.subject} preheader={c.preheader} blocks={blocks} />

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar um teste</DialogTitle>
            <DialogDescription>Salva a campanha e envia para o endereço abaixo, com [TESTE] no assunto. Não conta no relatório.</DialogDescription>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              test.mutate()
            }}
          >
            <Input type="email" aria-label="E-mail para o teste" value={testTo} onChange={(e) => setTestTo(e.target.value)} required />
            <Button type="submit" disabled={test.isPending || !testTo}>
              {test.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar “{c.subject || c.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai para <strong>{segment ? int.format(segment.eligible) : '—'}</strong> lead(s) do segmento “{segment?.name ?? '—'}” que autorizaram receber e-mails. Depois de começar, dá para pausar, mas não para desfazer o que já saiu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="c-when" className="flex items-center gap-1">
              <CalendarClockIcon className="size-4" /> Agendar (opcional)
            </Label>
            <Input id="c-when" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                start.mutate(scheduleAt || null)
              }}
              disabled={start.isPending}
            >
              {start.isPending && <Loader2Icon className="animate-spin" />}
              {scheduleAt ? 'Agendar envio' : 'Enviar agora'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ---------- Tela do e-mail (arrastar, soltar, editar no lugar) ----------

const HEX = /^#[0-9a-fA-F]{6}$/

function Canvas(props: {
  items: Item[]
  sel: string | null
  canEdit: boolean
  settings: EmailSettings | undefined
  onSelect: (id: string | null) => void
  onChange: (id: string, b: Block) => void
  onMove: (id: string, d: -1 | 1) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  onDrop: (t: Target, files: File[]) => void
}) {
  const { items, sel, canEdit, settings } = props
  const branding = useBranding()
  const brand = HEX.test(branding.primaryColor) ? branding.primaryColor : '#1d4ed8'
  const [target, setTarget] = useState<Target>(null)

  useEffect(() => {
    const end = () => {
      dragging = null
      setTarget(null)
    }
    document.addEventListener('dragend', end)
    return () => document.removeEventListener('dragend', end)
  }, [])

  const accepts = (e: DragEvent) => canEdit && (!!dragging || e.dataTransfer.types.includes('Files'))

  return (
    <div
      className="rounded-lg border bg-[#f4f5f7] p-3 sm:p-6"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault()
        if (e.target === e.currentTarget) props.onSelect(null)
      }}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        if (e.target === e.currentTarget) setTarget({ at: items.length })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget(null)
      }}
      onDrop={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        const t = target ?? { at: items.length }
        setTarget(null)
        props.onDrop(t, Array.from(e.dataTransfer.files))
      }}
    >
      <div className="mx-auto w-full max-w-[600px] rounded-lg bg-white text-[#374151] shadow-sm" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="flex justify-center px-8 pt-6 pb-2">
          {settings?.logoUrl ? (
            <img src={settings.logoUrl} alt={branding.appName} className="h-12 w-auto max-w-[260px]" />
          ) : (
            <span className="text-xl font-bold" style={{ color: brand }}>
              {branding.appName}
            </span>
          )}
        </div>

        <div
          className="min-h-24"
          onDragOver={(e) => {
            if (!accepts(e) || items.length) return
            e.preventDefault()
            setTarget({ at: 0 })
          }}
        >
          {items.map((it, i) => (
            <div key={it.id}>
              {target && 'at' in target && target.at === i && <DropLine />}
              <CanvasBlock
                item={it}
                index={i}
                count={items.length}
                selected={sel === it.id}
                highlighted={!!target && 'on' in target && target.on === i}
                canEdit={canEdit}
                brand={brand}
                onSelect={() => props.onSelect(it.id)}
                onChange={(b) => props.onChange(it.id, b)}
                onMove={(d) => props.onMove(it.id, d)}
                onDuplicate={() => props.onDuplicate(it.id)}
                onRemove={() => props.onRemove(it.id)}
                onDragOver={(e) => {
                  if (!accepts(e)) return
                  e.preventDefault()
                  e.stopPropagation()
                  const r = e.currentTarget.getBoundingClientRect()
                  const y = (e.clientY - r.top) / r.height
                  const p = dragging
                  const onto = p && ((p.kind === 'image' && it.b.type === 'imagem') || (p.kind === 'product' && it.b.type === 'produtos'))
                  if (onto && y > 0.2 && y < 0.8) setTarget({ on: i })
                  else setTarget({ at: y < 0.5 ? i : i + 1 })
                }}
              />
            </div>
          ))}
          {target && 'at' in target && target.at === items.length && <DropLine />}
          {!items.length && (
            <div className="m-6 rounded-md border-2 border-dashed border-[#d1d5db] p-10 text-center text-sm text-[#6b7280]">
              Arraste blocos, imagens ou produtos do painel ao lado para cá.
              <br />
              Também dá para soltar uma imagem do seu computador.
            </div>
          )}
        </div>

        <div className="border-t border-[#f3f4f6] px-8 pt-6 pb-8 text-center text-xs leading-[18px] text-[#6b7280]">
          {settings?.footerText && (
            <p className="mb-3 whitespace-pre-line">{settings.footerText}</p>
          )}
          <p>Você recebe este e-mail porque autorizou o contato de {branding.appName}.</p>
          <span className="underline">Não quero mais receber estes e-mails</span>
        </div>
      </div>
    </div>
  )
}

function DropLine() {
  return <div className="mx-6 my-0.5 h-1 rounded-full bg-[color:var(--brand)]" aria-hidden />
}

function CanvasBlock(props: {
  item: Item
  index: number
  count: number
  selected: boolean
  highlighted: boolean
  canEdit: boolean
  brand: string
  onSelect: () => void
  onChange: (b: Block) => void
  onMove: (d: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
}) {
  const { item, selected, canEdit } = props
  const b = item.b
  const rich = b.type === 'titulo' || b.type === 'texto'
  return (
    <div
      className={cn(
        'group relative cursor-pointer outline-2 -outline-offset-2 outline-transparent transition-[outline-color]',
        selected ? 'outline-[color:var(--brand)]' : 'hover:outline-[#93c5fd]',
        props.highlighted && 'outline-dashed outline-[color:var(--brand)]',
      )}
      draggable={canEdit && !(selected && rich)}
      onDragStart={(e) => startDrag(e, { kind: 'move', id: item.id })}
      onDragOver={props.onDragOver}
      onClick={props.onSelect}
    >
      {selected && canEdit && (
        <div className="absolute -top-3.5 right-2 z-10 flex items-center rounded-md border bg-background text-foreground shadow-sm" onClick={(e) => e.stopPropagation()}>
          <span className="cursor-grab px-1.5 text-muted-foreground active:cursor-grabbing" draggable onDragStart={(e) => startDrag(e, { kind: 'move', id: item.id })} title="Arraste para mover">
            <GripVerticalIcon className="size-4" />
          </span>
          <span className="px-1 text-[11px] font-medium text-muted-foreground">{BLOCK_LABEL[b.type]}</span>
          <ToolButton label="Subir" disabled={props.index === 0} onClick={() => props.onMove(-1)}>
            <ArrowUpIcon />
          </ToolButton>
          <ToolButton label="Descer" disabled={props.index === props.count - 1} onClick={() => props.onMove(1)}>
            <ArrowDownIcon />
          </ToolButton>
          <ToolButton label="Duplicar" onClick={props.onDuplicate}>
            <CopyIcon />
          </ToolButton>
          <ToolButton label="Remover" onClick={props.onRemove}>
            <Trash2Icon />
          </ToolButton>
        </div>
      )}
      <BlockView block={b} brand={props.brand} editing={selected && canEdit} onChange={props.onChange} />
    </div>
  )
}

function ToolButton({ label, children, onClick, disabled }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" size="icon" variant="ghost" className="size-7 [&_svg]:size-3.5" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

const justify = (a: Align | undefined, fallback: Align) => ({ left: 'flex-start', center: 'center', right: 'flex-end' })[a ?? fallback]

/** Mesmas medidas do HTML do e-mail (apps/api/src/email/blocos.ts). */
function BlockView({ block: b, brand, editing, onChange }: { block: Block; brand: string; editing: boolean; onChange: (b: Block) => void }) {
  switch (b.type) {
    case 'titulo':
    case 'texto': {
      const title = b.type === 'titulo'
      const size = b.size ?? (title ? 24 : 15)
      return (
        <div
          style={{
            padding: b.bg ? '16px 32px' : '8px 32px',
            fontSize: size,
            lineHeight: `${Math.round(size * 1.45)}px`,
            fontWeight: title ? 700 : 400,
            color: b.color ?? (title ? '#111827' : '#374151'),
            textAlign: b.align ?? 'left',
            background: b.bg,
          }}
        >
          <RichEditable html={b.html} editable={editing} onChange={(html) => onChange({ ...b, html })} />
        </div>
      )
    }
    case 'imagem':
      return (
        <div className="flex justify-center px-8 py-2">
          {b.url ? (
            <img src={b.url} alt={b.alt ?? ''} draggable={false} className="block h-auto rounded-md" style={{ width: `${b.width ?? 100}%` }} />
          ) : (
            <div className="flex w-full flex-col items-center gap-1 rounded-md border-2 border-dashed border-[#d1d5db] p-8 text-sm text-[#6b7280]">
              <ImageIcon className="size-6" />
              Arraste uma imagem para cá ou escolha na aba Imagens.
            </div>
          )}
        </div>
      )
    case 'botao':
    case 'whatsapp': {
      const wa = b.type === 'whatsapp'
      return (
        <div className="flex px-8 py-4" style={{ justifyContent: justify(b.align, 'center') }}>
          <span
            className="inline-flex items-center gap-2 rounded-md px-7 py-3 text-[15px] font-bold"
            style={{ background: wa ? '#25D366' : (b.color ?? brand), color: wa ? '#ffffff' : (b.textColor ?? '#ffffff') }}
          >
            {wa && <MessageCircleIcon className="size-4" />}
            {b.text || (wa ? 'Falar no WhatsApp' : 'Botão')}
          </span>
        </div>
      )
    }
    case 'produtos': {
      const cols = b.columns === 2 ? 2 : 3
      if (!b.items.length)
        return (
          <div className="px-8 py-2">
            <div className="flex flex-col items-center gap-1 rounded-md border-2 border-dashed border-[#d1d5db] p-8 text-sm text-[#6b7280]">
              <ShoppingBagIcon className="size-6" />
              Arraste produtos da aba Produtos para cá.
            </div>
          </div>
        )
      return (
        <div className="grid px-6 py-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {b.items.map((p, i) => (
            <div key={i} className="p-2 text-center">
              {p.image && <img src={p.image} alt="" draggable={false} className="mx-auto mb-2 block h-auto w-full" style={{ maxWidth: cols === 2 ? 240 : 160 }} />}
              <div className="text-sm leading-[19px] font-semibold text-[#111827]">{p.name || 'Produto'}</div>
              {p.oldPrice && <div className="pt-1 text-xs text-[#9ca3af] line-through">{p.oldPrice}</div>}
              {p.price && (
                <div className={cn('text-[15px] font-bold', !p.oldPrice && 'pt-1')} style={{ color: brand }}>
                  {p.price}
                </div>
              )}
            </div>
          ))}
        </div>
      )
    }
    case 'divisor':
      return (
        <div className="px-8 py-3">
          <hr className="border-0 border-t border-[#e5e7eb]" />
        </div>
      )
    case 'espaco':
      return <div style={{ height: b.height ?? 24 }} className="bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,#f3f4f6_6px,#f3f4f6_7px)] opacity-0 group-hover:opacity-100" />
  }
}

/** Texto editável no próprio e-mail. Colar entra como texto puro (sem a formatação de outro site). */
function RichEditable({ html, editable, onChange }: { html: string; editable: boolean; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const current = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (ref.current && html !== current.current) {
      ref.current.innerHTML = cleanRich(html)
      current.current = html
    }
  }, [html])
  useEffect(() => {
    if (editable) ref.current?.focus()
  }, [editable])
  const emit = () => {
    if (!ref.current) return
    const v = cleanRich(ref.current.innerHTML)
    current.current = v
    onChange(v)
  }
  return (
    <div
      ref={ref}
      data-rich="1"
      contentEditable={editable}
      suppressContentEditableWarning
      onInput={emit}
      onBlur={editable ? emit : undefined}
      onPaste={(e) => {
        e.preventDefault()
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
      }}
      className={cn('min-h-[1em] break-words outline-none [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6', editable && 'cursor-text')}
    />
  )
}

// ---------- Barra de formatação ----------

const SIZES = [12, 14, 15, 16, 18, 20, 24, 28, 32, 40]
const SWATCHES = ['#111827', '#374151', '#6b7280', '#1d4ed8', '#16a34a', '#dc2626', '#ea580c', '#ca8a04', '#7c3aed', '#ffffff']

function FormatBar({ active }: { active: boolean }) {
  const saved = useRef<{ range: Range; el: HTMLElement } | null>(null)
  const [link, setLink] = useState('https://')
  const [linkOpen, setLinkOpen] = useState(false)

  useEffect(() => {
    const track = () => {
      const s = document.getSelection()
      if (!s?.rangeCount) return
      const node = s.anchorNode
      const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-rich]')
      if (el?.isContentEditable) saved.current = { range: s.getRangeAt(0).cloneRange(), el }
    }
    document.addEventListener('selectionchange', track)
    return () => document.removeEventListener('selectionchange', track)
  }, [])

  const run = (fn: (el: HTMLElement) => void) => {
    const s = saved.current
    if (!active || !s || !document.contains(s.el) || !s.el.isContentEditable) {
      toast.info('Clique no texto do e-mail e selecione o trecho que quer formatar.')
      return
    }
    s.el.focus()
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(s.range)
    fn(s.el)
    s.el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const exec = (cmd: string, value?: string, css = false) =>
    run(() => {
      document.execCommand('styleWithCSS', false, css ? 'true' : 'false')
      document.execCommand(cmd, false, value)
    })
  const fontSize = (px: number) =>
    run((el) => {
      document.execCommand('styleWithCSS', false, 'false')
      document.execCommand('fontSize', false, '7')
      for (const f of Array.from(el.querySelectorAll('font[size="7"]'))) {
        const span = document.createElement('span')
        span.style.fontSize = `${px}px`
        while (f.firstChild) span.appendChild(f.firstChild)
        f.replaceWith(span)
      }
    })
  const keep = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className={cn('sticky top-2 z-20 flex flex-wrap items-center gap-0.5 rounded-lg border bg-background p-1 shadow-sm', !active && 'opacity-60')} onMouseDown={(e) => (e.target as HTMLElement).closest('input,[role=combobox]') || keep(e)}>
      <ToolButton label="Negrito" onClick={() => exec('bold')}>
        <BoldIcon />
      </ToolButton>
      <ToolButton label="Itálico" onClick={() => exec('italic')}>
        <ItalicIcon />
      </ToolButton>
      <ToolButton label="Sublinhado" onClick={() => exec('underline')}>
        <UnderlineIcon />
      </ToolButton>
      <ToolButton label="Riscado" onClick={() => exec('strikeThrough')}>
        <StrikethroughIcon />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <Select onValueChange={(v) => fontSize(Number(v))} value="">
        <SelectTrigger size="sm" className="h-7 w-[92px] text-xs" aria-label="Tamanho da fonte">
          <SelectValue placeholder="Tamanho" />
        </SelectTrigger>
        <SelectContent>
          {SIZES.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s} px
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ColorPick label="Cor do texto" icon={<PaletteIcon />} onPick={(c) => exec('foreColor', c, true)} />
      <ColorPick label="Cor de fundo do trecho" icon={<HighlighterIcon />} onPick={(c) => exec('hiliteColor', c, true)} />
      <span className="mx-1 h-5 w-px bg-border" />
      <Popover open={linkOpen} onOpenChange={setLinkOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="icon" variant="ghost" className="size-7 [&_svg]:size-3.5" aria-label="Link" title="Link">
            <LinkIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2">
          <Label htmlFor="rt-link">Endereço do link</Label>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const url = link.trim()
              if (!/^(https?:\/\/\S+|mailto:\S+|tel:\S+)$/i.test(url)) return toast.error('Use um endereço que comece com https://')
              run(() => {
                const s = document.getSelection()
                if (s && !s.isCollapsed) document.execCommand('createLink', false, url)
                else {
                  const a = document.createElement('a')
                  a.href = url
                  a.textContent = url
                  s?.getRangeAt(0).insertNode(a)
                }
              })
              setLinkOpen(false)
            }}
          >
            <Input id="rt-link" value={link} onChange={(e) => setLink(e.target.value)} />
            <Button type="submit" size="sm">
              Aplicar
            </Button>
          </form>
          <Button type="button" variant="ghost" size="sm" onClick={() => (exec('unlink'), setLinkOpen(false))}>
            Tirar link
          </Button>
        </PopoverContent>
      </Popover>
      <ToolButton label="Lista" onClick={() => exec('insertUnorderedList')}>
        <ListIcon />
      </ToolButton>
      <ToolButton label="Lista numerada" onClick={() => exec('insertOrderedList')}>
        <ListOrderedIcon />
      </ToolButton>
      <ToolButton label="Inserir primeiro nome do lead" onClick={() => exec('insertText', '{primeiro_nome}')}>
        <UserIcon />
      </ToolButton>
      <ToolButton label="Limpar formatação" onClick={() => (exec('removeFormat'), exec('unlink'))}>
        <RemoveFormattingIcon />
      </ToolButton>
      {!active && <span className="px-2 text-xs text-muted-foreground">Selecione um título ou texto no e-mail</span>}
    </div>
  )
}

function ColorPick({ label, icon, onPick }: { label: string; icon: ReactNode; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="size-7 [&_svg]:size-3.5" aria-label={label} title={label}>
          {icon}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2" onMouseDown={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && e.preventDefault()}>
        <p className="text-xs font-medium">{label}</p>
        <div className="grid grid-cols-5 gap-1.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="size-8 rounded-md border"
              style={{ background: c }}
              aria-label={c}
              onClick={() => {
                onPick(c)
                setOpen(false)
              }}
            />
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Outra cor
          <input type="color" className="h-7 w-12 cursor-pointer rounded border p-0.5" onChange={(e) => onPick(e.target.value)} />
        </label>
      </PopoverContent>
    </Popover>
  )
}

// ---------- Painéis ----------

function BlocksPanel({ canEdit, onAdd }: { canEdit: boolean; onAdd: (t: BlockType) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Arraste para o e-mail ou clique para colocar abaixo do bloco selecionado.</p>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(BLOCK_LABEL) as BlockType[]).map((t) => {
          const Icon = BLOCK_ICON[t]
          return (
            <button
              key={t}
              type="button"
              disabled={!canEdit}
              draggable={canEdit}
              onDragStart={(e) => startDrag(e, { kind: 'new', type: t })}
              onClick={() => onAdd(t)}
              className="flex cursor-grab flex-col items-center gap-1.5 rounded-md border bg-card p-3 text-xs font-medium hover:border-[color:var(--brand)] hover:bg-muted/50 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon className={cn('size-5', t === 'whatsapp' ? 'text-[#25D366]' : 'text-muted-foreground')} />
              {BLOCK_LABEL[t]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function useImageUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post<EmailImage>('/email/imagens', form)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-images'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
}

function ImagesPanel({ canEdit, onPick, replacing }: { canEdit: boolean; onPick: (url: string) => void; replacing: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['email-images'], queryFn: () => api.get<EmailImage[]>('/email/imagens') })
  const upload = useImageUpload()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/email/imagens/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-images'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const send = async (files: File[]) => {
    for (const f of files.filter((x) => x.type.startsWith('image/'))) await upload.mutateAsync(f).catch(() => null)
  }
  return (
    <div className="space-y-3">
      {canEdit && (
        <div
          className={cn('rounded-md border-2 border-dashed p-4 text-center text-xs text-muted-foreground transition-colors', over && 'border-[color:var(--brand)] bg-muted/50')}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            void send(Array.from(e.dataTransfer.files))
          }}
        >
          <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => (void send(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
          <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Enviar imagens
          </Button>
          <p className="mt-2">ou solte os arquivos aqui. PNG, JPG, GIF ou WEBP até 1,5 MB (banner: 1200 px de largura).</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{replacing ? 'Clique para trocar a imagem do bloco selecionado, ou arraste para o e-mail.' : 'Arraste para o e-mail ou clique para inserir.'}</p>
      {q.isLoading ? (
        <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />
      ) : !q.data?.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma imagem enviada ainda.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {q.data.map((img) => (
            <div key={img.id} className="group relative">
              <button
                type="button"
                draggable={canEdit}
                disabled={!canEdit}
                onDragStart={(e) => startDrag(e, { kind: 'image', url: img.url })}
                onClick={() => onPick(img.url)}
                className="block aspect-square w-full cursor-grab overflow-hidden rounded-md border bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] active:cursor-grabbing"
              >
                <img src={img.url} alt="" draggable={false} className="size-full object-contain" loading="lazy" />
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-label="Apagar imagem"
                  className="absolute top-1 right-1 hidden rounded bg-background/90 p-1 shadow group-hover:block"
                  onClick={() => confirm('Apagar esta imagem? Só dá para apagar imagens que nenhuma campanha usa.') && del.mutate(img.id)}
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProductsPanel({ canEdit, onPick, intoSelected }: { canEdit: boolean; onPick: (p: ProductItem) => void; intoSelected: boolean }) {
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(text)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [text])
  const q = useQuery({
    queryKey: ['email-products', term, page],
    queryFn: () => api.get<ProductSearch>(`/email/produtos?${new URLSearchParams({ q: term, page: String(page) })}`),
    refetchInterval: (query) => (query.state.data?.catalog.updating ? 4_000 : false),
  })
  const refresh = useMutation({
    mutationFn: () => api.post('/email/produtos/atualizar'),
    onSuccess: () => {
      toast.success('Atualizando o catálogo da loja. Pode levar alguns minutos.')
      void q.refetch()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1
  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Nome, código ou marca" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar produto" />
      </div>
      {d && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {!d.catalog.enabled
              ? 'Catálogo desligado'
              : d.catalog.updating
                ? 'Atualizando…'
                : d.catalog.syncedAt
                  ? `Atualizado em ${formatDateTime(d.catalog.syncedAt)}`
                  : 'Ainda não atualizado'}
          </span>
          {canEdit && d.catalog.enabled && (
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => refresh.mutate()} disabled={refresh.isPending || d.catalog.updating}>
              <RefreshCwIcon className={cn(d.catalog.updating && 'animate-spin')} /> Atualizar
            </Button>
          )}
        </div>
      )}
      {d && !d.catalog.enabled && (
        <p className="rounded-md bg-muted p-3 text-xs">
          Para listar os produtos da loja, ligue a integração com a Magazord e a opção <strong>Catálogo de produtos</strong> em Configurações → Integrações.
        </p>
      )}
      {d?.catalog.error && <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">Última atualização falhou: {d.catalog.error}</p>}
      <p className="text-xs text-muted-foreground">{intoSelected ? 'Clique para colocar no bloco de produtos selecionado, ou arraste.' : 'Arraste para o e-mail ou clique para inserir.'}</p>
      {q.isLoading ? (
        <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />
      ) : !d?.items.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{term ? 'Nenhum produto encontrado.' : 'Nenhum produto no catálogo ainda.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {d.items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                draggable={canEdit}
                disabled={!canEdit}
                onDragStart={(e) => startDrag(e, { kind: 'product', item: productItem(p) })}
                onClick={() => onPick(productItem(p))}
                className="flex w-full cursor-grab items-center gap-2 rounded-md border p-1.5 text-left hover:border-[color:var(--brand)] hover:bg-muted/50 active:cursor-grabbing"
              >
                <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-white">
                  {p.image ? <img src={p.image} alt="" draggable={false} className="size-full object-contain" loading="lazy" /> : <ShoppingBagIcon className="size-5 text-muted-foreground" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-xs font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.priceFrom && <s className="mr-1">{formatBRL(p.priceFrom)}</s>}
                    <strong className="text-foreground">{formatBRL(p.price)}</strong>
                    {p.code && ` · ${p.code}`}
                    {p.stock !== null && p.stock <= 0 && ' · sem estoque'}
                  </span>
                </span>
                <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {d && pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
            Anterior
          </Button>
          <span>
            {page} de {pages} · {int.format(d.total)} produtos
          </span>
          <Button type="button" size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------- Propriedades do bloco selecionado ----------

function AlignPick({ value, onChange, disabled }: { value: Align | undefined; onChange: (a: Align) => void; disabled: boolean }) {
  const opts = [
    ['left', AlignLeftIcon, 'Esquerda'],
    ['center', AlignCenterIcon, 'Centro'],
    ['right', AlignRightIcon, 'Direita'],
  ] as const
  return (
    <div className="flex gap-1">
      {opts.map(([a, Icon, label]) => (
        <Button key={a} type="button" size="icon" variant={value === a ? 'secondary' : 'ghost'} className="size-8" aria-label={label} title={label} aria-pressed={value === a} disabled={disabled} onClick={() => onChange(a)}>
          <Icon />
        </Button>
      ))}
    </div>
  )
}

function ColorField({ label, value, fallback, onChange, disabled, clearable }: { label: string; value: string | undefined; fallback: string; onChange: (v: string | undefined) => void; disabled: boolean; clearable?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-sm font-normal">{label}</Label>
      <div className="flex items-center gap-1">
        <input type="color" aria-label={label} className="h-8 w-12 cursor-pointer rounded border p-0.5" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        {clearable && value && (
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Sem cor" onClick={() => onChange(undefined)} disabled={disabled}>
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

function Inspector({ block: b, numbers, disabled, onChange, onPickImage }: { block: Block; numbers: WhatsappNumber[]; disabled: boolean; onChange: (b: Block) => void; onPickImage: () => void }) {
  const head = (
    <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
      {(() => {
        const Icon = BLOCK_ICON[b.type]
        return <Icon className="size-4 text-muted-foreground" />
      })()}
      {BLOCK_LABEL[b.type]}
    </p>
  )
  switch (b.type) {
    case 'titulo':
    case 'texto': {
      const title = b.type === 'titulo'
      const sizes = title ? [18, 20, 22, 24, 28, 32, 36, 40] : [12, 13, 14, 15, 16, 18, 20, 22, 24]
      return (
        <div className="space-y-4">
          {head}
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Edite o texto direto no e-mail. Selecione um trecho e use a barra acima do e-mail para negrito, itálico, sublinhado, cor, tamanho e link.</p>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">Alinhamento</Label>
            <AlignPick value={b.align ?? 'left'} onChange={(align) => onChange({ ...b, align })} disabled={disabled} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-normal">Tamanho base</Label>
            <Select value={String(b.size ?? (title ? 24 : 15))} onValueChange={(v) => onChange({ ...b, size: Number(v) })} disabled={disabled}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ColorField label="Cor do texto" value={b.color} fallback={title ? '#111827' : '#374151'} onChange={(color) => onChange({ ...b, color })} disabled={disabled} />
          <ColorField label="Fundo da faixa" value={b.bg} fallback="#f3f4f6" onChange={(bg) => onChange({ ...b, bg })} disabled={disabled} clearable />
        </div>
      )
    }
    case 'imagem':
      return (
        <div className="space-y-3">
          {head}
          <Button type="button" size="sm" variant="outline" className="w-full" onClick={onPickImage} disabled={disabled}>
            <ImageIcon /> Escolher ou enviar imagem
          </Button>
          <Field label="Endereço da imagem" htmlFor="i-url">
            <Input id="i-url" placeholder="https://..." value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} disabled={disabled} />
          </Field>
          <Field label="Link ao clicar (opcional)" htmlFor="i-link">
            <Input id="i-link" placeholder="https://..." value={b.link ?? ''} onChange={(e) => onChange({ ...b, link: e.target.value })} disabled={disabled} />
          </Field>
          <Field label="Descrição (para quem não vê a imagem)" htmlFor="i-alt">
            <Input id="i-alt" maxLength={200} value={b.alt ?? ''} onChange={(e) => onChange({ ...b, alt: e.target.value })} disabled={disabled} />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-normal">Largura</Label>
            <Select value={String(b.width ?? 100)} onValueChange={(v) => onChange({ ...b, width: Number(v) })} disabled={disabled}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[100, 75, 50, 33].map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {w === 100 ? 'Inteira' : `${w}%`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    case 'botao':
      return (
        <div className="space-y-3">
          {head}
          <Field label="Texto do botão" htmlFor="b-text">
            <Input id="b-text" maxLength={60} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} disabled={disabled} />
          </Field>
          <Field label="Link" htmlFor="b-url">
            <Input id="b-url" placeholder="https://..." value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} disabled={disabled} />
          </Field>
          <ColorField label="Cor do botão" value={b.color} fallback="#1d4ed8" onChange={(color) => onChange({ ...b, color })} disabled={disabled} />
          <ColorField label="Cor do texto" value={b.textColor} fallback="#ffffff" onChange={(textColor) => onChange({ ...b, textColor })} disabled={disabled} />
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">Posição</Label>
            <AlignPick value={b.align ?? 'center'} onChange={(align) => onChange({ ...b, align })} disabled={disabled} />
          </div>
        </div>
      )
    case 'whatsapp': {
      const digits = b.phone.replace(/\D/g, '')
      return (
        <div className="space-y-3">
          {head}
          {numbers.length > 0 && (
            <Field label="Usar um número da Captura">
              <Select value="" onValueChange={(id) => {
                const n = numbers.find((x) => x.id === id)
                if (n) onChange({ ...b, phone: n.phone })
              }} disabled={disabled}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {numbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.name} ({n.phone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Número (DDD + número)" htmlFor="w-phone" hint={digits && (digits.length < 10 || digits.length > 15) ? 'Número incompleto.' : undefined}>
            <Input id="w-phone" inputMode="tel" placeholder="(49) 99999-0000" value={b.phone} onChange={(e) => onChange({ ...b, phone: e.target.value })} disabled={disabled} />
          </Field>
          <Field label="Texto do botão" htmlFor="w-text">
            <Input id="w-text" maxLength={60} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} disabled={disabled} />
          </Field>
          <Field label="Mensagem que já vem escrita" htmlFor="w-msg" hint="O cliente só precisa tocar em enviar no WhatsApp.">
            <Textarea id="w-msg" rows={3} maxLength={500} value={b.message ?? ''} onChange={(e) => onChange({ ...b, message: e.target.value })} disabled={disabled} />
          </Field>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">Posição</Label>
            <AlignPick value={b.align ?? 'center'} onChange={(align) => onChange({ ...b, align })} disabled={disabled} />
          </div>
        </div>
      )
    }
    case 'produtos': {
      const setItem = (i: number, patch: Partial<ProductItem>) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
      const moveItem = (i: number, d: -1 | 1) => {
        const n = [...b.items]
        const [x] = n.splice(i, 1)
        n.splice(i + d, 0, x!)
        onChange({ ...b, items: n })
      }
      return (
        <div className="space-y-3">
          {head}
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-normal">Por linha</Label>
            <Select value={String(b.columns ?? 3)} onValueChange={(v) => onChange({ ...b, columns: v === '2' ? 2 : 3 })} disabled={disabled}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 produtos</SelectItem>
                <SelectItem value="3">3 produtos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">Arraste mais produtos da aba Produtos para este bloco (até 12). Nome e preço podem ser ajustados aqui.</p>
          {b.items.map((it, i) => (
            <div key={i} className="space-y-1.5 rounded-md border p-2">
              <div className="flex items-center gap-1">
                <Input aria-label="Nome do produto" className="h-8 text-xs" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} disabled={disabled} />
                <ToolButton label="Subir" disabled={disabled || i === 0} onClick={() => moveItem(i, -1)}>
                  <ArrowUpIcon />
                </ToolButton>
                <ToolButton label="Descer" disabled={disabled || i === b.items.length - 1} onClick={() => moveItem(i, 1)}>
                  <ArrowDownIcon />
                </ToolButton>
                <ToolButton label="Tirar produto" disabled={disabled} onClick={() => onChange({ ...b, items: b.items.filter((_, j) => j !== i) })}>
                  <XIcon />
                </ToolButton>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Input aria-label="Preço de" placeholder="De (opcional)" className="h-8 text-xs" value={it.oldPrice ?? ''} onChange={(e) => setItem(i, { oldPrice: e.target.value })} disabled={disabled} />
                <Input aria-label="Preço" placeholder="Por" className="h-8 text-xs" value={it.price ?? ''} onChange={(e) => setItem(i, { price: e.target.value })} disabled={disabled} />
              </div>
              <Input aria-label="Link do produto" placeholder="Link https://" className="h-8 text-xs" value={it.url ?? ''} onChange={(e) => setItem(i, { url: e.target.value })} disabled={disabled} />
            </div>
          ))}
          {b.items.length < 12 && (
            <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...b, items: [...b.items, { name: 'Produto', price: '', url: '', image: '' }] })} disabled={disabled}>
              <PlusIcon /> Produto manual
            </Button>
          )}
        </div>
      )
    }
    case 'espaco':
      return (
        <div className="space-y-3">
          {head}
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-normal">Altura</Label>
            <Select value={String(b.height ?? 24)} onValueChange={(v) => onChange({ ...b, height: Number(v) })} disabled={disabled}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[8, 16, 24, 40, 64, 96].map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    default:
      return (
        <div>
          {head}
          <p className="text-sm text-muted-foreground">Sem opções. Arraste para mudar de lugar.</p>
        </div>
      )
  }
}

// ---------- Como fica no e-mail ----------

function PreviewDialog({ open, onOpenChange, subject, preheader, blocks }: { open: boolean; onOpenChange: (v: boolean) => void; subject: string; preheader: string | null; blocks: Block[] }) {
  const [html, setHtml] = useState('')
  const [title, setTitle] = useState('')
  const [mobile, setMobile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setHtml('')
    setError(null)
    api
      .post<{ html: string; subject: string }>('/email/previa', { subject, preheader, blocks })
      .then((r) => {
        setHtml(r.html)
        setTitle(r.subject)
      })
      .catch((err) => setError(errorMessage(err)))
    // Só ao abrir: mostra o e-mail como está agora.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Como fica no e-mail</DialogTitle>
          <DialogDescription>{title ? `Assunto: ${title} · com os seus dados no lugar de {primeiro_nome}.` : 'Montando…'}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center gap-1">
          <Button type="button" size="sm" variant={mobile ? 'ghost' : 'secondary'} onClick={() => setMobile(false)}>
            <MonitorIcon /> Computador
          </Button>
          <Button type="button" size="sm" variant={mobile ? 'secondary' : 'ghost'} onClick={() => setMobile(true)}>
            <SmartphoneIcon /> Celular
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : html ? (
          <iframe title="Pré-visualização do e-mail" srcDoc={html} sandbox="" className="mx-auto h-[65vh] rounded-md border bg-white transition-[width]" style={{ width: mobile ? 375 : '100%' }} />
        ) : (
          <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />
        )}
      </DialogContent>
    </Dialog>
  )
}
