import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FilmIcon, ImageIcon, ImagePlusIcon, Loader2Icon, PackageIcon, SparklesIcon, Trash2Icon, UploadIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { cn } from '@/lib/utils'
import { type ArtOptions, canvasToJpeg, drawArt, type Frame, FRAMES, loadImage, mp4Type, photosToVideo } from './imagem'

export interface Media {
  id: string
  kind: 'imagem' | 'video'
  mime: string
  name: string
  source: string
  width: number | null
  height: number | null
  size: number
  createdByName: string | null
  createdAt: string
}

export const mediaSrc = (id: string) => `/api/postagens/midias/${id}/arquivo`

const SOURCE: Record<string, string> = { upload: 'Enviada', arte: 'Arte', catalogo: 'Catálogo', ia: 'IA', video: 'Vídeo de fotos' }

export function useMediaLibrary() {
  return useQuery({ queryKey: ['postagens-midias'], queryFn: () => api.get<{ total: number; items: Media[] }>('/postagens/midias'), staleTime: 30_000 })
}

async function upload(blob: Blob, d: { name: string; source: string; width?: number; height?: number }) {
  const fd = new FormData()
  fd.append('file', blob, blob.type === 'video/mp4' ? 'video.mp4' : 'imagem.jpg')
  fd.append('name', d.name)
  fd.append('source', d.source)
  if (d.width) fd.append('width', String(d.width))
  if (d.height) fd.append('height', String(d.height))
  return api.post<Media>('/postagens/midias', fd)
}

/** Miniatura de uma mídia (imagem ou primeiro quadro do vídeo). */
export function Thumb({ m, className }: { m: Pick<Media, 'id' | 'kind' | 'name'>; className?: string }) {
  return m.kind === 'video' ? (
    <span className={cn('relative block overflow-hidden rounded-md bg-black', className)}>
      <video src={`${mediaSrc(m.id)}#t=0.5`} muted preload="metadata" className="size-full object-cover" />
      <FilmIcon className="absolute top-1 right-1 size-4 text-white drop-shadow" />
    </span>
  ) : (
    <img src={mediaSrc(m.id)} alt={m.name} loading="lazy" className={cn('rounded-md bg-muted object-cover', className)} />
  )
}

// ---------- Arte (enquadrar foto, texto e marca) ----------

type Source = { kind: 'arquivo'; blob: Blob; name: string } | { kind: 'url'; url: string; name: string; source: string } | null

/**
 * Prepara uma imagem para a postagem: escolhe a foto (computador, biblioteca, catálogo ou IA), enquadra no tamanho do
 * Instagram, põe título, faixa da marca e logo, e guarda na biblioteca como JPEG.
 */
