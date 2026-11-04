import { BadRequestException, ForbiddenException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Agent, request } from 'node:https'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { assertCan } from './acesso'
import { CteService } from './cte.service'
import { distEnvelope, docKind, MAX_LOOKBACK_DAYS, nsuLess, parseDistResponse, readCertificate, SEFAZ_ENDPOINT, SEFAZ_INTERVALS, SEFAZ_WAIT_MS, type SefazEnv, SOAP_ACTION, UF_CODE, withinDays } from './sefaz'

const TICK_MS = 10 * 60_000
/** Consultas por rodada (cada uma traz até 50 documentos). */
const MAX_CALLS = 20
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

export interface SefazInput {
  env?: SefazEnv
  ufCode?: number
  intervalHours?: number
  lookbackDays?: number
}

/**
 * Captura de CT-e na SEFAZ (Distribuição DF-e): o certificado A1 da matriz consulta pelo CNPJ dela (vale para todas
 * as filiais). Busca automática a cada 4, 8, 12 ou 24 horas, ou "Buscar agora"; os CT-es entram pelo mesmo caminho
 * da importação de XML.
 */
@Injectable()
export class SefazService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SefazService.name)
  private timer: NodeJS.Timeout | null = null
  private readonly running = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctes: CteService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private assertManage(user: AuthUser) {
    if (!user.role.isSystem && !can(user.permissions, false, 'fretes_filiais', 'edit')) throw new ForbiddenException('Só o Administrador ou quem edita Filiais configura a captura na SEFAZ.')
  }

  private async config(tenantId: string) {
    return this.prisma.freightSefazConfig.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } })
  }

  /** Matriz da empresa: a unidade marcada como matriz (ou a primeira com CNPJ). */
  private async headquarters(tenantId: string) {
    const units = await this.prisma.unit.findMany({ where: { tenantId, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, cnpj: true, state: true, isHeadquarters: true } })
    return units.find((u) => u.isHeadquarters && u.cnpj) ?? units.find((u) => u.cnpj) ?? null
  }

  async view(user: AuthUser) {
    assertCan(user, 'fretes_cte', 'view')
    const [c, hq] = await Promise.all([this.config(user.tenantId), this.headquarters(user.tenantId)])
    const runs = c ? await this.prisma.freightSefazRun.findMany({ where: { tenantId: user.tenantId, configId: c.id }, orderBy: { startedAt: 'desc' }, take: 10 }) : []
    return {
      headquarters: hq ? { id: hq.id, name: hq.name, cnpj: hq.cnpj, uf: hq.state } : null,
      config: c
        ? {
            cnpj: c.cnpj,
            env: c.env,
            ufCode: c.ufCode,
            intervalHours: c.intervalHours,
            lookbackDays: c.lookbackDays,
            hasCertificate: !!c.certEnc,
            certSubject: c.certSubject,
            certCnpj: c.certCnpj,
            certValidTo: c.certValidTo,
            lastNsu: c.lastNsu,
            maxNsu: c.maxNsu,
            nextAllowedAt: c.nextAllowedAt,
            lastRunAt: c.lastRunAt,
            lastStatus: c.lastStatus,
            lastMessage: c.lastMessage,
            updatedByName: c.updatedByName,
          }
        : null,
      runs,
      intervals: SEFAZ_INTERVALS,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
      canManage: user.role.isSystem || can(user.permissions, false, 'fretes_filiais', 'edit'),
    }
  }

  private clean(d: SefazInput) {
    const out: SefazInput = {}
    if (d.env !== undefined) {
      if (!(d.env in SEFAZ_ENDPOINT)) throw new BadRequestException('Ambiente inválido.')
      out.env = d.env
    }
    if (d.ufCode !== undefined) {
      if (!Object.values(UF_CODE).includes(d.ufCode)) throw new BadRequestException('UF inválida.')
      out.ufCode = d.ufCode
    }
    if (d.intervalHours !== undefined) {
      if (!(SEFAZ_INTERVALS as readonly number[]).includes(d.intervalHours)) throw new BadRequestException('Intervalo inválido: 4, 8, 12 ou 24 horas (ou desligado).')
      out.intervalHours = d.intervalHours
    }
    if (d.lookbackDays !== undefined) {
      if (!Number.isInteger(d.lookbackDays) || d.lookbackDays < 1 || d.lookbackDays > MAX_LOOKBACK_DAYS) throw new BadRequestException(`Dias para trás: de 1 a ${MAX_LOOKBACK_DAYS}.`)
      out.lookbackDays = d.lookbackDays
    }
    return out
  }

  /** Envia o certificado A1 (.pfx/.p12) e a senha: confere a senha, a validade e o CNPJ antes de guardar. */
  async uploadCertificate(user: AuthUser, file: Express.Multer.File | undefined, password: string, settings: SefazInput, ctx: RequestCtx) {
    this.assertManage(user)
    if (!file?.buffer?.length) throw new BadRequestException('Envie o arquivo do certificado A1 (.pfx ou .p12).')
    if (file.size > 100 * 1024) throw new BadRequestException('Arquivo grande demais para um certificado A1.')
    if (!password) throw new BadRequestException('Informe a senha do certificado.')
    let info
    try {
      info = readCertificate(file.buffer, password)
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
    if (info.validTo.getTime() < Date.now()) throw new BadRequestException(`Certificado vencido em ${info.validTo.toLocaleDateString('pt-BR')}.`)
    if (!info.cnpj) throw new BadRequestException('Não foi possível ler o CNPJ do certificado. Use o e-CNPJ A1 da matriz.')
    const hq = await this.headquarters(user.tenantId)
    const extra = this.clean(settings)
    const uf = hq?.state ? UF_CODE[hq.state] : undefined
    const cur = await this.config(user.tenantId)
    const data = {
      cnpj: info.cnpj,
      unitId: hq?.id ?? null,
      certEnc: encrypt(file.buffer.toString('base64')),
      passEnc: encrypt(password),
      certSubject: info.subject,
      certCnpj: info.cnpj,
      certValidTo: info.validTo,
      updatedByName: user.name.slice(0, 120),
      ...extra,
    }
    // Outro CNPJ (certificado trocado): o NSU recomeça do zero para esse CNPJ.
    const changed = !!cur && cur.cnpj !== info.cnpj
    const saved = cur
      ? await this.prisma.freightSefazConfig.update({ where: { id: cur.id }, data: { ...data, ...(changed ? { lastNsu: '0', maxNsu: null, nextAllowedAt: null } : {}) } })
      : await this.prisma.freightSefazConfig.create({ data: { tenantId: user.tenantId, ufCode: extra.ufCode ?? uf ?? 42, ...data } })
    await this.audit.byUser(user, ctx, 'frete.sefaz.certificado', 'freight_sefaz_config', saved.id, { cnpj: info.cnpj, titular: info.subject, validade: info.validTo })
    return this.view(user)
  }

  async save(user: AuthUser, d: SefazInput, ctx: RequestCtx) {
    this.assertManage(user)
    const cur = await this.config(user.tenantId)
    if (!cur) throw new BadRequestException('Envie primeiro o certificado A1 da matriz.')
    const data = this.clean(d)
    await this.prisma.freightSefazConfig.update({ where: { id: cur.id }, data: { ...data, updatedByName: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'frete.sefaz.configuracao', 'freight_sefaz_config', cur.id, { ...data })
    return this.view(user)
  }

  async removeCertificate(user: AuthUser, ctx: RequestCtx) {
    this.assertManage(user)
    const cur = await this.config(user.tenantId)
    if (!cur) return this.view(user)
    await this.prisma.freightSefazConfig.update({ where: { id: cur.id }, data: { certEnc: null, passEnc: null, certSubject: null, certCnpj: null, certValidTo: null, intervalHours: 0 } })
    await this.audit.byUser(user, ctx, 'frete.sefaz.certificado_removido', 'freight_sefaz_config', cur.id, { cnpj: cur.cnpj })
    return this.view(user)
  }

  /** Buscar agora (respeita a espera de 1 hora que a SEFAZ exige depois de "nenhum documento"). */
  async runNow(user: AuthUser) {
    assertCan(user, 'fretes_cte', 'create')
    const c = await this.config(user.tenantId)
    if (!c?.certEnc) throw new BadRequestException('Envie o certificado A1 da matriz antes de buscar.')
    if (c.nextAllowedAt && c.nextAllowedAt.getTime() > Date.now()) {
      const min = Math.ceil((c.nextAllowedAt.getTime() - Date.now()) / 60_000)
      throw new BadRequestException(`A SEFAZ pede uma pausa de 1 hora depois da última consulta sem documentos novos. Tente de novo em ${min} minuto(s).`)
    }
    if (this.running.has(c.id)) throw new BadRequestException('Já existe uma busca em andamento.')
    return this.run(c.id, 'MANUAL', user)
  }

  /** A cada 10 minutos: roda as empresas cujo intervalo venceu (e que não estão na pausa da SEFAZ). */
  async tick() {
    try {
      const due = await this.prisma.freightSefazConfig.findMany({ where: { intervalHours: { gt: 0 }, certEnc: { not: null } } })
      for (const c of due) {
        if (this.running.has(c.id)) continue
        if (c.nextAllowedAt && c.nextAllowedAt.getTime() > Date.now()) continue
        if (c.lastRunAt && Date.now() - c.lastRunAt.getTime() < c.intervalHours * 3_600_000) continue
        await this.run(c.id, 'AUTO').catch((err: unknown) => this.logger.warn(`SEFAZ: ${(err as Error).message}`))
      }
    } catch (err) {
      this.logger.warn(`SEFAZ (agendador): ${(err as Error).message}`)
    }
  }

  private systemUser(tenantId: string, by?: AuthUser): AuthUser {
    return {
      id: by?.id ?? SYSTEM_USER_ID,
      tenantId,
      email: by?.email ?? 'sefaz@sistema',
      name: by ? `${by.name} (SEFAZ)` : 'Captura SEFAZ',
      familyId: '',
      unitId: null,
      extraUnitIds: [],
      pending2faSetup: false,
      // A captura grava os CT-es da empresa inteira (todas as filiais).
      role: { id: '', name: 'Sistema', isSystem: true, require2fa: false },
      permissions: {} as AuthUser['permissions'],
    }
  }

  private post(env: SefazEnv, body: string, pfx: Buffer, passphrase: string) {
    const url = new URL(SEFAZ_ENDPOINT[env])
    const agent = new Agent({ pfx, passphrase, keepAlive: false })
    return new Promise<string>((resolve, reject) => {
      const req = request(
        { method: 'POST', hostname: url.hostname, path: url.pathname, agent, timeout: 60_000, headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`, 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          const chunks: Buffer[] = []
          let size = 0
          res.on('data', (c: Buffer) => {
            size += c.length
            if (size > 30 * 1024 * 1024) req.destroy(new Error('Resposta da SEFAZ grande demais.'))
            else chunks.push(c)
          })
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            if ((res.statusCode ?? 500) >= 400 && !/retDistDFeInt/.test(text)) reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode}.`))
            else resolve(text)
          })
        },
      )
      req.on('timeout', () => req.destroy(new Error('A SEFAZ não respondeu em 60 segundos.')))
      req.on('error', reject)
      req.end(body)
    })
  }

  /** Uma rodada: consulta enquanto houver NSU novo (até MAX_CALLS), importa os CT-es e os cancelamentos. */
  private async run(configId: string, trigger: 'AUTO' | 'MANUAL', by?: AuthUser) {
    if (this.running.has(configId)) return null
    this.running.add(configId)
    const c = await this.prisma.freightSefazConfig.findUniqueOrThrow({ where: { id: configId } })
    const run = await this.prisma.freightSefazRun.create({ data: { tenantId: c.tenantId, configId, trigger, byName: by?.name?.slice(0, 120) ?? null, startNsu: c.lastNsu } })
    const totals = { documents: 0, imported: 0, duplicated: 0, cancelled: 0, skippedOld: 0, ignored: 0 }
    let status = 'OK'
    let message = ''
    let cStat: string | null = null
    let ultNsu = c.lastNsu
    let maxNsu = c.maxNsu
    let wait = false
    try {
      if (!c.certEnc || !c.passEnc) throw new Error('Sem certificado A1.')
      const pfx = Buffer.from(decrypt(c.certEnc), 'base64')
      const pass = decrypt(c.passEnc)
      const user = this.systemUser(c.tenantId, by)
      const ctx = { ip: null, userAgent: 'SEFAZ DF-e' } as unknown as RequestCtx
      for (let call = 0; call < MAX_CALLS; call++) {
        const r = parseDistResponse(await this.post(c.env as SefazEnv, distEnvelope({ env: c.env as SefazEnv, ufCode: c.ufCode, cnpj: c.cnpj, ultNsu }), pfx, pass))
        cStat = r.cStat
        message = r.xMotivo
        if (r.cStat === '137') {
          status = totals.documents ? 'OK' : 'SEM_DOCUMENTOS'
          wait = true
          if (r.ultNsu) ultNsu = r.ultNsu
          if (r.maxNsu) maxNsu = r.maxNsu
          break
        }
        if (r.cStat === '656') {
          status = 'AGUARDANDO'
          wait = true
          break
        }
        if (r.cStat !== '138') {
          status = 'ERRO'
          break
        }
        totals.documents += r.docs.length
        const docs: { name: string; text: string }[] = []
        for (const d of r.docs) {
          const kind = docKind(d)
          if (kind === 'OUTRO') totals.ignored++
          else if (kind === 'CTE' && !withinDays(d.xml, c.lookbackDays)) totals.skippedOld++
          else docs.push({ name: `NSU ${d.nsu}`, text: d.xml })
        }
        if (docs.length) {
          const res = await this.ctes.importDocs(user, docs, ctx, 'SEFAZ')
          totals.imported += res.imported
          totals.duplicated += res.duplicated
          totals.cancelled += res.cancelled
          totals.ignored += res.ignored.length
        }
        if (r.ultNsu) ultNsu = r.ultNsu
        if (r.maxNsu) maxNsu = r.maxNsu
        // NSU guardado a cada página: se cair no meio, continua daqui.
        await this.prisma.freightSefazConfig.update({ where: { id: c.id }, data: { lastNsu: ultNsu, maxNsu } })
        if (!nsuLess(ultNsu, maxNsu)) {
          wait = false
          break
        }
      }
    } catch (err) {
      status = 'ERRO'
      message = (err as Error).message.slice(0, 300)
      this.logger.warn(`SEFAZ (${c.cnpj}): ${message}`)
    } finally {
      this.running.delete(configId)
    }
    const now = new Date()
    const summary = status === 'ERRO' ? message : `${message}${totals.imported ? ` · ${totals.imported} CT-e(s) novo(s)` : ''}`
    await this.prisma.freightSefazConfig.update({
      where: { id: c.id },
      data: { lastNsu: ultNsu, maxNsu, lastRunAt: now, lastStatus: status, lastMessage: summary.slice(0, 300), nextAllowedAt: wait ? new Date(now.getTime() + SEFAZ_WAIT_MS) : null },
    })
    const done = await this.prisma.freightSefazRun.update({ where: { id: run.id }, data: { ...totals, status, cStat, message: message.slice(0, 300), finishedAt: now, endNsu: ultNsu } })
    await this.audit.log({ tenantId: c.tenantId, userId: by?.id ?? null, userEmail: by?.email ?? null, action: 'frete.sefaz.busca', entity: 'freight_sefaz_run', entityId: run.id, data: { origem: trigger, situacao: status, cStat, ...totals } })
    return done
  }
}
