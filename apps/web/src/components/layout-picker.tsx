import { CheckCircle2Icon } from 'lucide-react'
import type { LayoutMode, ScreenModel } from '@/lib/types'
import { cn } from '@/lib/utils'

const bar = 'rounded-sm bg-muted-foreground/25'

/** Conteúdo da miniatura: telas de sempre (cards) ou telas novas (contadores da Minha fila e o quadro de colunas). */
function ContentPreview({ screens }: { screens: ScreenModel }) {
  if (screens === 'NOVO') {
    return (
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="grid grid-cols-4 gap-1">
          <div className="h-3 rounded-sm border border-orange-400/70 bg-orange-400/20" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-3 rounded-sm border bg-card" />
          ))}
        </div>
        <div className="grid flex-1 grid-cols-4 gap-1">
          {[3, 2, 2, 1].map((n, i) => (
            <div key={i} className="flex flex-col gap-0.5 rounded-sm bg-muted p-0.5">
              {Array.from({ length: n }, (_, k) => (
                <div key={k} className={cn('h-2 rounded-[2px] border bg-card', i === 1 && k === 0 && 'border-l-2 border-l-orange-400')} />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="grid flex-1 grid-cols-3 gap-1.5 p-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-sm border bg-card" />
      ))}
      <div className="col-span-3 rounded-sm border bg-card" />
    </div>
  )
}

/** Miniatura de cada modelo, desenhada com as cores do whitelabel. */
function ModelPreview({ layout, screens }: { layout: LayoutMode; screens: ScreenModel }) {
  if (layout === 'MODERN') {
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
          <ContentPreview screens={screens} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-28 flex-col overflow-hidden rounded-md border bg-muted/40">
      <div className="flex h-6 shrink-0 items-center gap-2 px-2" style={{ background: 'var(--brand-nav)' }}>
        <div className="size-2.5 rounded-sm bg-white/70" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-1.5 w-6 rounded-sm bg-white/40" />
        ))}
      </div>
      <div className="flex h-4 shrink-0 items-center border-b bg-background px-2">
        <div className={cn(bar, 'h-1.5 w-1/4')} />
      </div>
      {screens === 'NOVO' ? (
        <div className="mx-auto flex w-5/6 flex-1">
          <ContentPreview screens="NOVO" />
        </div>
      ) : (
        <div className="mx-auto flex w-5/6 flex-1 flex-col gap-1 py-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-2.5 rounded-sm border bg-background" />
          ))}
        </div>
      )}
    </div>
  )
}

export interface ModelChoice {
  layout: LayoutMode
  screens: ScreenModel
}

const OPTIONS: (ModelChoice & { title: string; text: string })[] = [
  { layout: 'MODERN', screens: 'ATUAL', title: 'Moderno', text: 'Menu lateral recolhível, com as telas de sempre.' },
  { layout: 'CLASSIC', screens: 'ATUAL', title: 'Clássico', text: 'Menu superior com listas suspensas, no estilo do RD Station.' },
  {
    layout: 'MODERN',
    screens: 'NOVO',
    title: 'Moderno com telas novas',
    text: 'Menu lateral, Minha fila no início, Pré-Vendas em quadro e chat com painel do cliente e cores de espera.',
  },
  { layout: 'CLASSIC', screens: 'NOVO', title: 'Clássico com telas novas', text: 'Menu superior, Minha fila no início, Pré-Vendas em quadro e chat com painel do cliente.' },
]

/** Os 4 modelos: layout (Moderno ou Clássico) combinado com as telas (de sempre ou novas). */
export function LayoutPicker({ value, onChange, disabled }: { value: ModelChoice; onChange: (m: ModelChoice) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Modelo do sistema" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map((o) => {
        const selected = value.layout === o.layout && value.screens === o.screens
        return (
          <button
            key={`${o.layout}-${o.screens}`}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange({ layout: o.layout, screens: o.screens })}
            className={cn(
              'rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
              selected ? 'border-[color:var(--brand)]' : 'border-transparent bg-muted/40 hover:border-border',
            )}
          >
            <ModelPreview layout={o.layout} screens={o.screens} />
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
