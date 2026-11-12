/** Configurações conhecidas de SMTP dos provedores mais usados: o usuário escolhe e só preenche a conta. */
export interface SmtpProvider {
  id: string
  label: string
  host: string
  port: number
  security: 'ssl' | 'starttls' | 'none'
  /** Servidor depende do domínio do e-mail (ex.: mail.suaempresa.com.br). */
  hostFromDomain?: (domain: string) => string
  hint: string
}

export const SMTP_PROVIDERS: SmtpProvider[] = [
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 465,
    security: 'ssl',
    hint: 'Usuário: o e-mail completo. Senha: uma "senha de app" (Conta Google › Segurança › Verificação em duas etapas › Senhas de app), não a senha normal. O remetente precisa ser o mesmo e-mail da conta.',
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail',
    host: 'smtp-mail.outlook.com',
    port: 587,
    security: 'starttls',
    hint: 'Usuário: o e-mail completo. Se a conta tiver verificação em duas etapas, use uma senha de app (conta Microsoft › Segurança). O remetente precisa ser o mesmo e-mail da conta.',
  },
  {
    id: 'office365',
    label: 'Microsoft 365 (e-mail da empresa)',
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    hint: 'Usuário: o e-mail completo. O administrador do Microsoft 365 precisa liberar o "SMTP autenticado" para essa caixa.',
  },
  {
    id: 'locaweb',
    label: 'Locaweb',
    host: 'email-ssl.com.br',
    port: 465,
    security: 'ssl',
    hint: 'Usuário: o e-mail completo. Senha: a senha da caixa de e-mail.',
  },
  {
    id: 'hostinger',
    label: 'Hostinger',
    host: 'smtp.hostinger.com',
    port: 465,
    security: 'ssl',
    hint: 'Usuário: o e-mail completo. Senha: a senha da caixa de e-mail (criada no hPanel › E-mails).',
  },
  {
    id: 'hostgator',
    label: 'HostGator',
    host: 'mail.seudominio.com.br',
    port: 465,
    security: 'ssl',
    hostFromDomain: (d) => `mail.${d}`,
    hint: 'Usuário: o e-mail completo. Senha: a senha da caixa de e-mail. O servidor é mail. + o seu domínio (preenchido ao digitar o usuário); confira no cPanel › Contas de e-mail › Conectar dispositivos.',
  },
]

/** Domínio de um e-mail ("contato@empresa.com.br" → "empresa.com.br"), ou null. */
export function emailDomain(email: string) {
  const m = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim())
  return m ? m[1]!.toLowerCase() : null
}
