import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, FileUpIcon, Loader2Icon, SearchCheckIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { brl, int, type Kind, KIND_INFO } from '@/lib/atendimento'

interface Summary {
  dryRun: boolean
  imported?: number
  rowsRead: number
  alreadyImported: number
  toImport: number
  sales: number
  revenue: number
  sellers: { name: string; total: number }[]
  origins: { name: string; total: number }[]
  brands: { name: string; total: number }[]
  partTypes: { name: string; total: number }[]
  lostReasons: { name: string; total: number }[]
  issues: { line: number; message: string }[]
  issuesTotal: number
}

function Top({ title, items }: { title: string; items: { name: string; total: number }[] }) {
  if (!items.length) return null
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-0.5 text-sm">
        {items.slice(0, 6).map((i) => (
          <li key={i.name} className="flex justify-between gap-2">
            <span className="truncate">{i.name}</span>
            <span className="text-muted-foreground tabular-nums">{int.format(i.total)}</span>
          </li>
        ))}
        {items.length > 6 && <li className="text-xs text-muted-foreground">+{items.length - 6} outros</li>}
      </ul>
    </div>
  )
}

/** Importação da planilha atual: analisa primeiro (sem gravar nada) e só importa após a confirmação. */
export function ImportDialog({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const run = async (dryRun: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<Summary>('/atendimentos/importar', { kind, dryRun, ...(csv ? { csv: csv.text } : { url }) })
      setSummary(res)
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ['atendimentos'] })
        void qc.invalidateQueries({ queryKey: ['atendimento-options'] })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const done = summary && !summary.dryRun

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar planilha para {KIND_INFO[kind].title}</DialogTitle>
          <DialogDescription>
            Primeiro o sistema analisa a planilha e mostra o que vai entrar. Nada é gravado antes da sua confirmação. Linhas já importadas são ignoradas, então pode importar a mesma planilha de novo.
          </DialogDescription>
        </DialogHeader>

        {!summary && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="imp-url">Link do Google Planilhas</Label>
              <Input
                id="imp-url"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={url}
                disabled={!!csv}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">A planilha precisa estar compartilhada como “Qualquer pessoa com o link: leitor” durante a importação.</p>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              ou
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={file}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 2 * 1024 * 1024) return setError('Arquivo maior que 2 MB.')
                  setCsv({ name: f.name, text: await f.text() })
                }}
              />
              <Button type="button" variant="outline" onClick={() => file.current?.click()}>
                <FileUpIcon /> Enviar arquivo CSV
              </Button>
              {csv && (
                <span className="text-sm">
                  {csv.name}{' '}
                  <button type="button" className="text-muted-foreground underline" onClick={() => setCsv(null)}>
                    remover
                  </button>
                </span>
              )}
            </div>
          </div>
        )}

        {summary && (
          <div className="space-y-4">
            {done ? (
              <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <CheckCircle2Icon className="size-4 text-emerald-600" />
                {int.format(summary.imported ?? 0)} atendimento(s) importado(s) para {KIND_INFO[kind].title}.
              </p>
            ) : (
              <p className="rounded-md border bg-muted/50 p-3 text-sm">
                Análise concluída. Confira abaixo e confirme para importar.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Linhas com dados', int.format(summary.rowsRead)],
                ['Já importadas antes', int.format(summary.alreadyImported)],
                [done ? 'Importadas agora' : 'Serão importadas', int.format(done ? (summary.imported ?? 0) : summary.toImport)],
                ['Vendas / valor', `${int.format(summary.sales)} · ${brl.format(summary.revenue)}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-4 sm:grid-cols-3">
              <Top title="Vendedores" items={summary.sellers} />
              <Top title="Origens" items={summary.origins} />
              <Top title="Motivos de perda" items={summary.lostReasons} />
              <Top title="Marcas da máquina" items={summary.brands} />
              <Top title="Tipos de peça" items={summary.partTypes} />
            </div>
            <p className="text-xs text-muted-foreground">
              Itens novos (vendedores, origens, marcas…) são criados automaticamente nos cadastros. Ajustes aplicados: “~” removido dos nomes, “s/c” vira código vazio, telefones padronizados, “Vendeu” vira venda realizada e “Aguardando vendedor” vira retorno pendente.
            </p>
            {summary.issuesTotal > 0 && (
              <details className="rounded-md border p-3 text-sm" open={summary.issuesTotal <= 5}>
                <summary className="cursor-pointer font-medium">{int.format(summary.issuesTotal)} aviso(s) para conferir</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-muted-foreground">
                  {summary.issues.map((i) => (
                    <li key={`${i.line}-${i.message}`}>
                      Linha {i.line}: {i.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="outline" onClick={summary ? () => setSummary(null) : onClose} disabled={busy}>
                {summary ? 'Voltar' : 'Cancelar'}
              </Button>
              {summary ? (
                <Button onClick={() => run(false)} disabled={busy || summary.toImport === 0}>
                  {busy && <Loader2Icon className="animate-spin" />}
                  {summary.toImport === 0 ? 'Nada novo para importar' : `Importar ${int.format(summary.toImport)} atendimento(s)`}
                </Button>
              ) : (
                <Button onClick={() => run(true)} disabled={busy || (!url.trim() && !csv)}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <SearchCheckIcon />}
                  Analisar planilha
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
