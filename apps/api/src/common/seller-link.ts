import type { PrismaService } from '../prisma/prisma.service'

/**
 * Liga vendedor e usuário que têm o mesmo e-mail (ex.: vendedor "Ecommerce" e o login ecommerce@usaparts.com.br).
 * É esse vínculo que define a base de quem tem o perfil "somente os próprios": sem ele, o vendedor não vê nada.
 * Nunca troca um vínculo já feito à mão e nunca liga dois vendedores ao mesmo usuário.
 */
export async function linkSellersByEmail(prisma: PrismaService, tenantId: string) {
  const sellers = await prisma.seller.findMany({ where: { tenantId, userId: null, email: { not: null } }, select: { id: true, email: true, name: true } })
  const linked: { seller: string; user: string }[] = []
  for (const s of sellers) {
    const user = await prisma.user.findFirst({ where: { tenantId, email: { equals: s.email!.trim(), mode: 'insensitive' }, active: true }, select: { id: true, email: true } })
    if (!user) continue
    if (await prisma.seller.count({ where: { userId: user.id } })) continue
    await prisma.seller.update({ where: { id: s.id }, data: { userId: user.id } })
    linked.push({ seller: s.name, user: user.email })
  }
  return linked
}
