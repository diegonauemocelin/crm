import { FlipHorizontal2Icon, FlipVertical2Icon, Loader2Icon, RotateCcwIcon, RotateCwIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { IMAGE_RATIOS, type ImageRatio } from '@/lib/email'
import { type Adjust, applyAdjust, dragRect, EMAIL_IMAGE_LIMIT, editableUrl, editedName, fitRect, type Handle, MAX_ZOOM, NO_ADJUST, outputSize, outputType, type RatioChoice, ratioValue, type Rect, zoomOf, zoomRect } from '@/lib/image-edit'
import { cn } from '@/lib/utils'

/**
 * Editor de imagem do e-mail, todo no navegador (canvas): recorte livre ou nos formatos prontos, girar, espelhar,
 * aproximar e ajustes simples (brilho, contraste, saturação). Salvar gera um arquivo novo; a imagem original fica
 * como está (pode estar em outros e-mails).
 */

// ---------- Desenho ----------

interface View {
  rot: 0 | 1 | 2 | 3
  flipH: boolean
  flipV: boolean
}

const rotatedSize = (img: HTMLImageElement, v: View) => (v.rot % 2 ? { w: img.naturalHeight, h: img.naturalWidth } : { w: img.naturalWidth, h: img.naturalHeight })

/** Desenha a imagem girada/espelhada no espaço já girado (o chamador escala e desloca antes). */
function drawView(ctx: CanvasRenderingContext2D, img: HTMLImageElement, v: View) {
  const { w, h } = rotatedSize(img, v)
  ctx.translate(w / 2, h / 2)
  ctx.scale(v.flipH ? -1 : 1, v.flipV ? -1 : 1)
  ctx.rotate((v.rot * Math.PI) / 2)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, quality))
}

async function render(img: HTMLImageElement, v: View, crop: Rect, adj: Adjust, type: string, quality?: number): Promise<Blob | null> {
  const size = outputSize(crop)
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (type === 'image/jpeg') {
    // JPEG não tem transparência: fundo branco (o mesmo do e-mail).
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size.w, size.h)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.save()
  ctx.scale(size.w / crop.w, size.h / crop.h)
  ctx.translate(-crop.x, -crop.y)
  drawView(ctx, img, v)
  ctx.restore()
  if (adj.brightness !== 100 || adj.contrast !== 100 || adj.saturation !== 100) {
    const data = ctx.getImageData(0, 0, size.w, size.h)
    applyAdjust(data.data, adj)
    ctx.putImageData(data, 0, 0)
  }
  return toBlob(canvas, type, quality)
}

/** Gera o arquivo no formato da origem; se passar do limite, tenta WebP e depois JPEG com menos qualidade. */
async function exportFile(img: HTMLImageElement, v: View, crop: Rect, adj: Adjust, mime: string): Promise<Blob | null> {
  const first = outputType(mime)
  const tries: [string, number | undefined][] = [[first, first === 'image/png' ? undefined : 0.85]]
  if (first !== 'image/webp') tries.push(['image/webp', 0.85])
  tries.push(['image/jpeg', 0.85], ['image/jpeg', 0.7], ['image/jpeg', 0.55])
  let last: Blob | null = null
  for (const [type, q] of tries) {
    const blob = await render(img, v, crop, adj, type, q)
    // Navegador sem WebP devolve PNG: pula para o próximo.
    if (!blob || blob.type !== type) continue
    last = blob
    if (blob.size <= EMAIL_IMAGE_LIMIT) return blob
  }
  return last
}

// ---------- Diálogo ----------

const STAGE_W = 520
const STAGE_H = 360

