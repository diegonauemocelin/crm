import { DownloadIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { formatDateTime } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/lib/auth'
import { downloadCsv, num } from '@/lib/marketing'
import { cn } from '@/lib/utils'

/** Tabela simples com colunas formatadas (as telas das plataformas têm colunas diferentes das do CRM). */
export interface Col<T> {
  label: string
  value: (r: T) => ReactNode
  right?: boolean
  csv?: (r: T) => string | number | null
}
export function SimpleTable<T>({ title, description, rows, cols, rowKey, exportName, exportModule, empty = 'Sem dados no período.', limit = 50 }: { title: string; description?: ReactNode; rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; exportName?: string; /** Módulo que libera o CSV (padrão: mídia paga ou executivo do Marketing Inteligente). */ exportModule?: string; empty?: string; limit?: number }) {
  const { can } = useAuth()
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, limit)
  const canExport = exportName && (exportModule ? can(exportModule, 'export') : can('mi_midia', 'export') || can('mi_executivo', 'export'))
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {canExport && rows.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => downloadCsv(exportName, cols.map((c) => c.label), rows.map((r) => cols.map((c) => (c.csv ? c.csv(r) : String(c.value(r) ?? '')))))}>
            <DownloadIcon /> CSV
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c, i) => (
                  <TableHead key={c.label} className={cn(i === 0 && 'pl-6', c.right && 'text-right')}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={rowKey(r)}>
                  {cols.map((c, i) => (
                    <TableCell key={c.label} className={cn(i === 0 && 'max-w-80 pl-6', c.right && 'text-right tabular-nums')}>
                      {c.value(r)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rows.length > limit && (
          <div className="px-6 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
              {all ? 'Mostrar menos' : `Mostrar todas (${rows.length})`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export const NA = <span className="text-muted-foreground" title="A plataforma não informou esta métrica">Não disponível</span>
export const optNum = (v: number | null | undefined) => (v === null || v === undefined ? NA : num(v))
export const SyncLine = ({ sync, label }: { sync: { lastOkAt?: string; lastError?: string | null } | null; label: string }) => (
  <p className={cn('text-xs', sync?.lastError ? 'text-red-600' : 'text-muted-foreground')}>
    {label}: {sync?.lastOkAt ? `sincronizado em ${formatDateTime(sync.lastOkAt)}` : 'ainda não sincronizado'}
    {sync?.lastError ? ` · última tentativa falhou: ${sync.lastError}` : ''}
  </p>
)


/** Miniatura da publicação (imagem do próprio Instagram/Facebook). Some sozinha se o link da Meta expirar. */
export function Thumb({ src, alt }: { src?: string | number | null; alt: string }) {
  const [broken, setBroken] = useState(false)
  if (typeof src !== 'string' || !src || broken) return <div className="size-12 shrink-0 rounded-md bg-muted" aria-hidden />
  // Passa pelo CRM: o Instagram bloqueia mostrar as imagens dele direto em outro site.
  return <img src={`/api/marketing/miniatura?u=${encodeURIComponent(src)}`} alt={alt} loading="lazy" onError={() => setBroken(true)} className="size-12 shrink-0 rounded-md object-cover" />
}
