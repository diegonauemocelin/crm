import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileArchiveIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, errorMessage } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Counts {
  novas: number
  existentes: number
  canceladas: number
  ignoradas: number
  erros: number
  pedidosCriados: number
  ctesLigados: number
}
interface Issue {
  file: string
  reason: string
  kind: 'ignorada' | 'erro'
}
interface ImportRow {
  id: string
  fileNames: string
  counts: Counts
  issues: Issue[]
  createdByName: string
  createdAt: string
}

const MAX_MB = 60

function Summary({ c }: { c: Counts }) {
  const items: [string, number, string?][] = [
    ['notas novas', c.novas],
    ['já existiam', c.existentes],
    ['canceladas', c.canceladas],
    ['ignoradas', c.ignoradas],
    ['com erro', c.erros, c.erros ? 'text-destructive' : undefined],
    ['pedidos criados', c.pedidosCriados],
    ['CT-e casados', c.ctesLigados],
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, n, cls]) => (
        <div key={label} className="rounded-md border p-2">
          <p className={cn('text-lg font-semibold tabular-nums', cls)}>{n}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  )
}

/** Notas ignoradas ou com erro: arquivo (no .zip, "zip › arquivo") e o motivo. */
function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null
  return (
    <div className="max-h-48 overflow-y-auto rounded-md border p-2 text-xs">
      {issues.map((i, k) => (
        <p key={k} className={i.kind === 'erro' ? 'text-destructive' : undefined}>
          <span className="font-medium">{i.file}</span>: {i.reason}
        </p>
      ))}
    </div>
  )
}

/**
 * Importação dos XMLs das NF-e de saída (o .zip do dia baixado do ERP): cria/completa os pedidos de frete pela chave e
 * casa os CT-es já recebidos. Arrastar e soltar ou escolher os arquivos; mostra o resumo e o histórico.
 */
export function ImportNfeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [over, setOver] = useState(false)
  const history = useQuery({ queryKey: ['fretes', 'nfe', 'importacoes'], queryFn: () => api.get<ImportRow[]>('/fretes/nfe/importacoes') })
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      for (const f of files) fd.append('arquivos', f)
      return api.post<{ id: string; counts: Counts; issues: Issue[] }>('/fretes/nfe/importar', fd)
    },
    onSuccess: (r) => {
      setFiles([])
      void qc.invalidateQueries({ queryKey: ['fretes'] })
      toast.success(`${r.counts.novas} nota(s) nova(s), ${r.counts.pedidosCriados} pedido(s) criado(s), ${r.counts.ctesLigados} CT-e casado(s).`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const pick = (list: FileList | null) => {
    const all = Array.from(list ?? [])
    const ok = all.filter((f) => /\.(xml|zip)$/i.test(f.name))
    if (ok.length < all.length) toast.error('Só arquivos .zip ou .xml.')
    const big = ok.find((f) => f.size > MAX_MB * 1024 * 1024)
    if (big) return void toast.error(`${big.name} tem mais de ${MAX_MB} MB.`)
    setFiles(ok.slice(0, 10))
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    pick(e.dataTransfer.files)
  }
  const r = m.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar XML de NF-e</DialogTitle>
          <DialogDescription>
            O .zip com os XMLs das notas emitidas no dia (baixado do ERP) ou os arquivos .xml. Entram só NF-e de saída autorizadas, emitidas pelos CNPJs das filiais; nota repetida é pulada pela chave e o evento de cancelamento cancela o pedido.
          </DialogDescription>
        </DialogHeader>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn('flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors', over && 'border-primary bg-primary/5 text-foreground')}
        >
          <FileArchiveIcon className="size-8" aria-hidden />
          {files.length ? <span className="break-all text-foreground">{files.map((f) => f.name).join(', ')}</span> : <span>Arraste o .zip (ou os .xml) aqui, ou clique para escolher</span>}
        </button>
        <input ref={input} type="file" multiple accept=".xml,.zip" className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
        {r && (
          <div className="space-y-2">
            <Summary c={r.counts} />
            <Issues issues={r.issues} />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium">Importações anteriores</p>
          {history.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
          {history.data?.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma ainda.</p>}
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {history.data?.map((h) => (
              <details key={h.id} className="rounded-md border px-2 py-1 text-xs">
                <summary className="cursor-pointer">
                  {dateTime(h.createdAt)} · {h.createdByName} · <span className="break-all">{h.fileNames}</span> — {h.counts.novas} novas, {h.counts.existentes} existentes, {h.counts.canceladas} canceladas, {h.counts.ignoradas} ignoradas, {h.counts.erros} com erro, {h.counts.ctesLigados} CT-e casados
                </summary>
                <div className="mt-1">
                  <Issues issues={h.issues} />
                </div>
              </details>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => m.mutate()} disabled={!files.length || m.isPending}>
            {m.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <UploadIcon aria-hidden />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