export function ImageEditDialog(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  src: string
  name?: string | null
  /** Formato já escolhido ao abrir (ex.: clicou em 16:9 no painel). */
  initialRatio?: RatioChoice
  /** Envia o arquivo novo; o diálogo fecha quando terminar. */
  onSave: (file: File, ratio: ImageRatio | undefined) => Promise<void>
}) {
  const { open, src } = props
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [mime, setMime] = useState('image/png')
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ rot: 0, flipH: false, flipV: false })
  const [ratio, setRatio] = useState<RatioChoice>('livre')
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 })
  const [adj, setAdj] = useState<Adjust>(NO_ADJUST)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Largura do palco (menor no celular).
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageW, setStageW] = useState(STAGE_W)
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setStageW(Math.max(160, Math.min(STAGE_W, el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Rect } | null>(null)

  // Abre a imagem (como arquivo, para saber o formato e poder exportar pelo canvas).
  useEffect(() => {
    if (!open || !src) return
    let alive = true
    let objectUrl: string | null = null
    setImg(null)
    setError(null)
    setView({ rot: 0, flipH: false, flipV: false })
    setAdj(NO_ADJUST)
    ;(async () => {
      try {
        const url = editableUrl(src)
        const el = new Image()
        let type: string
        if (url.startsWith('/')) {
          // Imagem do próprio sistema: baixa o arquivo (dá o formato certo).
          const res = await fetch(url, { credentials: 'same-origin' })
          if (!res.ok) throw new Error('http')
          const blob = await res.blob()
          if (!blob.type.startsWith('image/')) throw new Error('tipo')
          objectUrl = URL.createObjectURL(blob)
          el.src = objectUrl
          type = blob.type
        } else {
          // De outro site: só abre se o site permitir (CORS); o formato sai pela extensão.
          el.crossOrigin = 'anonymous'
          el.src = url
          type = /\.jpe?g(\?|$)/i.test(url) ? 'image/jpeg' : /\.webp(\?|$)/i.test(url) ? 'image/webp' : 'image/png'
        }
        await el.decode()
        if (!alive) return
        const r0 = props.initialRatio ?? 'livre'
        setMime(type)
        setRatio(r0)
        setCrop(fitRect(el.naturalWidth, el.naturalHeight, ratioValue(r0, el.naturalWidth, el.naturalHeight)))
        setImg(el)
      } catch {
        if (alive) setError('Não deu para abrir esta imagem para edição. Se ela é de outro site, envie o arquivo na aba Imagens e use a imagem da biblioteca.')
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reabre só quando muda a imagem ou o diálogo abre
  }, [open, src])

  const size = img ? rotatedSize(img, view) : { w: 1, h: 1 }
  const scale = Math.min(stageW / size.w, STAGE_H / size.h)
  const ratioNum = ratioValue(ratio, size.w, size.h)

  // Pré-visualização (o filtro de brilho/contraste/saturação vai pelo CSS, igual ao arquivo final).
  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c || !img) return
    const dpr = window.devicePixelRatio || 1
    const s = scale
    c.width = Math.round(size.w * s * dpr)
    c.height = Math.round(size.h * s * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.save()
    ctx.scale(s * dpr, s * dpr)
    drawView(ctx, img, view)
    ctx.restore()
  }, [img, view, size.w, size.h, scale])

  const pickRatio = (r: RatioChoice) => {
    setRatio(r)
    setCrop(fitRect(size.w, size.h, ratioValue(r, size.w, size.h)))
  }
  const rotate = (d: 1 | -1) => {
    const next = { ...view, rot: (((view.rot + d) % 4) + 4) % 4 } as View
    setView(next)
    if (img) {
      const s2 = rotatedSize(img, next)
      setCrop(fitRect(s2.w, s2.h, ratioValue(ratio, s2.w, s2.h)))
    }
  }
  const zoom = zoomOf(crop, size.w, size.h)
  const setZoom = useCallback((z: number) => setCrop((r) => zoomRect(r, size.w, size.h, ratioNum, z)), [size.w, size.h, ratioNum])
  const reset = () => {
    setView({ rot: 0, flipH: false, flipV: false })
    setAdj(NO_ADJUST)
    setRatio('livre')
    if (img) setCrop({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight })
  }

  const down = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop }
  }
  const moveTo = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    setCrop(dragRect(d.start, d.handle, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale, size.w, size.h, ratioNum))
  }
  const up = () => {
    drag.current = null
  }

  const save = async () => {
    if (!img) return
    setSaving(true)
    try {
      const blob = await exportFile(img, view, crop, adj, mime)
      if (!blob) throw new Error('Não deu para gerar a imagem neste navegador.')
      if (blob.size > EMAIL_IMAGE_LIMIT) throw new Error('A imagem editada passou de 1,5 MB. Recorte uma parte menor.')
      const file = new File([blob], editedName(props.name, blob.type), { type: blob.type })
      await props.onSave(file, ratio === 'livre' || ratio === 'original' ? undefined : ratio)
      props.onOpenChange(false)
    } catch (err) {
      // O envio já avisa o erro dele; aqui só o que é do navegador.
      if (err instanceof Error && !('status' in err)) toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const out = outputSize(crop)
  const filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturation}%)`
  const ratioOptions: { id: RatioChoice; label: string }[] = [{ id: 'livre', label: 'Livre' }, { id: 'original', label: 'Original' }, ...IMAGE_RATIOS.map((r) => ({ id: r.id, label: r.id === r.label ? r.id : `${r.label} ${r.id}` }))]

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && props.onOpenChange(v)}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Editar imagem</DialogTitle>
          <DialogDescription>Recorte, gire e ajuste. Ao salvar, vira uma imagem nova na biblioteca; a original continua igual.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]">
          <div className="space-y-2">
            <div
              ref={stageRef}
              className="relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(#e5e7eb_0_25%,#f9fafb_0_50%)] bg-[length:16px_16px]"
              style={{ maxWidth: STAGE_W, height: STAGE_H }}
              onWheel={(e) => img && setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
            >
              {error ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{error}</p>
              ) : !img ? (
                <Loader2Icon className="animate-spin text-muted-foreground" />
              ) : (
                <div className="relative touch-none select-none" style={{ width: size.w * scale, height: size.h * scale }} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up}>
                  <canvas ref={canvasRef} className="block size-full" style={{ filter }} />
                  <div
                    className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                    style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }}
                    onPointerDown={down('move')}
                  >
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                      {Array.from({ length: 9 }, (_, i) => (
                        <div key={i} className="border-[0.5px] border-white/40" />
                      ))}
                    </div>
                    {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                      <span
                        key={h}
                        role="presentation"
                        onPointerDown={down(h)}
                        className={cn(
                          'absolute size-4 rounded-sm border-2 border-white bg-[color:var(--brand)]',
                          h === 'nw' && '-top-2 -left-2 cursor-nwse-resize',
                          h === 'ne' && '-top-2 -right-2 cursor-nesw-resize',
                          h === 'sw' && '-bottom-2 -left-2 cursor-nesw-resize',
                          h === 'se' && '-right-2 -bottom-2 cursor-nwse-resize',
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Arraste o quadro para mover e os cantos para mudar o tamanho. Imagem final: {out.w} × {out.h} px
              {img && crop.w < 600 ? ' (pequena: no e-mail pode ficar menos nítida)' : ''}.
            </p>
          </div>

          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label>Formato</Label>
              <div className="flex flex-wrap gap-1">
                {ratioOptions.map((r) => (
                  <Button key={r.id} type="button" size="sm" variant={ratio === r.id ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => pickRatio(r.id)} disabled={!img}>
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Girar e espelhar</Label>
              <div className="flex gap-1">
                <IconBtn label="Girar para a esquerda" onClick={() => rotate(-1)} disabled={!img}>
                  <RotateCcwIcon />
                </IconBtn>
                <IconBtn label="Girar para a direita" onClick={() => rotate(1)} disabled={!img}>
                  <RotateCwIcon />
                </IconBtn>
                <IconBtn label="Espelhar na horizontal" active={view.flipH} onClick={() => setView((v) => ({ ...v, flipH: !v.flipH }))} disabled={!img}>
                  <FlipHorizontal2Icon />
                </IconBtn>
                <IconBtn label="Espelhar na vertical" active={view.flipV} onClick={() => setView((v) => ({ ...v, flipV: !v.flipV }))} disabled={!img}>
                  <FlipVertical2Icon />
                </IconBtn>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ie-zoom">Aproximar</Label>
              <div className="flex items-center gap-1">
                <IconBtn label="Afastar" onClick={() => setZoom(zoom / 1.2)} disabled={!img || zoom <= 1}>
                  <ZoomOutIcon />
                </IconBtn>
                <input id="ie-zoom" type="range" min={1} max={MAX_ZOOM} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} disabled={!img} className="w-full accent-[color:var(--brand)]" />
                <IconBtn label="Aproximar" onClick={() => setZoom(zoom * 1.2)} disabled={!img || zoom >= MAX_ZOOM}>
                  <ZoomInIcon />
                </IconBtn>
              </div>
            </div>
            {(
              [
                ['brightness', 'Brilho'],
                ['contrast', 'Contraste'],
                ['saturation', 'Saturação'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`ie-${k}`}>{label}</Label>
                  <button type="button" className="text-xs text-muted-foreground tabular-nums hover:underline" onClick={() => setAdj((a) => ({ ...a, [k]: 100 }))} title="Voltar ao normal">
                    {adj[k] > 100 ? '+' : ''}
                    {adj[k] - 100}
                  </button>
                </div>
                <input id={`ie-${k}`} type="range" min={50} max={150} step={1} value={adj[k]} onChange={(e) => setAdj((a) => ({ ...a, [k]: Number(e.target.value) }))} disabled={!img} className="w-full accent-[color:var(--brand)]" />
              </div>
            ))}
            {mime === 'image/gif' && <p className="text-xs text-muted-foreground">GIF animado vira uma imagem parada (PNG).</p>}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={reset} disabled={!img || saving}>
            Desfazer tudo
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!img || saving}>
              {saving && <Loader2Icon className="animate-spin" />} Salvar como nova imagem
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IconBtn({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <Button type="button" size="icon" variant={active ? 'secondary' : 'outline'} className="size-8" aria-label={label} title={label} aria-pressed={active} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  )
}
