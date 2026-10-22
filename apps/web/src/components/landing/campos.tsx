import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, ImageIcon, Loader2Icon, PackageSearchIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import type { EmailImage } from '@/lib/email'
import type { FieldDef, LandingOptions } from '@/lib/landing'
import { cn } from '@/lib/utils'

type Values = Record<string, unknown>

/** Campos de um bloco (ou de um item de lista), montados pela definição que vem do servidor. */
export function Fields({ fields, value, onChange, options, disabled, idPrefix }: { fields: FieldDef[]; value: Values; onChange: (v: Values) => void; options: LandingOptions; disabled?: boolean; idPrefix: string }) {
  return (
    <div className="space-y-3">
      {fields
        .filter((f) => !f.showIf || f.showIf.values.includes(String(value[f.showIf.key] ?? '')))
        .map((f) => (
          <Field key={f.key} f={f} value={value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} options={options} disabled={disabled} id={`${idPrefix}-${f.key}`} />
        ))}
    </div>
  )
}

function Field({ f, value, onChange, options, disabled, id }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; options: LandingOptions; disabled?: boolean; id: string }) {
  const s = typeof value === 'string' ? value : ''
  const label = (
    <Label htmlFor={id} className="text-xs">
      {f.label}
    </Label>
  )
  const hint = f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>
  const count = f.max && s.length > f.max * 0.8 && <p className="text-right text-[11px] text-muted-foreground tabular-nums">{s.length}/{f.max}</p>
  switch (f.type) {
    case 'text':
    case 'url':
      return (
        <div className="space-y-1">
          {label}
          <Input id={id} value={s} maxLength={f.type === 'url' ? 1000 : f.max} placeholder={f.placeholder ?? (f.type === 'url' ? 'https://' : undefined)} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
          {count}
          {hint}
        </div>
      )
    case 'textarea':
      return (
        <div className="space-y-1">
          {label}
          <Textarea id={id} rows={s.length > 200 ? 6 : 3} value={s} maxLength={f.max} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
          {count}
          {hint}
        </div>
      )
    case 'datetime':
      return (
        <div className="space-y-1">
          {label}
          <Input id={id} type="datetime-local" value={s} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
          {hint}
        </div>
      )
    case 'select':
    case 'icon':
      return (
        <div className="space-y-1">
          {label}
          <Select value={s || f.options?.[0]?.value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(f.options ?? []).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {f.type === 'icon' && <IconSvg svg={options.icons.find((i) => i.key === o.value)?.svg ?? ''} />}
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hint}
        </div>
      )
    case 'form':
    case 'whatsapp': {
      const list = f.type === 'form' ? options.forms : options.whatsapps
      return (
        <div className="space-y-1">
          {label}
          <Select value={s || undefined} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder={list.length ? 'Escolha' : f.type === 'form' ? 'Crie um formulário em Captura' : 'Crie um botão de WhatsApp em Captura'} />
            </SelectTrigger>
            <SelectContent>
              {list.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hint}
        </div>
      )
    }
    case 'image':
      return (
        <div className="space-y-1">
          {label}
          <ImageField id={id} value={s} onChange={onChange} disabled={disabled} />
          {hint}
        </div>
      )
    case 'boolean':
      return null
    case 'list':
      return <ListField f={f} value={Array.isArray(value) ? (value as Values[]) : []} onChange={onChange} options={options} disabled={disabled} id={id} />
  }
}

