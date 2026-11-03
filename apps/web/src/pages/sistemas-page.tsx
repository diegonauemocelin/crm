import { LayoutGridIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { SISTEMA_ICONES, useAvisosDoSistema } from '@/components/layout/sistemas-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/lib/page-title'
import { prefsSistema, useSistemaAtual } from '@/lib/sistema-atual'
import { inicioDoSistema } from '@/lib/sistemas'

const saudacao = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

/** Visual "Por sistema": onde a pessoa escolhe em qual sistema vai trabalhar (depois do login ou pelo menu). */
export function SistemasPage() {
  usePageTitle('Escolher o sistema')
  const { me } = useAuth()
  const { grupos, sistemas, atual } = useSistemaAtual()
  const avisos = useAvisosDoSistema()
  const [direto, setDireto] = useState(prefsSistema.direto())
  const primeiro = me?.name?.split(' ')[0] ?? ''
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 py-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">
            {saudacao()}
            {primeiro ? `, ${primeiro}` : ''}. Onde você vai trabalhar?
          </h1>
          <p className="text-sm text-muted-foreground">Você tem acesso a {sistemas.length} sistemas. Dá para trocar a qualquer momento pelo menu.</p>
        </div>
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox
            id="sistema-direto"
            checked={direto}
            onCheckedChange={(v) => {
              setDireto(v === true)
              prefsSistema.setDireto(v === true)
            }}
          />
          <Label htmlFor="sistema-direto" className="font-normal">
            Entrar direto no último sistema usado
          </Label>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sistemas.map((s) => {
          const Icon = SISTEMA_ICONES[s.id] ?? LayoutGridIcon
          const n = avisos(s.id)
          const telas = grupos.filter((g) => s.grupos.includes(g.title)).reduce((t, g) => t + g.items.length, 0)
          const ultimo = s.id === atual
          return (
            <Link
              key={s.id}
              to={inicioDoSistema(grupos, s.id) ?? '/'}
              className="flex min-h-44 flex-col gap-3 rounded-2xl border bg-card p-5 text-card-foreground transition-colors hover:border-[color:var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={ultimo ? { borderColor: 'var(--brand)', borderWidth: 2 } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-12 items-center justify-center rounded-xl" style={ultimo ? { background: 'var(--brand)', color: 'var(--brand-foreground)' } : { background: 'var(--brand-nav)', color: 'var(--brand-nav-foreground)' }}>
                  <Icon className="size-6" />
                </span>
                {n > 0 && <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive">{n} pendente{n > 1 ? 's' : ''}</span>}
              </div>
              <div className="space-y-1">
                <p className="text-lg font-extrabold">{s.nome}</p>
                <p className="text-sm text-muted-foreground">{s.descricao}</p>
              </div>
              <p className="mt-auto text-xs text-muted-foreground">
                {telas} tela{telas > 1 ? 's' : ''}
                {ultimo ? ' · último usado' : ''}
              </p>
            </Link>
          )
        })}
      </div>
      <p className="text-sm text-muted-foreground">Dica: Ctrl + K busca qualquer tela de qualquer sistema.</p>
    </div>
  )
}
