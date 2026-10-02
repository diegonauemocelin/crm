import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { env } from '../config/env'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { compareSemver, loadReleases, type ReleaseEntry } from './releases'

const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000

@Injectable()
export class SystemService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemService.name)
  private releases: ReleaseEntry[] = []
  private latestRemote: { version: string | null; checkedAt: number; url: string | null } | null = null

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    this.releases = loadReleases(env.releasesFile)
    // Registra no banco quando cada versão foi instalada neste servidor. Versões já conhecidas mantêm a data original.
    for (const r of this.releases) {
      await this.prisma.systemRelease.upsert({
        where: { version: r.version },
        create: { version: r.version, releasedAt: new Date(r.date), title: r.title, changes: r.changes as unknown as Prisma.InputJsonValue },
        update: { releasedAt: new Date(r.date), title: r.title, changes: r.changes as unknown as Prisma.InputJsonValue },
      })
    }
    this.logger.log(`Versão em execução: ${this.currentVersion} (commit ${env.gitCommit})`)
  }

  get currentVersion(): string {
    return this.releases[0]?.version ?? '0.0.0'
  }

  async version() {
    const current = this.releases[0]
    const remote = await this.checkRemote()
    const updateAvailable = !!remote?.version && compareSemver(remote.version, this.currentVersion) > 0
    return {
      version: this.currentVersion,
      releasedAt: current?.date ?? null,
      commit: env.gitCommit,
      buildDate: env.buildDate,
      latestAvailable: remote?.version ?? null,
      latestUrl: remote?.url ?? null,
      updateCheckEnabled: !!env.githubRepo,
      updateAvailable,
      upToDate: !updateAvailable,
    }
  }

  async history() {
    const rows = await this.prisma.systemRelease.findMany()
    return rows
      .sort((a, b) => compareSemver(b.version, a.version))
      .map((r) => ({
        version: r.version,
        releasedAt: r.releasedAt,
        installedAt: r.installedAt,
        title: r.title,
        changes: r.changes,
        current: r.version === this.currentVersion,
      }))
  }

  async health() {
    const started = Date.now()
    await this.prisma.$queryRaw`SELECT 1`
    return { status: 'ok', version: this.currentVersion, db: 'ok', dbLatencyMs: Date.now() - started, uptimeSec: Math.round(process.uptime()) }
  }

  /**
   * Consulta a última release publicada no GitHub (GITHUB_REPO=dono/repositorio) para avisar
   * administradores quando há versão nova. Cache de 6 h; falhas não afetam o sistema.
   */
  private async checkRemote() {
    if (!env.githubRepo || !/^[\w.-]+\/[\w.-]+$/.test(env.githubRepo)) return null
    if (this.latestRemote && Date.now() - this.latestRemote.checkedAt < UPDATE_CHECK_TTL_MS) return this.latestRemote
    try {
      const res = await fetch(`https://api.github.com/repos/${env.githubRepo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'crm-update-check',
          ...(env.githubToken ? { Authorization: `Bearer ${env.githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        this.latestRemote = { version: null, url: null, checkedAt: Date.now() }
        return this.latestRemote
      }
      const body = (await res.json()) as { tag_name?: string; html_url?: string }
      this.latestRemote = { version: body.tag_name?.replace(/^v/, '') ?? null, url: body.html_url ?? null, checkedAt: Date.now() }
    } catch (err) {
      this.logger.warn(`Checagem de atualização falhou: ${(err as Error).message}`)
      this.latestRemote = { version: null, url: null, checkedAt: Date.now() }
    }
    return this.latestRemote
  }
}
