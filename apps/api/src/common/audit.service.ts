import { Global, Injectable, Module } from '@nestjs/common';
import type { ActorType, Prisma } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export interface Actor {
  type: ActorType;
  id?: string;
  ip?: string;
  userAgent?: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', id: 'ebk-api' };

/** Fields never written to audit before/after snapshots. */
const REDACT = new Set(['passwordHash', 'mfaSecretEnc', 'bankAccountNumberEnc', 'documentNumberEnc', 'refreshTokenHash']);

function redact(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (REDACT.has(k) ? '[REDACTED]' : typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Append an audit record. Pass `tx` so the record commits atomically with the change. */
  async record(
    actor: Actor,
    action: string,
    entity: { type: string; id?: string },
    detail: { before?: unknown; after?: unknown; metadata?: Record<string, unknown> } = {},
    tx?: Tx,
  ): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        actorType: actor.type,
        actorId: actor.id,
        ipAddress: actor.ip,
        userAgent: actor.userAgent?.slice(0, 300),
        action,
        entityType: entity.type,
        entityId: entity.id,
        before: redact(detail.before),
        after: redact(detail.after),
        metadata: redact(detail.metadata ?? {}) ?? {},
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