export function ArtDialog({ open, onClose, frame: initialFrame = 'quadrado', onSaved }: { open: boolean; onClose: () => void; frame?: Frame; onSaved?: (m: Media) => void }) {
  const qc = useQueryClient()
  const branding = useBranding()
  const brand = branding.brandColor || branding.primaryColor
  const [src, setSrc] = useState<Source>(null)
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null)
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  const [opts, setOpts] = useState<Omit<ArtOptions, 'logo'> & { useLogo: boolean }>({ frame: initialFrame, fit: 'cobrir', background: '#ffffff', headline: '', subtitle: '', bar: false, barColor: brand, barText: '', textColor: '#ffffff', useLogo: false })
  const [name, setName] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [idea, setIdea] = useState('')
  const library = useMediaLibrary()
  const products = useQuery({ queryKey: ['postagens-produtos', search], queryFn: () => api.get<{ id: string; code: string; name: string; brand: string | null }[]>(`/postagens/produtos?busca=${encodeURIComponent(search)}`), enabled: open, staleTime: 60_000 })

  useEffect(() => {
    if (!open) return
    setSrc(null)
    setPhoto(null)
    setOpts((o) => ({ ...o, frame: initialFrame, headline: '', subtitle: '' }))
    setName('')
  }, [open, initialFrame])
  useEffect(() => {
    const url = branding.logoUrl
    if (!url) return
    loadImage(url).then(setLogo, () => setLogo(null))
  }, [branding.logoUrl])
  useEffect(() => {
    if (!src) return
    let alive = true
    const p = src.kind === 'arquivo' ? loadImage(src.blob) : fetch(src.url, { credentials: 'include' }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('Não foi possível abrir a foto.')))).then(loadImage)
    p.then((img) => alive && setPhoto(img)).catch((e: Error) => toast.error(e.message))
    if (!name) setName(src.name)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])
  useEffect(() => {
    if (canvas.current) drawArt(canvas.current, photo, { ...opts, logo: opts.useLogo ? logo : null })
  }, [photo, opts, logo])

  const ai = useMutation({
    mutationFn: () => api.post<{ mime: string; data: string }>('/postagens/ia/imagem', { idea, format: opts.frame === 'stories' ? 'STORIES' : 'FEED' }),
    onSuccess: (r) => {
      const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))
      setSrc({ kind: 'arquivo', blob: new Blob([bin], { type: r.mime }), name: idea.slice(0, 60) })
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 10_000 }),
  })
  const save = useMutation({
    mutationFn: async () => {
      if (!canvas.current || !photo) throw new Error('Escolha a foto.')
      drawArt(canvas.current, photo, { ...opts, logo: opts.useLogo ? logo : null })
      const blob = await canvasToJpeg(canvas.current)
      const { w, h } = FRAMES[opts.frame]
      const source = src?.kind === 'url' ? src.source : ai.data && src?.kind === 'arquivo' && src.name === idea.slice(0, 60) ? 'ia' : opts.headline || opts.bar ? 'arte' : 'upload'
      return upload(blob, { name: name.trim() || 'Imagem', source, width: w, height: h })
    },
    onSuccess: (m) => {
      toast.success('Imagem guardada na biblioteca.')
      void qc.invalidateQueries({ queryKey: ['postagens-midias'] })
      onSaved?.(m)
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const set = <K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v }))
  const { w, h } = FRAMES[opts.frame]

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Preparar imagem</DialogTitle>
          <DialogDescription>Escolha a foto, enquadre no tamanho do Instagram e, se quiser, coloque título e a marca. Ela vai para a biblioteca em JPEG.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            <Tabs defaultValue="computador">
              <TabsList className="flex-wrap">
                <TabsTrigger value="computador">
                  <UploadIcon /> Computador
                </TabsTrigger>
                <TabsTrigger value="biblioteca">
                  <ImageIcon /> Biblioteca
                </TabsTrigger>
                <TabsTrigger value="catalogo">
                  <PackageIcon /> Catálogo
                </TabsTrigger>
                <TabsTrigger value="ia">
                  <SparklesIcon /> Criar com IA
                </TabsTrigger>
              </TabsList>
              <TabsContent value="computador" className="pt-2">
                <input
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) setSrc({ kind: 'arquivo', blob: f, name: f.name.replace(/\.\w+$/, '') })
                  }}
                />
                <Button type="button" variant="outline" onClick={() => file.current?.click()}>
                  <UploadIcon /> Escolher foto (JPG, PNG ou WEBP)
                </Button>
              </TabsContent>
              <TabsContent value="biblioteca" className="pt-2">
                <div className="grid max-h-52 grid-cols-5 gap-1.5 overflow-y-auto">
                  {library.data?.items
                    .filter((m) => m.kind === 'imagem')
                    .map((m) => (
                      <button key={m.id} type="button" onClick={() => setSrc({ kind: 'url', url: mediaSrc(m.id), name: m.name, source: m.source })} className="aspect-square overflow-hidden rounded-md border hover:ring-2 hover:ring-primary">
                        <Thumb m={m} className="size-full" />
                      </button>
                    ))}
                  {library.data && !library.data.items.some((m) => m.kind === 'imagem') && <p className="col-span-5 text-sm text-muted-foreground">Biblioteca vazia.</p>}
                </div>
              </TabsContent>
              <TabsContent value="catalogo" className="space-y-2 pt-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto por nome, código ou marca" />
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {products.data?.map((p) => (
                    <button key={p.id} type="button" onClick={() => setSrc({ kind: 'url', url: `/api/postagens/produtos/${p.id}/imagem`, name: p.name.slice(0, 80), source: 'catalogo' })} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted">
                      <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{p.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.code}</span>
                    </button>
                  ))}
                  {products.data && !products.data.length && <p className="text-sm text-muted-foreground">Nenhum produto com foto.</p>}
                </div>
              </TabsContent>
              <TabsContent value="ia" className="space-y-2 pt-2">
                <Textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Descreva a imagem. Ex.: escavadeira amarela trabalhando numa obra ao entardecer, foto realista" />
                <div className="flex items-center gap-2">
                  <Button type="button" onClick={() => ai.mutate()} disabled={ai.isPending || idea.trim().length < 5}>
                    {ai.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Gerar imagem
                  </Button>
                  <span className="text-xs text-muted-foreground">Gemini gratuito: a cota de imagens é pequena e pode acabar. A IA não escreve textos na imagem; use o título ao lado.</span>
                </div>
              </TabsContent>
            </Tabs>
            <div className="flex justify-center rounded-md border bg-muted/40 p-2">
              <canvas ref={canvas} width={w} height={h} className="h-auto max-h-[52vh] w-auto max-w-full rounded shadow-sm" aria-label="Prévia da imagem" />
            </div>
            {!photo && <p className="text-center text-sm text-muted-foreground">Escolha uma foto acima para começar.</p>}
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tamanho</Label>
              <Select value={opts.frame} onValueChange={(v) => set('frame', v as Frame)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FRAMES) as Frame[]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {FRAMES[f].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Enquadrar</Label>
                <Select value={opts.fit} onValueChange={(v) => set('fit', v as ArtOptions['fit'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cobrir">Preencher (corta)</SelectItem>
                    <SelectItem value="caber">Foto inteira</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="art-bg">Fundo</Label>
                <Input id="art-bg" type="color" value={opts.background} onChange={(e) => set('background', e.target.value)} className="h-9 p-1" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="art-h">Título na imagem (opcional)</Label>
              <Textarea id="art-h" rows={2} maxLength={90} value={opts.headline} onChange={(e) => set('headline', e.target.value)} placeholder="Ex.: Material rodante para Komatsu PC200" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="art-s">Subtítulo (opcional)</Label>
              <Input id="art-s" maxLength={120} value={opts.subtitle} onChange={(e) => set('subtitle', e.target.value)} placeholder="Ex.: Pronta entrega para todo o Brasil" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="art-tc">Cor do texto</Label>
                <Input id="art-tc" type="color" value={opts.textColor} onChange={(e) => set('textColor', e.target.value)} className="h-9 p-1" />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <Switch checked={opts.useLogo} onCheckedChange={(v) => set('useLogo', v)} disabled={!logo} /> Logo
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={opts.bar} onCheckedChange={(v) => set('bar', v)} /> Faixa da marca embaixo
            </label>
            {opts.bar && (
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <Input type="color" value={opts.barColor} onChange={(e) => set('barColor', e.target.value)} className="h-9 p-1" aria-label="Cor da faixa" />
                <Input maxLength={60} value={opts.barText} onChange={(e) => set('barText', e.target.value)} placeholder="Ex.: (49) 98863-2548 · usaparts.com.br" aria-label="Texto da faixa" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="art-n">Nome na biblioteca</Label>
              <Input id="art-n" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={!photo || save.isPending}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Guardar na biblioteca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Vídeo a partir de fotos ----------

export function VideoDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (m: Media) => void }) {
  const qc = useQueryClient()
  const branding = useBranding()
  const library = useMediaLibrary()
  const images = (library.data?.items ?? []).filter((m) => m.kind === 'imagem')
  const [picked, setPicked] = useState<string[]>([])
  const [seconds, setSeconds] = useState(3)
  const [frame, setFrame] = useState<Frame>('stories')
  const [headline, setHeadline] = useState('')
  const [barText, setBarText] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<Blob | null>(null)
  const preview = useMemo(() => (result ? URL.createObjectURL(result) : null), [result])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  useEffect(() => {
    if (open) {
      setPicked([])
      setResult(null)
      setProgress(null)
    }
  }, [open])
  const supported = mp4Type()
  const make = async () => {
    try {
      setResult(null)
      setProgress(0)
      const photos = await Promise.all(picked.map((id) => fetch(mediaSrc(id), { credentials: 'include' }).then((r) => r.blob()).then(loadImage)))
      const logo = branding.logoUrl ? await loadImage(branding.logoUrl).catch(() => null) : null
      const brand = branding.brandColor || branding.primaryColor
      setResult(await photosToVideo(photos, { frame, fit: 'cobrir', background: '#000000', headline, subtitle: '', bar: !!barText.trim(), barColor: brand, barText, logo, textColor: '#ffffff', seconds }, setProgress))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setProgress(null)
    }
  }
  const save = useMutation({
    mutationFn: () => upload(result!, { name: headline.trim() || 'Vídeo de fotos', source: 'video', width: FRAMES[frame].w, height: FRAMES[frame].h }),
    onSuccess: (m) => {
      toast.success('Vídeo guardado na biblioteca.')
      void qc.invalidateQueries({ queryKey: ['postagens-midias'] })
      onSaved?.(m)
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open={open} onOpenChange={(v) => !v && progress === null && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Vídeo a partir de fotos</DialogTitle>
          <DialogDescription>Escolha de 2 a 10 fotos da biblioteca, na ordem do vídeo. O CRM monta um vídeo MP4 para Reels ou Stories, com zoom suave, título e a faixa da marca.</DialogDescription>
        </DialogHeader>
        {!supported && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Este navegador não grava vídeo MP4 (o formato do Instagram). Use o Google Chrome atualizado ou o Microsoft Edge.</p>}
        <div className="grid max-h-56 grid-cols-6 gap-1.5 overflow-y-auto">
          {images.map((m) => {
            const i = picked.indexOf(m.id)
            return (
              <button key={m.id} type="button" onClick={() => setPicked(i >= 0 ? picked.filter((x) => x !== m.id) : picked.length < 10 ? [...picked, m.id] : picked)} className={cn('relative aspect-square overflow-hidden rounded-md border', i >= 0 && 'ring-2 ring-primary')}>
                <Thumb m={m} className="size-full" />
                {i >= 0 && <span className="absolute top-1 left-1 rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">{i + 1}</span>}
              </button>
            )
          })}
          {!images.length && <p className="col-span-6 text-sm text-muted-foreground">Guarde fotos na biblioteca primeiro (Preparar imagem).</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Formato</Label>
            <Select value={frame} onValueChange={(v) => setFrame(v as Frame)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stories">Vertical 9:16 (Reels e Stories)</SelectItem>
                <SelectItem value="quadrado">Quadrado 1:1</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vid-s">Segundos por foto</Label>
            <Input id="vid-s" type="number" min={2} max={8} value={seconds} onChange={(e) => setSeconds(Math.min(8, Math.max(2, Number(e.target.value) || 3)))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vid-b">Faixa da marca (opcional)</Label>
            <Input id="vid-b" maxLength={60} value={barText} onChange={(e) => setBarText(e.target.value)} placeholder="Ex.: (49) 98863-2548" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vid-h">Título no vídeo (opcional)</Label>
          <Input id="vid-h" maxLength={90} value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>
        {progress !== null && <p className="text-sm text-muted-foreground">Gravando o vídeo… {Math.round(progress * 100)}% (leva o tempo do vídeo; não feche esta janela).</p>}
        {preview && <video src={preview} controls className="mx-auto max-h-80 rounded-md bg-black" />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={progress !== null}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => void make()} disabled={!supported || picked.length < 2 || progress !== null}>
            {progress !== null ? <Loader2Icon className="animate-spin" /> : <FilmIcon />} Montar vídeo ({picked.length * seconds} s)
          </Button>
          <Button onClick={() => save.mutate()} disabled={!result || save.isPending}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Guardar na biblioteca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Envia um vídeo pronto (MP4) direto para a biblioteca. */
export function useVideoUpload(onSaved?: (m: Media) => void) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const send = useMutation({
    mutationFn: (f: File) => upload(f, { name: f.name.replace(/\.\w+$/, '').slice(0, 120), source: 'upload' }),
    onSuccess: (m) => {
      toast.success('Vídeo guardado na biblioteca.')
      void qc.invalidateQueries({ queryKey: ['postagens-midias'] })
      onSaved?.(m)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const element = (
    <input
      ref={input}
      type="file"
      accept="video/mp4,video/quicktime"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        if (f.size > 64 * 1024 * 1024) return void toast.error('Vídeo maior que 64 MB. Diminua o vídeo antes de enviar.')
        send.mutate(f)
      }}
    />
  )
  return { element, open: () => input.current?.click(), pending: send.isPending }
}

// ---------- Escolha das mídias da postagem ----------

/** Mídias escolhidas para a postagem, na ordem (carrossel), com os botões para trazer da biblioteca ou criar. */
export function MediaPicker({ value, onChange, frame, disabled }: { value: string[]; onChange: (ids: string[]) => void; frame: Frame; disabled?: boolean }) {
  const library = useMediaLibrary()
  const [browse, setBrowse] = useState(false)
  const [art, setArt] = useState(false)
  const [video, setVideo] = useState(false)
  const add = (m: Media) => onChange([...value.filter((x) => x !== m.id), m.id].slice(0, 10))
  const upload = useVideoUpload(add)
  const byId = new Map((library.data?.items ?? []).map((m) => [m.id, m]))
  const move = (i: number, d: -1 | 1) => {
    const next = [...value]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {upload.element}
      <div className="flex flex-wrap gap-2">
        {value.map((id, i) => {
          const m = byId.get(id)
          return (
            <div key={id} className="group relative size-24 overflow-hidden rounded-md border">
              {m ? <Thumb m={m} className="size-full" /> : <span className="flex size-full items-center justify-center text-xs text-muted-foreground">Mídia</span>}
              {!disabled && (
                <span className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" onClick={() => move(i, -1)} aria-label="Mover para antes" className="text-white">
                    <ArrowLeftIcon className="size-4" />
                  </button>
                  <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Tirar da postagem" className="text-white">
                    <XIcon className="size-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} aria-label="Mover para depois" className="text-white">
                    <ArrowRightIcon className="size-4" />
                  </button>
                </span>
              )}
              {value.length > 1 && <span className="absolute top-1 left-1 rounded-full bg-black/60 px-1.5 text-xs text-white">{i + 1}</span>}
            </div>
          )
        })}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setBrowse(true)}>
            <ImageIcon /> Da biblioteca
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setArt(true)}>
            <ImagePlusIcon /> Nova imagem / arte
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setVideo(true)}>
            <FilmIcon /> Vídeo de fotos
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={upload.open} disabled={upload.pending}>
            {upload.pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Enviar vídeo (MP4)
          </Button>
        </div>
      )}
      <LibraryDialog open={browse} onClose={() => setBrowse(false)} selected={value} onConfirm={(ids) => onChange(ids.slice(0, 10))} />
      <ArtDialog open={art} onClose={() => setArt(false)} frame={frame} onSaved={add} />
      <VideoDialog open={video} onClose={() => setVideo(false)} onSaved={add} />
    </div>
  )
}

function LibraryDialog({ open, onClose, selected, onConfirm }: { open: boolean; onClose: () => void; selected: string[]; onConfirm: (ids: string[]) => void }) {
  const library = useMediaLibrary()
  const [ids, setIds] = useState<string[]>(selected)
  useEffect(() => {
    if (open) setIds(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Escolher da biblioteca</DialogTitle>
          <DialogDescription>Marque na ordem em que devem aparecer (até 10 no carrossel).</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {library.data?.items.map((m) => {
            const i = ids.indexOf(m.id)
            return (
              <button key={m.id} type="button" onClick={() => setIds(i >= 0 ? ids.filter((x) => x !== m.id) : [...ids, m.id].slice(0, 10))} className={cn('relative aspect-square overflow-hidden rounded-md border text-left', i >= 0 && 'ring-2 ring-primary')}>
                <Thumb m={m} className="size-full" />
                {i >= 0 && <span className="absolute top-1 left-1 rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">{i + 1}</span>}
              </button>
            )
          })}
          {library.data && !library.data.items.length && <p className="col-span-5 text-sm text-muted-foreground">A biblioteca está vazia. Use “Nova imagem / arte” ou “Enviar vídeo”.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onConfirm(ids)
              onClose()
            }}
          >
            <CheckIcon /> Usar {ids.length} mídia(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Aba Biblioteca ----------

export function LibraryTab() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const confirm = useConfirm()
  const library = useMediaLibrary()
  const [art, setArt] = useState(false)
  const [video, setVideo] = useState(false)
  const [kind, setKind] = useState<'todas' | 'imagem' | 'video'>('todas')
  const upload = useVideoUpload()
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/postagens/midias/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['postagens-midias'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const items = (library.data?.items ?? []).filter((m) => kind === 'todas' || m.kind === kind)
  return (
    <div className="space-y-3">
      {upload.element}
      <div className="flex flex-wrap items-center gap-2">
        {can('postagens', 'create') && (
          <>
            <Button onClick={() => setArt(true)}>
              <ImagePlusIcon /> Nova imagem / arte
            </Button>
            <Button variant="outline" onClick={() => setVideo(true)}>
              <FilmIcon /> Vídeo de fotos
            </Button>
            <Button variant="outline" onClick={upload.open} disabled={upload.pending}>
              {upload.pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Enviar vídeo (MP4)
            </Button>
          </>
        )}
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger className="ml-auto w-40" aria-label="Tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Imagens e vídeos</SelectItem>
            <SelectItem value="imagem">Só imagens</SelectItem>
            <SelectItem value="video">Só vídeos</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((m) => (
          <figure key={m.id} className="group relative overflow-hidden rounded-lg border bg-card">
            <Thumb m={m} className="aspect-square w-full" />
            <figcaption className="space-y-0.5 p-2 text-xs">
              <span className="line-clamp-1 font-medium">{m.name}</span>
              <span className="block text-muted-foreground">
                {SOURCE[m.source] ?? m.source}
                {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
              </span>
            </figcaption>
            {can('postagens', 'delete') && (
              <button
                type="button"
                className="absolute top-1 right-1 hidden rounded-md bg-background/90 p-1 text-destructive shadow group-hover:block focus-visible:block"
                aria-label={`Apagar ${m.name}`}
                onClick={async () => (await confirm({ title: 'Apagar esta mídia?', description: 'Ela sai da biblioteca. Postagens já publicadas não mudam.', confirmLabel: 'Apagar' })) && remove.mutate(m.id)}
              >
                <Trash2Icon className="size-4" />
              </button>
            )}
          </figure>
        ))}
      </div>
      {library.data && !items.length && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mídia ainda. Crie uma imagem (do computador, do catálogo ou com IA) ou envie um vídeo.</p>}
      <ArtDialog open={art} onClose={() => setArt(false)} />
      <VideoDialog open={video} onClose={() => setVideo(false)} />
    </div>
  )
}

