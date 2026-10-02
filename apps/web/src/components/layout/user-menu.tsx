import { HistoryIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import type { ThemeMode } from '@/lib/types'

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function UserAvatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  return (
    <Avatar className={className ?? 'size-8 rounded-lg'}>
      {url && <AvatarImage src={url} alt={name} />}
      <AvatarFallback className="rounded-lg">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

/** Conteúdo do menu do usuário, compartilhado pelos layouts Moderno e Clássico. */
export function UserMenuContent() {
  const { me, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  if (!me) return null

  const changeTheme = (value: string) => {
    const t = value as ThemeMode
    setTheme(t)
    void api.patch('/me/preferences', { theme: t })
  }

  return (
    <>
      <DropdownMenuLabel className="p-0 font-normal">
        <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <UserAvatar name={me.name} url={me.avatarUrl} />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{me.name}</span>
            <span className="truncate text-xs text-muted-foreground">{me.email}</span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => navigate('/meu-perfil')}>
          <UserIcon />
          Meu perfil
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunIcon />
            Tema
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
              <DropdownMenuRadioItem value="LIGHT">
                <SunIcon /> Claro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="DARK">
                <MoonIcon /> Escuro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="SYSTEM">
                <MonitorIcon /> Automático
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => navigate('/atualizacoes')}>
          <HistoryIcon />
          Atualizações
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={async () => {
          await logout()
          navigate('/login')
        }}
      >
        <LogOutIcon />
        Sair
      </DropdownMenuItem>
    </>
  )
}
