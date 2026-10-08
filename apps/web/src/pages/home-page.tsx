import { ArrowRightIcon, CheckCircle2Icon, CircleDashedIcon, ShieldCheckIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useVersion } from '@/components/layout/app-footer'
import { formatDateTime, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const PHASES = [
  { n: 1, title: 'Fundação', text: 'Acesso seguro, 2FA, perfis, whitelabel, auditoria, layouts e atualizações.' },
  { n: 2, title: 'Pré e Pós-Vendas', text: 'Registro de atendimentos, cadastros, importação da planilha, alertas e dashboard de vendedores.' },
  { n: 3, title: 'Base de leads', text: 'Leads, campos personalizados, importação do RD Station, lead scoring e LGPD. Rastreamento do site em seguida.' },
  { n: 4, title: 'Captura', text: 'Formulários, pop-ups, botão de WhatsApp e landing pages.' },
  { n: 5, title: 'Email marketing', text: 'Catálogo, Magazord, editor de e-mail, IA com aprovação e segmentação.' },
  { n: 6, title: 'Automações', text: 'Fluxos de automação e atribuição de receita.' },
  { n: 7, title: 'Análise', text: 'Dashboards, GA4 e construtor de relatórios.' },
  { n: 8, title: 'Hardening', text: 'Testes de carga, revisão de segurança, backup validado e documentação final.' },
  { n: 9, title: 'Chat WhatsApp', text: 'Atendimento pelo WhatsApp dentro do sistema (Evolution API), com acesso por usuário.' },
]

const CURRENT_PHASE = 8

function greeting() {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

export function HomePage() {
  const { me, can } = useAuth()
  const { data: version } = useVersion()
  if (!me) return null

  return (
    <div>
      <PageHeader title={`${greeting()}, ${me.name.split(' ')[0]}!`} description={`Você está conectado como ${me.role.name}.`} />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Versão instalada</CardDescription>
            <CardTitle className="text-2xl">{version ? `v${version.version}` : '…'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/atualizacoes">
                Ver o que mudou <ArrowRightIcon />
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Segurança da sua conta</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShieldCheckIcon className={cn('size-6', me.totpEnabled ? 'text-emerald-600' : 'text-amber-500')} />
              {me.totpEnabled ? '2FA ativo' : '2FA desativado'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/meu-perfil">
                {me.totpEnabled ? 'Gerenciar' : 'Ativar agora'} <ArrowRightIcon />
              </Link>
            </Button>
          </CardContent>
        </Card>
        {can('usuarios') ? (
          <Card>
            <CardHeader>
              <CardDescription>Administração</CardDescription>
              <CardTitle className="text-2xl">Equipe e acessos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/usuarios">Usuários</Link>
              </Button>
              {can('perfis') && (
                <Button asChild variant="outline" size="sm">
                  <Link to="/perfis">Perfis</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription>Seu acesso atual começou em</CardDescription>
              <CardTitle className="text-2xl">{formatDateTime(me.lastLoginAt)}</CardTitle>
            </CardHeader>
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Roteiro de implantação</CardTitle>
          <CardDescription>O sistema é entregue em fases. Cada fase concluída aparece aqui e na tela Atualizações.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PHASES.map((p) => {
              const done = p.n <= CURRENT_PHASE
              return (
                <li key={p.n} className={cn('rounded-lg border p-3', done && 'border-emerald-500/40 bg-emerald-500/5')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {done ? <CheckCircle2Icon className="size-4 text-emerald-600" /> : <CircleDashedIcon className="size-4 text-muted-foreground" />}
                      Fase {p.n}
                    </span>
                    <Badge variant={done ? 'secondary' : 'outline'} className="text-[10px]">
                      {done ? 'Entregue' : 'Planejada'}
                    </Badge>
                  </div>
                  <p className="mt-1 font-medium">{p.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.text}</p>
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
