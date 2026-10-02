import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from './audit.service'

class AuditQuery {
  @IsOptional() @IsString() @MaxLength(100) action?: string
  @IsOptional() @IsString() @MaxLength(200) user?: string
  @IsOptional() @IsString() @MaxLength(100) entity?: string
  @IsOptional() @IsDateString() from?: string
  @IsOptional() @IsDateString() to?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(200) pageSize = 50
}

@ApiTags('Auditoria')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('auditoria', 'view')
  async list(@CurrentUser() user: AuthUser, @Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId: user.tenantId,
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.user ? { userEmail: { contains: q.user, mode: 'insensitive' } } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    }
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ])
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({ ...r, id: r.id.toString() })),
    }
  }

  @Get('verify')
  @RequirePermission('auditoria', 'view')
  verify() {
    return this.audit.verifyChain()
  }
}
