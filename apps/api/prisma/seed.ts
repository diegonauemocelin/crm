/**
 * Seed idempotente: cria o tenant, os perfis padrão e o primeiro administrador.
 * Pode rodar várias vezes sem duplicar nada. A senha do admin só é gerada (e exibida) na primeira vez.
 *
 *   SEED_ADMIN_EMAIL=voce@empresa.com.br SEED_ADMIN_NAME="Seu Nome" npm run db:seed
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import * as argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'

const MODULES = [
  'dashboard', 'leads', 'carrinhos', 'pre_vendas', 'pos_vendas', 'cadastros', 'chat', 'captura', 'email_marketing',
  'whatsapp', 'automacoes', 'catalogo', 'relatorios', 'google_ads', 'usuarios', 'perfis', 'configuracoes', 'auditoria',
] as const
type Mod = (typeof MODULES)[number]
type P = { v?: 1; c?: 1; e?: 1; d?: 1; x?: 1; own?: 1 }

const ALL: P = { v: 1, c: 1, e: 1, d: 1, x: 1 }
const WORK: P = { v: 1, c: 1, e: 1, x: 1 }
const VIEW: P = { v: 1 }
const VIEW_EXPORT: P = { v: 1, x: 1 }

const ROLES: { name: string; description: string; require2fa: boolean; isSystem?: boolean; perms: Partial<Record<Mod, P>> }[] = [
  { name: 'Administrador', description: 'Acesso total ao sistema.', require2fa: true, isSystem: true, perms: {} },
  {
    name: 'Marketing',
    description: 'Leads, captura, email marketing, automações e relatórios.',
    require2fa: false,
    perms: { dashboard: VIEW, leads: ALL, captura: ALL, email_marketing: ALL, automacoes: ALL, catalogo: WORK, relatorios: VIEW_EXPORT, carrinhos: WORK, google_ads: { v: 1, e: 1, x: 1 } },
  },
  {
    name: 'Pré-Vendas',
    description: 'Atendimento de pré-vendas e chat.',
    require2fa: false,
    perms: { dashboard: VIEW, leads: WORK, carrinhos: WORK, pre_vendas: WORK, chat: WORK, relatorios: VIEW },
  },
  {
    name: 'Pós-Vendas',
    description: 'Atendimento de pós-vendas e chat.',
    require2fa: false,
    perms: { dashboard: VIEW, leads: WORK, pos_vendas: WORK, chat: WORK, relatorios: VIEW },
  },
  {
    name: 'Vendedor',
    description: 'Vê e atualiza somente os próprios leads e atendimentos.',
    require2fa: false,
    perms: {
      dashboard: VIEW,
      leads: { v: 1, e: 1, own: 1 },
      pre_vendas: { v: 1, e: 1, own: 1 },
      pos_vendas: { v: 1, e: 1, own: 1 },
      chat: { v: 1, c: 1, e: 1, own: 1 },
    },
  },
  {
    name: 'Diretoria',
    description: 'Somente leitura de todos os módulos, com exportação.',
    require2fa: true,
    perms: Object.fromEntries(
      MODULES.filter((m) => !['usuarios', 'perfis', 'configuracoes'].includes(m)).map((m) => [m, VIEW_EXPORT]),
    ),
  },
]

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  const slug = process.env.TENANT_SLUG || 'default'

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: { slug, name: process.env.SEED_TENANT_NAME || 'USA Parts' },
    update: {},
  })

  for (const r of ROLES) {
    const existing = await prisma.role.findUnique({ where: { tenantId_name: { tenantId: tenant.id, name: r.name } } })
    if (existing) continue
    await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: r.name,
        description: r.description,
        require2fa: r.require2fa,
        isSystem: r.isSystem ?? false,
        permissions: {
          create: Object.entries(r.perms).map(([module, p]) => ({
            module,
            canView: !!p.v,
            canCreate: !!p.c,
            canEdit: !!p.e,
            canDelete: !!p.d,
            canExport: !!p.x,
            scope: p.own ? ('OWN' as const) : ('ALL' as const),
          })),
        },
      },
    })
    console.log(`Perfil criado: ${r.name}`)
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  if (!adminEmail) {
    console.log('SEED_ADMIN_EMAIL não informado: nenhum administrador criado.')
  } else if (await prisma.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } } })) {
    console.log(`Administrador ${adminEmail} já existe. Nada alterado.`)
  } else {
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, isSystem: true } })
    const password = randomBytes(12).toString('base64url')
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        roleId: adminRole.id,
        name: process.env.SEED_ADMIN_NAME || 'Administrador',
        email: adminEmail,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 38_912, timeCost: 3, parallelism: 1 }),
        mustChangePassword: true,
      },
    })
    console.log('\n================================================================')
    console.log(' Administrador criado')
    console.log(`  E-mail: ${adminEmail}`)
    console.log(`  Senha provisória: ${password}`)
    console.log(' Ela aparece só agora. No primeiro acesso o sistema pede a troca')
    console.log(' da senha e a configuração do 2FA.')
    console.log('================================================================\n')
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
