import { CheckCircle2Icon } from 'lucide-react'
import type { LayoutMode } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Miniatura de cada layout, desenhada com as cores do whitelabel. */
function LayoutPreview({ mode }: { mode: LayoutMode }) {
  const bar = 'rounded-sm bg-muted-foreground/25'
  if (mode === 'MODERN') {
    return (
      <div className="flex h-28 overflow-hidden rounded-md border bg-background">
        <div className="flex w-1/4 flex-col gap-1.5 border-r bg-sidebar p-2">
          <div className="mb-1 size-3 rounded-sm" style={{ background: 'var(--brand)' }} />
          {[70, 55, 80, 50, 65].map((w, i) => (
            <div key={i} className={cn(bar, 'h-1.5')} style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex h-5 items-center gap-1 border-b px-2">
            <div className={cn(bar, 'h-1.5 w-1/3')} />
          </div>
          <div className="grid flex-1 grid-cols-3 gap-1.5 p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-sm border bg-card" />
            ))}
            <div className="col-span-3 rounded-sm border bg-card" />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-28 flex-col overflow-hidden rounded-md border bg-muted/40">
      <div className="flex h-6 items-center gap-2 px-2" style={{ background: 'var(--brand-nav)' }}>
        <div className="size-2.5 rounded-sm bg-white/70" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-1.5 w-6 rounded-sm bg-white/40" />
        ))}
      </div>
      <div className="flex h-4 items-center border-b bg-background px-2">
        <div className={cn(bar, 'h-1.5 w-1/4')} />
      </div>
      <div className="mx-auto flex w-5/6 flex-1 flex-col gap-1 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-2.5 rounded-sm border bg-background" />
        ))}
      </div>
    </div>
  )
}

const OPTIONS: { mode: LayoutMode; title: string; text: string }[] = [
  { mode: 'MODERN', title: 'Moderno', text: 'Menu lateral recolhível, construído com shadcn/ui.' },
  { mode: 'CLASSIC', title: 'Clássico', text: 'Menu superior com listas suspensas, no estilo do RD Station.' },
]

export function LayoutPicker({ value, onChange, disabled }: { value: LayoutMode; onChange: (m: LayoutMode) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map((o) => {
        const selected = value === o.mode
        return (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.mode)}
            className={cn(
              'rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
              selected ? 'border-[color:var(--brand)]' : 'border-transparent bg-muted/40 hover:border-border',
            )}
          >
            <LayoutPreview mode={o.mode} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="font-medium">{o.title}</span>
              {selected && <CheckCircle2Icon className="size-4" style={{ color: 'var(--brand)' }} />}
            </div>
            <p className="text-xs text-muted-foreground">{o.text}</p>
          </button>
        )
      })}
    </div>
  )
}
