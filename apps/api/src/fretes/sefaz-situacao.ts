import type { PrismaService } from '../prisma/prisma.service'
import { sefazHealth } from './sefaz'

/** Situação da busca de CT-e na SEFAZ da empresa (aviso nas telas de CT-e, conciliação e alertas). null = busca não configurada. */
export async function sefazSituation(prisma: PrismaService, tenantId: string, now = new Date()) {
  const c = await prisma.freightSefazConfig.findFirst({ where: { tenantId }, select: { id: true, certEnc: true, lastRunAt: true, intervalHours: true } })
  if (!c?.certEnc) return null
  const runs = await prisma.freightSefazRun.findMany({ where: { tenantId, configId: c.id }, orderBy: { startedAt: 'desc' }, take: 3, select: { status: true, cStat: true, message: true, startedAt: true } })
  return { ...sefazHealth({ runs, lastRunAt: c.lastRunAt, intervalHours: c.intervalHours }, now), lastRunAt: c.lastRunAt }
}
