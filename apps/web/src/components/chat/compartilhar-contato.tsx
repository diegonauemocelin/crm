import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ContactIcon, Loader2Icon, SearchIcon, SendIcon } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useCloseGuard } from '@/components/confirm'
import { InlineError } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, maskPhone } from '@/lib/atendimento'
import { phoneFromText } from '@/lib/links'
import { cn } from '@/lib/utils'

/** Compartilhar contato no chat: escolhe um vendedor, alguém da agenda ou um lead, ou digita nome e telefone. */

interface Option {
  key: string
  name: string
  phone: string
  source: string
}

export function ShareContactButton({ conversationId, disabled }: { conversationId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" size="icon" variant="ghost" onClick={() => setOpen(true)} disabled={disabled} aria-label="Compartilhar contato (cartão com nome e telefone)">
        <ContactIcon />
      </Button>
      {open && <ShareContactDialog conversationId={conversationId} onClose={() => setOpen(false)} />}
    </>
  )
}

function ShareContactDialog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Option | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const options = useQuery({
    queryKey: ['chat-compartilhar', q],
    queryFn: () => api.get<Option[]>(`/chat/contatos-para-compartilhar${q ? `?busca=${encodeURIComponent(q)}` : ''}`),
    placeholderData: keepPreviousData,
  })
  const send = useMutation({
    mutationFn: (d: { name: string; phone: string }) => api.post(`/chat/conversas/${conversationId}/contato`, d),
    onSuccess: () => {
      toast.success('Contato enviado.')
      void qc.invalidateQueries({ queryKey: ['chat-conversa', conversationId] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const pick = (o: Option) => {
    setPicked(o)
    setName(o.name)
    setPhone(o.phone.startsWith('+55') ? formatPhone(o.phone) : o.phone)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) return
    send.mutate({ name: name.trim(), phone: phone.trim() })
  }
  // Nome ou telefone digitados: pergunta antes de fechar.
  const guard = useCloseGuard(!!(name.trim() || phone.trim()), onClose, 'o contato')
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartilhar contato</DialogTitle>
          <DialogDescription>O cliente recebe um cartão com nome e telefone e pode conversar ou salvar direto no WhatsApp.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar vendedor, agenda ou lead" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar contato para compartilhar" autoFocus />
            </div>
            <ul className="max-h-56 overflow-y-auto rounded-md border" role="listbox" aria-label="Contatos">
              {options.isLoading && <li className="p-3 text-sm text-muted-foreground">Carregando…</li>}
              {options.error && !options.data && (
                <li className="p-3">
                  <InlineError error={options.error} onRetry={() => void options.refetch()} />
                </li>
              )}
              {options.data?.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">
                  {q ? 'Nenhum contato com esse nome. Digite nome e telefone abaixo.' : 'Digite um nome para buscar nos vendedores, na agenda e nos leads, ou preencha nome e telefone abaixo.'}
                </li>
              )}
              {options.data?.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={picked?.key === o.key}
                    onClick={() => pick(o)}
                    className={cn('flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted', picked?.key === o.key && 'bg-accent')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">{o.phone.startsWith('+55') ? formatPhone(o.phone) : o.phone}</span>
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">{o.source}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="share-name" required>Nome no cartão</Label>
              <Input id="share-name" value={name} maxLength={80} onChange={(e) => (setName(e.target.value), setPicked(null))} placeholder="ex.: Roberto - Vendas" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-phone" required>Telefone</Label>
              <Input id="share-phone" value={phone} maxLength={30} inputMode="tel" onChange={(e) => (setPhone(e.target.value.startsWith('+') ? e.target.value : maskPhone(e.target.value)), setPicked(null))} placeholder="(47) 99999-0000" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || !phone.trim() || send.isPending}>
              {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar contato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Cartão do contato na conversa (enviado ou recebido): nome e telefone, com ligar e (chat) conversar no WhatsApp. */
export function ContactBubble({ text, chat }: { text: string | null; chat?: (phone: string) => ReactNode }) {
  const lines = (text ?? 'Contato').split('\n').filter(Boolean)
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const [name, tel] = line.split(' · ')
        return (
          <div key={i} className="flex items-center gap-2 rounded-md border bg-background/60 px-2.5 py-1.5">
            <ContactIcon className="size-5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name}</span>
              {tel && (
                <a href={`tel:${tel.replace(/[^\d+]/g, '')}`} className="block text-xs underline-offset-4 hover:underline">
                  {tel}
                </a>
              )}
            </span>
            {tel && chat && phoneFromText(tel) && chat(phoneFromText(tel)!)}
          </div>
        )
      })}
    </div>
  )
}
