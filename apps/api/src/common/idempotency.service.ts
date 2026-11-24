import { ConflictException, Global, Injectable, Module, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requestHash } from './crypto';

const TTL_HOURS = 24;

/**
 * Stripe-style idempotency: the first request with a key is executed and its response
 * stored; retries with the same key and same body get the stored response; the same key
 * with a different body is rejected. A key whose first request is still running → 409.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T extends object>(
    scope: string,
    key: string,
    req: { method: string; path: string; body: unknown },
    execute: () => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    const hash = requestHash(req.method, req.path, req.body);
    try {
      await this.prisma.idempotencyKey.create({
        data: { scope, key, requestHash: hash, expiresAt: new Date(Date.now() + TTL_HOURS * 3600_000) },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { scope_key: { scope, key } } });
      if (existing.requestHash !== hash) {
        throw new UnprocessableEntityException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This Idempotency-Key was used with a different request' });
      }
      if (existing.responseStatus == null) {
        throw new ConflictException({ code: 'REQUEST_IN_PROGRESS', message: 'The original request is still being processed' });
      }
      return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true };
    }

    try {
      const result = await execute();
      await this.prisma.idempotencyKey.update({
        where: { scope_key: { scope, key } },
        data: { responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue },
      });
      return { ...result, replayed: false };
    } catch (e) {
      // Release the key so the client can retry after a failure that changed nothing.
      await this.prisma.idempotencyKey.delete({ where: { scope_key: { scope, key } } }).catch(() => undefined);
      throw e;
    }
  }
}

@Global()
@Module({ providers: [IdempotencyService], exports: [IdempotencyService] })
export class IdempotencyModule {}