export function IconSvg({ svg, className }: { svg: string; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
}

function ListField({ f, value, onChange, options, disabled, id }: { f: FieldDef; value: Values[]; onChange: (v: Values[]) => void; options: LandingOptions; disabled?: boolean; id: string }) {
  const max = f.maxItems ?? 12
  const empty = () => Object.fromEntries((f.item ?? []).map((i) => [i.key, i.type === 'select' || i.type === 'icon' ? (i.options?.[0]?.value ?? '') : '']))
  const move = (i: number, d: number) => {
    const next = [...value]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x!)
    onChange(next)
  }
  const isProducts = f.key === 'items' && (f.item ?? []).some((i) => i.key === 'price')
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">
          {f.label} ({value.length}/{max})
        </Label>
        <div className="flex gap-1">
          {isProducts && !disabled && value.length < max && <ProductPicker onPick={(p) => onChange([...value, { ...empty(), name: p.name, image: p.image ?? '', url: p.url ?? '', ctaText: 'Quero este' }])} />}
          {!disabled && value.length < max && (
            <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, empty()])}>
              <PlusIcon /> Adicionar
            </Button>
          )}
        </div>
      </div>
      {value.map((item, i) => (
        <div key={i} className="space-y-2 rounded-md border bg-muted/20 p-2.5">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {i + 1}. {String(item.title || item.name || item.q || item.value || item.caption || '')}
            </span>
            {!disabled && (
              <span className="flex shrink-0">
                <Button type="button" size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir item">
                  <ArrowUpIcon />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Descer item">
                  <ArrowDownIcon />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" disabled={value.length >= max} onClick={() => onChange([...value.slice(0, i + 1), { ...item }, ...value.slice(i + 1)])} aria-label="Duplicar item">
                  <CopyIcon />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remover item">
                  <Trash2Icon />
                </Button>
              </span>
            )}
          </div>
          <Fields fields={f.item ?? []} value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} options={options} disabled={disabled} idPrefix={`${id}-${i}`} />
        </div>
      ))}
    </div>
  )
}

/** Imagem: da biblioteca do e-mail marketing (mesmas imagens), envio de arquivo ou endereço https. */
function ImageField({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const images = useQuery({ queryKey: ['email-images'], queryFn: () => api.get<EmailImage[]>('/email/imagens'), enabled: open })
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post<EmailImage>('/email/imagens', form)
    },
    onSuccess: (img) => {
      void qc.invalidateQueries({ queryKey: ['email-images'] })
      onChange(img.url)
      setOpen(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">{value ? <img src={value} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" />}</div>
      <Input id={id} value={value} placeholder="https://… ou escolha" onChange={(e) => onChange(e.target.value)} disabled={disabled} className="min-w-0" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={disabled}>
            Escolher
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => (e.target.files?.[0] && upload.mutate(e.target.files[0]), (e.target.value = ''))} />
          <Button type="button" size="sm" className="mb-2 w-full" onClick={() => input.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Enviar imagem
          </Button>
          <p className="mb-2 text-xs text-muted-foreground">PNG, JPG, GIF ou WEBP até 1,5 MB. Topo: 1600 px de largura.</p>
          {images.isLoading ? (
            <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />
          ) : (
            <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
              {(images.data ?? []).map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className="aspect-square overflow-hidden rounded border hover:ring-2 hover:ring-primary"
                  onClick={() => {
                    onChange(img.url)
                    setOpen(false)
                  }}
                >
                  <img src={img.url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              ))}
              {!images.data?.length && <p className="col-span-3 py-3 text-center text-xs text-muted-foreground">Nenhuma imagem enviada ainda.</p>}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => onChange('')} aria-label="Tirar a imagem">
          <Trash2Icon />
        </Button>
      )}
    </div>
  )
}

interface CatalogProduct {
  id: string
  code: string
  name: string
  image: string | null
  url: string | null
  price: number | null
}

/** Busca no catálogo da loja (Magazord) para o bloco de produtos. O preço não entra sozinho: muda com o tempo. */
function ProductPicker({ onPick }: { onPick: (p: CatalogProduct) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const list = useQuery({ queryKey: ['landing-produtos', q], queryFn: () => api.get<CatalogProduct[]>(`/landing/produtos?q=${encodeURIComponent(q)}`), enabled: open })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <PackageSearchIcon /> Do catálogo
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou código do produto" className="mb-2" />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {list.isLoading && <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />}
          {(list.data ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center gap-2 rounded p-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                onPick(p)
                setOpen(false)
              }}
            >
              <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">{p.image ? <img src={p.image} alt="" className="size-full object-contain" /> : <ImageIcon className="size-4 text-muted-foreground" />}</span>
              <span className="min-w-0">
                <span className="line-clamp-1">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.code}</span>
              </span>
            </button>
          ))}
          {list.data && !list.data.length && <p className="py-3 text-center text-xs text-muted-foreground">Nada encontrado no catálogo.</p>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">O preço não é copiado (muda com o tempo). Se quiser mostrar, preencha e confirme com o Comercial.</p>
      </PopoverContent>
    </Popover>
  )
}
