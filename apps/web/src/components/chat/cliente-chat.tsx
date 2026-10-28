import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BriefcaseIcon, ContactIcon, Loader2Icon, SendIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'

/**
 * Cliente no chat: código do cliente e vendedor (ficam na base de leads e na pré-venda em aberto; a próxima pré-venda
 * já vem com eles) e "cliente da carteira do vendedor": não é venda perdida, a pré-venda aberta sai e o WhatsApp não
 * abre outra; a conversa segue normal, e dá para mandar o contato do vendedor ao cliente e o do cliente ao vendedor.
 */

export interface ChatClient {
  customerCode: string | null
  walletOnly: boolean
  seller: { id: string; name: string; phone: string | null } | null
}

const NONE = '__none__'

/** "Cód. 1234 · Vendedor: Ana" no topo da conversa. */
export function ClientInfo({ client }: { client: ChatClient | null | undefined }) {
  if (!client?.customerCode && !client?.seller) return null
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-foreground" title={client.walletOnly ? 'Cliente da carteira do vendedor: o WhatsApp não abre pré-venda' : 'Código e vendedor do cliente (base de leads)'}>
      <BriefcaseIcon className="size-3" />
      {[client.customerCode && `Cód. ${client.customerCode}`, client.seller && `${client.walletOnly ? 'Carteira de' : 'Vendedor:'} ${client.seller.name}`].filter(Boolean).join(' · ')}
    </span>
  )
}

export function ClientButton({ conversationId, client, lastSeller, wide = false }: { conversationId: string; client: ChatClient | null | undefined; lastSeller?: string | null; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" className={wide ? 'w-full' : undefined} onClick={() => setOpen(true)} title="Código do cliente, vendedor e carteira" aria-label="Cliente">
        <BriefcaseIcon /> <span className={wide ? undefined : 'hidden @4xl/head:inline'}>{wide ? 'Código e vendedor' : client?.customerCode ? `Cód. ${client.customerCode}` : 'Cliente'}</span>
      </Button>
      {open && <ClientDialog conversationId={conversationId} client={client} lastSeller={lastSeller} onClose={() => setOpen(false)} />}
    </>
  )
}

function ClientDialog({ conversationId, client, lastSeller, onClose }: { conversationId: string; client: ChatClient | null | undefined; lastSeller?: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const options = useOptions()
  const sellers = (options.data?.sellers ?? []).filter((s) => s.active || s.id === client?.seller?.id)
  // Sem vendedor salvo: sugere quem atendeu este cliente da última vez.
  const suggested = client?.seller?.id ?? sellers.find((s) => s.name === lastSeller)?.id ?? null
  const [code, setCode] = useState(client?.customerCode ?? '')
  const [sellerId, setSellerId] = useState<string | null>(suggested)
  const [wallet, setWallet] = useState(client?.walletOnly ?? false)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat-conversa', conversationId] })
    void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
  }
  const save = useMutation({
    mutationFn: () => api.put<{ removedRecord: boolean }>(`/chat/conversas/${conversationId}/cliente`, { customerCode: code.trim() || null, sellerId, walletOnly: wallet }),
    onSuccess: (r) => {
      refresh()
      toast.success(r.removedRecord ? 'Salvo. A pré-venda aberta foi excluída (cliente da carteira, não conta como venda perdida).' : 'Salvo na base de leads e na pré-venda em aberto.')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const seller = sellers.find((s) => s.id === sellerId) ?? null
  const sellerPhone = seller?.id === client?.seller?.id ? client?.seller?.phone : null
  const sendContact = useMutation({
    mutationFn: async () => {
      // Vendedor trocado agora: salva antes, para o telefone vir do cadastro dele.
      const saved = seller && seller.id !== client?.seller?.id ? await api.put(`/chat/conversas/${conversationId}/cliente`, { sellerId: seller.id }).then(() => api.get<{ client: ChatClient | null }>(`/chat/conversas/${conversationId}`)) : null
      const phone = saved?.client?.seller?.phone ?? sellerPhone
      if (!seller || !phone) throw new Error('O vendedor não tem telefone no cadastro (Cadastros › Vendedores).')
      return api.post(`/chat/conversas/${conversationId}/contato`, { name: seller.name, phone })
    },
    onSuccess: () => {
      refresh()
      toast.success(`Contato de ${seller?.name} enviado ao cliente.`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const sendToSeller = useMutation({
    mutationFn: () => api.post<{ seller: string }>(`/chat/conversas/${conversationId}/contato-ao-vendedor`, { sellerId: seller!.id }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      toast.success(`Contato do cliente enviado a ${r.seller}.`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Cliente</DialogTitle>
            <DialogDescription>Ficam na base de leads e na pré-venda em aberto. Na próxima vez que o cliente chamar, a pré-venda já vem com o código e o vendedor.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cli-code">Código do cliente</Label>
              <Input id="cli-code" autoFocus maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 10234" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cli-seller">Vendedor do cliente</Label>
              <Select value={sellerId ?? NONE} onValueChange={(v) => setSellerId(v === NONE ? null : v)}>
                <SelectTrigger id="cli-seller" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem vendedor</SelectItem>
                  {sellers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={wallet} onChange={(e) => setWallet(e.target.checked)} />
            <span>
              Cliente da carteira do vendedor (não abre pré-venda)
              <span className="block text-xs text-muted-foreground">
                Não conta como venda perdida: a pré-venda aberta desta conversa sai{can('pre_vendas', 'delete') ? '' : ' (se o seu perfil puder excluir pré-vendas)'} e as próximas mensagens dele não abrem outra. A conversa continua normal no chat, para passar o contato do vendedor.
              </span>
            </span>
          </label>
          {seller && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-3 text-sm">
              <span className="min-w-0 flex-1">
                {seller.name}
                {sellerPhone && <span className="block text-xs text-muted-foreground">{formatPhone(sellerPhone)}</span>}
              </span>
              <Button type="button" size="sm" variant="outline" disabled={sendContact.isPending} onClick={() => sendContact.mutate()} title="Manda o cartão de contato do vendedor nesta conversa">
                {sendContact.isPending ? <Loader2Icon className="animate-spin" /> : <ContactIcon />} Enviar contato do vendedor
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={sendToSeller.isPending} onClick={() => sendToSeller.mutate()} title="Manda ao WhatsApp do vendedor o nome e o telefone deste cliente (cartão de contato)">
                {sendToSeller.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Enviar cliente ao vendedor
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || (wallet && !sellerId)} title={wallet && !sellerId ? 'Escolha o vendedor do cliente' : undefined}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
