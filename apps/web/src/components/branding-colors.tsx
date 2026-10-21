import { AlertTriangleIcon, CheckIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { contrastText } from '@/lib/branding'
import { type BrandColors, colorWarnings, PALETTES } from '@/lib/cores'
import { cn } from '@/lib/utils'

/** Prévia ao vivo: menu, botões, caixa marcada, chave e a faixa do relatório com as cores escolhidas. */
export function ColorsPreview({ colors, appName }: { colors: BrandColors; appName: string }) {
  const valid = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback)
  const action = valid(colors.action, '#1d4ed8')
  const brand = valid(colors.brand || colors.action, action)
  const nav = valid(colors.nav, '#0f1e3d')
  // Os componentes leem --primary e --ring: troca só dentro da prévia.
  const vars = { '--primary': action, '--primary-foreground': contrastText(action), '--ring': `color-mix(in oklch, ${action} 55%, transparent)`, '--brand': action, '--brand-foreground': contrastText(action) } as CSSProperties
  const navText = contrastText(nav)
  return (
    <div className="overflow-hidden rounded-lg border" style={vars} aria-label="Prévia das cores">
      <div className="flex min-h-44">
        <div className="w-32 shrink-0 space-y-1 p-2 text-xs" style={{ background: nav, color: navText }}>
          <p className="px-2 py-1 font-semibold">{appName}</p>
          <p className="rounded px-2 py-1 opacity-80">Início</p>
          <p className="rounded px-2 py-1 font-medium" style={{ background: action, color: contrastText(action) }}>
            Pré-Vendas
          </p>
          <p className="rounded px-2 py-1 opacity-80">Chat</p>
        </div>
        <div className="flex-1 space-y-3 bg-background p-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="button" tabIndex={-1}>
              Salvar
            </Button>
            <Button size="sm" variant="outline" type="button" tabIndex={-1}>
              Cancelar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-2">
              <Checkbox checked tabIndex={-1} aria-label="Exemplo de caixa marcada" /> Marcado
            </span>
            <span className="flex items-center gap-2">
              <Switch checked tabIndex={-1} aria-label="Exemplo de chave ligada" /> Ligado
            </span>
            <span className="text-primary underline underline-offset-4">Um link</span>
          </div>
          <div className="overflow-hidden rounded-md border text-xs">
            <div className="px-3 py-2" style={{ background: brand, color: contrastText(brand) }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75">Relatório (PDF e e-mail)</p>
              <p className="font-semibold">Resumo semanal da diretoria</p>
            </div>
            <div className="flex gap-2 p-2">
              {['Leads 34', 'Vendas 2'].map((t) => (
                <div key={t} className="flex-1 rounded px-2 py-1.5 font-medium" style={{ background: `color-mix(in oklch, ${brand} 8%, white)`, borderLeft: `3px solid ${brand}` }}>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Botões das paletas prontas (a escolhida fica marcada). */
export function PalettePicker({ value, onPick, disabled }: { value: BrandColors; onPick: (c: BrandColors) => void; disabled?: boolean }) {
  const same = (p: BrandColors) => [p.brand, p.action, p.nav].join() === [value.brand || value.action, value.action, value.nav].join().toLowerCase()
  return (
    <div className="flex flex-wrap gap-2">
      {PALETTES.map((p) => (
        <button
          key={p.name}
          type="button"
          disabled={disabled}
          onClick={() => onPick(p)}
          className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50', same(p) && 'border-primary ring-1 ring-primary')}
          title={`Marca ${p.brand} · ação ${p.action} · menu ${p.nav}`}
        >
          <span className="flex">
            {[p.brand, p.action, p.nav].map((c, i) => (
              <span key={i} className="size-4 rounded-full border border-background first:ml-0 -ml-1" style={{ background: c }} />
            ))}
          </span>
          {p.name}
          {same(p) && <CheckIcon className="size-3.5" />}
        </button>
      ))}
    </div>
  )
}

export function ColorWarnings({ colors }: { colors: BrandColors }) {
  const list = colorWarnings(colors)
  if (!list.length) return null
  return (
    <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
      {list.map((w) => (
        <li key={w} className="flex gap-2">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /> {w}
        </li>
      ))}
    </ul>
  )
}
