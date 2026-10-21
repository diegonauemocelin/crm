import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, ReplaceIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface Result {
  from: string
  to: string
  applied: boolean
  total: number
  areas: { key: string; label: string; records: number; example: string | null }[]
}

/**
 * Trocar o nome da empresa em todos os textos salvos (pop-ups, formulários, e-mails não enviados, automações,
 * respostas rápidas, configurações...). Primeiro mostra o que muda; só troca depois de confirmar.
 */
export function CompanyRenameCard() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<Result | null>(null)
  const run = useMutation({
    mutationFn: (aplicar: boolean) => api.post<Result>('/settings/renomear-empresa', { de: from, para: to, aplicar }),
    onSuccess: (r) => {
      if (!r.applied) return setPreview(r)
      setPreview(null)
      setFrom('')
      void qc.invalidateQueries()
      toast.success(r.total ? `Nome trocado em ${r.total} registro(s).` : 'Nada para trocar.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!can('configuracoes', 'edit')) return null
  const ready = from.trim().length >= 3 && to.trim().length > 0
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReplaceIcon className="size-4" /> Trocar o nome da empresa nos textos
        </CardTitle>
        <CardDescription>
          Troca o nome antigo pelo novo em tudo o que já foi escrito: pop-ups, formulários e botões da Captura, campanhas de e-mail ainda não enviadas, automações, respostas rápidas, etiquetas, listas e configurações. Endereços de site e e-mail (ex.: usaparts.com.br) não mudam. Conversas, histórico e e-mails já enviados ficam como foram.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rn-from" required>Nome antigo</Label>
            <Input id="rn-from" placeholder="ex.: USA Parts" maxLength={80} value={from} onChange={(e) => (setFrom(e.target.value), setPreview(null))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rn-to" required>Nome novo</Label>
            <Input id="rn-to" placeholder="ex.: Usaparts" maxLength={80} value={to} onChange={(e) => (setTo(e.target.value), setPreview(null))} />
          </div>
        </div>
        {!ready && <p className="text-xs text-muted-foreground">Preencha o nome antigo (mínimo 3 caracteres) e o novo para ver o que muda.</p>}
        <p className="text-xs text-muted-foreground">Não diferencia maiúsculas e aceita espaço ou hífen no meio (“USA Parts”, “USA-PARTS”). O nome escrito todo em maiúsculas vira o novo em maiúsculas.</p>
        {preview && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            {preview.total === 0 ? (
              <p>Nenhum texto com “{preview.from}”. Nada a trocar.</p>
            ) : (
              <>
                <p className="mb-2 font-medium">
                  “{preview.from}” vira “{preview.to}” em {preview.total} registro(s):
                </p>
                <ul className="space-y-1">
                  {preview.areas.map((a) => (
                    <li key={a.key}>
                      <span className="font-medium">{a.label}:</span> {a.records}
                      {a.example && <span className="block truncate text-xs text-muted-foreground">ex.: {a.example}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" onClick={() => run.mutate(false)} disabled={!ready || run.isPending}>
          {run.isPending && !preview ? <Loader2Icon className="animate-spin" /> : null}
          Ver o que muda
        </Button>
        {preview && preview.total > 0 && (
          <Button onClick={() => run.mutate(true)} disabled={run.isPending}>
            {run.isPending && <Loader2Icon className="animate-spin" />}
            Trocar em {preview.total} registro(s)
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
