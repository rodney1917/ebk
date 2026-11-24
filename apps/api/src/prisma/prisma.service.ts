import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Serializable transaction with a bounded wait — used for every financial state change.
   * Serialization failures (P2034) are retried with jitter; the callback must therefore be
   * free of external side effects (provider calls happen outside, see TransferEngine).
   */
  async financial<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await this.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
      } catch (e) {
        const retryable = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
        if (!retryable || i >= attempts) throw e;
        await new Promise((r) => setTimeout(r, 25 * i + Math.random() * 50));
      }
    }
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
