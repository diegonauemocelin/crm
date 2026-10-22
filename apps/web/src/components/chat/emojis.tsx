import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlusIcon, Loader2Icon, StickerIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Emojis mais usados no atendimento, por grupo (sem biblioteca externa: nada sai do CRM para carregar a lista). */
const GROUPS: { title: string; list: string[] }[] = (
  [
  { title: 'Rostos', list: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖' },
  { title: 'Gestos e pessoas', list: '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫡 🫶 👀 🧠 🙋 🙋‍♂️ 🙋‍♀️ 🤷 🤷‍♂️ 🤷‍♀️ 🤦 🤦‍♂️ 🤦‍♀️ 🙇 💁 👨‍🔧 👩‍🔧 👷 👨‍💼 👩‍💼 🧑‍💻 🚶 🏃' },
  { title: 'Corações e símbolos', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✅ ☑️ ✔️ ❌ ❎ ⚠️ 🚫 ⛔ ❗ ❓ ‼️ ⁉️ 💯 🔥 ✨ ⭐ 🌟 💥 💫 🎉 🎊 🎁 🏆 🥇 🔔 📢 📣 💬 💭 🆗 🆕 🔝 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ➡️ ⬅️ ⬆️ ⬇️ 🔄 ⏩ ⏪ ▶️ ⏸️' },
  { title: 'Trabalho e peças', list: '🚜 🏗️ 🚚 🚛 🛻 🚗 🏍️ ⛽ 🛞 ⚙️ 🔧 🔩 🛠️ ⛏️ 🪛 🔨 🪚 🧰 🧲 🔋 🔌 💡 🧯 🛢️ 📦 📫 📬 🏭 🏪 🏢 🗺️ 📍 🧭 🌎 🇧🇷 🚀 ✈️ 🚢 ⏱️ ⏰ ⌛ ⏳ 📅 📆 🗓️ 💰 💵 💳 🧾 💲 📈 📉 📊 📋 📄 📝 ✏️ 🖊️ 📎 📌 🔍 🔎 📷 📸 🎥 📞 ☎️ 📱 💻 🖥️ 🖨️ ✉️ 📧 🔒 🔓 🔑' },
  { title: 'Natureza e comida', list: '☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌩️ ❄️ 🌈 💧 🌊 🌱 🌳 🌵 🌻 🌹 🍀 🐶 🐱 🐴 🐮 🐔 🦅 🐝 ☕ 🍵 🧉 🍺 🍻 🥂 🍷 🥤 🧃 🍕 🍔 🍟 🌭 🥪 🌮 🍖 🍗 🥩 🍝 🍰 🎂 🍫 🍩 🍪 🍎 🍌 🍉 🍇 🍓 🥑 🌽' },
] as { title: string; list: string }[]
).map((g) => ({ title: g.title, list: g.list.split(' ') }))

const RECENT_KEY = 'chat-emojis-recentes'

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 24) : []
  } catch {
    return []
  }
}

function pushRecent(e: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter((x) => x !== e)].slice(0, 24)))
  } catch {
    // Sem armazenamento no navegador (janela anônima): só não guarda os recentes.
  }
}

/** Grade de emojis por grupo, com os usados por último no topo. */
export function EmojiGrid({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) {
  const [recent, setRecent] = useState(readRecent)
  const pick = (e: string) => {
    pushRecent(e)
    setRecent(readRecent())
    onPick(e)
  }
  const groups = [...(recent.length ? [{ title: 'Usados por último', list: recent }] : []), ...GROUPS]
  return (
    <div className={cn('max-h-72 space-y-2 overflow-y-auto pr-1', className)}>
      {groups.map((g) => (
        <section key={g.title}>
          <p className="sticky top-0 bg-popover py-0.5 text-xs font-medium text-muted-foreground">{g.title}</p>
          <div className="grid grid-cols-8 gap-0.5">
            {g.list.map((e) => (
              <button key={`${g.title}-${e}`} type="button" className="rounded p-1 text-xl leading-none hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={() => pick(e)} aria-label={`Emoji ${e}`}>
                {e}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Figurinhas salvas pela pessoa: clique envia; dá para adicionar uma imagem do computador e apagar. */
function StickerGrid({ onSend, sending }: { onSend: (id: string) => void; sending: boolean }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const list = useQuery({ queryKey: ['chat-figurinhas'], queryFn: () => api.get<{ id: string }[]>('/chat/figurinhas'), staleTime: 60_000 })
  const add = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post<{ message: string }>('/chat/figurinhas', fd)
    },
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['chat-figurinhas'] })),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/chat/figurinhas/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-figurinhas'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <div className="max-h-72 overflow-y-auto pr-1">
      <input
        ref={input}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (f.size > 1024 * 1024) return void toast.error('Imagem maior que 1 MB. Diminua a imagem e tente de novo.')
          add.mutate(f)
        }}
      />
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" onClick={() => input.current?.click()} disabled={add.isPending} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted">
          {add.isPending ? <Loader2Icon className="size-5 animate-spin" /> : <ImagePlusIcon className="size-5" />}
          Adicionar
        </button>
        {list.data?.map((s) => (
          <div key={s.id} className="group/st relative aspect-square">
            <button type="button" disabled={sending} onClick={() => onSend(s.id)} className="size-full rounded-md p-1 hover:bg-muted disabled:opacity-50" aria-label="Enviar figurinha">
              <img src={`/api/chat/figurinhas/${s.id}/imagem`} alt="Figurinha" className="size-full object-contain" loading="lazy" />
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(s.id)}
              className="absolute -top-1 -right-1 hidden rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm group-hover/st:block hover:text-destructive focus-visible:block"
              aria-label="Apagar figurinha"
              title="Apagar das minhas figurinhas"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
      </div>
      {list.isLoading && <p className="py-2 text-center text-xs text-muted-foreground">Carregando…</p>}
      {list.data && !list.data.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          <StickerIcon className="mr-1 inline size-3.5" />
          Nenhuma figurinha ainda. Salve as que chegarem nas conversas (menu ⋮ da figurinha) ou adicione uma imagem.
        </p>
      )}
    </div>
  )
}

/** Conteúdo do botão de emojis e figurinhas da caixa de mensagem. */
export function EmojiStickerPanel({ onEmoji, onSticker, sending }: { onEmoji: (emoji: string) => void; onSticker: (id: string) => void; sending: boolean }) {
  return (
    <Tabs defaultValue="emojis">
      <TabsList className="mb-2 w-full">
        <TabsTrigger value="emojis">Emojis</TabsTrigger>
        <TabsTrigger value="figurinhas">Minhas figurinhas</TabsTrigger>
      </TabsList>
      <TabsContent value="emojis">
        <EmojiGrid onPick={onEmoji} />
      </TabsContent>
      <TabsContent value="figurinhas">
        <StickerGrid onSend={onSticker} sending={sending} />
      </TabsContent>
    </Tabs>
  )
}
