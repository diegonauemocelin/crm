import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { resolve4, resolve6, resolveMx } from 'node:dns/promises'
import { PrismaService } from '../prisma/prisma.service'
import { checkEmailText, dnsMeaning, type DomainMail, domainReason } from './validar'

const TICK_MS = 60_000
/** Leads conferidos por volta (a base inteira vai sendo conferida aos poucos). */
const PER_TICK = 300
/** Resposta do DNS guardada por domínio (gmail.com, hotmail.com... conferidos uma vez só). */
const DOMAIN_TTL_MS = 24 * 3_600_000

/**
 * Validação dos e-mails dos leads em segundo plano: formato, e-mail de mentira, domínio grande digitado errado e se o
 * domínio existe e recebe e-mail (DNS). E-mail inválido fica marcado no lead (motivo e data) e sai do e-mail marketing
 * e das automações de e-mail. Quando o e-mail do lead muda, é conferido de novo.
 */
@Injectable()
export class EmailValidationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ValidacaoEmail')
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly domains = new Map<string, { r: DomainMail; at: number }>()

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  /** O domínio recebe e-mail? MX; sem MX, um endereço (A/AAAA) também recebe (regra do e-mail). */
  private async domainMail(domain: string): Promise<DomainMail> {
    const hit = this.domains.get(domain)
    if (hit && Date.now() - hit.at < DOMAIN_TTL_MS) return hit.r
    let r: DomainMail
    try {
      const mx = await resolveMx(domain)
      // MX "nulo" (RFC 7505): o domínio declara que não recebe e-mail.
      r = mx.some((m) => m.exchange && m.exchange !== '.') ? 'RECEBE' : 'SEM_EMAIL'
    } catch (e) {
      const m = dnsMeaning((e as { code?: string }).code)
      if (m === 'NAO_EXISTE') r = 'NAO_EXISTE'
      else if (m === 'INCERTO') r = 'INCERTO'
      else {
        const any = await Promise.any([resolve4(domain), resolve6(domain)]).then((a) => a.length > 0).catch(() => false)
        r = any ? 'RECEBE' : 'SEM_EMAIL'
      }
    }
    if (r !== 'INCERTO') {
      if (this.domains.size > 20_000) this.domains.clear()
      this.domains.set(domain, { r, at: Date.now() })
    }
    return r
  }

  /** Confere um e-mail: null = válido; texto = motivo; undefined = não deu para saber agora (tenta depois). */
  async check(email: string): Promise<string | null | undefined> {
    const t = checkEmailText(email)
    if (!t.ok) return t.reason
    const d = await this.domainMail(t.domain)
    if (d === 'INCERTO') return undefined
    return d === 'RECEBE' ? null : domainReason(d, t.domain)
  }

  async tick() {
    if (this.running) return
    this.running = true
    try {
      // E-mails ainda não conferidos ou que mudaram desde a última conferência.
      const rows = await this.prisma.$queryRawUnsafe<{ id: string; email: string }[]>(
        `SELECT id, email FROM leads WHERE email IS NOT NULL AND "deletedAt" IS NULL AND "anonymizedAt" IS NULL AND ("emailCheckedFor" IS NULL OR "emailCheckedFor" <> email) LIMIT ${PER_TICK}`,
      )
      for (const r of rows) {
        const reason = await this.check(r.email)
        if (reason === undefined) continue
        await this.prisma.lead.update({
          where: { id: r.id },
          data: { emailCheckedFor: r.email, emailInvalidAt: reason ? new Date() : null, emailInvalidReason: reason ? reason.slice(0, 200) : null },
        })
      }
    } catch (e) {
      this.logger.warn(`Validação de e-mails: ${(e as Error).message}`)
    } finally {
      this.running = false
    }
  }
}
