import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Transfer, TransferStatusHistory } from '@prisma/client';
import type { Request, Response } from 'express';
import { isTransferStatus, isValidReference, maskMsisdn, STATUS_LABELS, type TransferStatus } from '@ebk/core';
import { z } from 'zod';
import { dbToMinor, money, rateToString } from '../common/amounts';
import { IdempotencyService } from '../common/idempotency.service';
import type { Actor } from '../common/audit.service';
import { CurrentUser, IdempotencyKey, RequestActor, ZodPipe, type AuthUser } from '../common/http';
import { env } from '../config/env';
import { LedgerModule } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersModule } from '../providers/provider-registry.service';
import { TransferEngine } from './transfer-engine.service';

const CreateTransferSchema = z.object({ quoteId: z.string().uuid(), beneficiaryId: z.string().uuid() });
const ListQuerySchema = z.object({
  status: z.string().optional().refine((s) => !s || isTransferStatus(s), 'Unknown status'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function transferDto(t: Transfer, history: TransferStatusHistory[] = []) {
  const snap = t.beneficiarySnapshot as { fullName: string; msisdn?: string; dialCode?: string; mobileOperatorName?: string; countryCode: string };
  const status = t.status as TransferStatus;
  return {
    id: t.id,
    reference: t.reference,
    status,
    statusLabel: STATUS_LABELS[status].label,
    statusTone: STATUS_LABELS[status].tone,
    sendAmount: money(dbToMinor(t.sendAmount, t.sourceCurrency), t.sourceCurrency),
    fee: money(dbToMinor(t.fee, t.sourceCurrency), t.sourceCurrency),
    totalPayable: money(dbToMinor(t.totalPayable, t.sourceCurrency), t.sourceCurrency),
    recipientAmount: money(dbToMinor(t.recipientAmount, t.destinationCurrency), t.destinationCurrency),
    exchangeRate: { value: rateToString(t.exchangeRate), kind: t.rateKind },
    payoutMethod: t.payoutMethod,
    recipient: {
      fullName: snap.fullName,
      network: snap.mobileOperatorName ?? null,
      accountMasked: snap.msisdn ? maskMsisdn(snap.msisdn, snap.dialCode ?? '') : null,
      country: snap.countryCode,
    },
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    timeline: history.map((h) => ({ status: h.toStatus, label: STATUS_LABELS[h.toStatus as TransferStatus].label, at: h.createdAt.toISOString() })),
  };
}

@Injectable()
export class TransfersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, q: z.infer<typeof ListQuerySchema>) {
    const rows = await this.prisma.transfer.findMany({
      where: { userId, ...(q.status ? { status: q.status as TransferStatus } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    return { items: page.map((t) => transferDto(t)), nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async get(userId: string, idOrRef: string) {
    const where = isValidReference(idOrRef) ? { reference: idOrRef, userId } : { id: idOrRef, userId };
    const t = await this.prisma.transfer.findFirst({
      where,
      include: { statusHistory: { orderBy: { createdAt: 'asc' } }, paymentAttempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!t) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
    return {
      ...transferDto(t, t.statusHistory),
      payment: t.paymentAttempts[0] ? { status: t.paymentAttempts[0].status, checkoutUrl: t.status === 'PENDING_PAYMENT' ? t.paymentAttempts[0].checkoutUrl : null } : null,
    };
  }

  /** Receipt data. The web app renders it (print-to-PDF / share). */
  async receipt(userId: string, id: string) {
    const t = await this.prisma.transfer.findFirst({ where: { id, userId }, include: { user: { include: { profile: true } }, paymentProvider: true, payoutProvider: true } });
    if (!t) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND' });
    const dto = transferDto(t);
    return {
      ...dto,
      issuer: { name: 'EBK — Empower Bank Konnect', note: 'EBK is not a bank. Payments are processed by authorised partners.' },
      sender: { name: `${t.user.profile?.firstName ?? ''} ${t.user.profile?.lastName ?? ''}`.trim(), email: t.user.email },
      paymentMethod: t.paymentProvider?.name ?? null,
      payoutMethodName: t.payoutProvider?.name ?? dto.recipient.network,
      isSandbox: t.rateKind === 'SANDBOX',
      generatedAt: new Date().toISOString(),
    };
  }
}

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly engine: TransferEngine, private readonly query: TransfersQueryService, private readonly idem: IdempotencyService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(ListQuerySchema)) q: z.infer<typeof ListQuerySchema>) {
    return this.query.list(u.id, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.query.get(u.id, id);
  }

  @Get(':id/receipt')
  receipt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.receipt(u.id, id);
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post()
  async create(
    @CurrentUser() u: AuthUser,
    @IdempotencyKey() key: string,
    @Body(new ZodPipe(CreateTransferSchema)) body: z.infer<typeof CreateTransferSchema>,
    @RequestActor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.idem.run(`user:${u.id}:transfers.create`, key, { method: 'POST', path: '/transfers', body }, async () => {
      const t = await this.engine.create(u.id, body, key, actor);
      return { status: 201, body: transferDto(t) };
    });
    res.status(r.status);
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @HttpCode(200)
  @Post(':id/confirm')
  async confirm(@CurrentUser() u: AuthUser, @IdempotencyKey() key: string, @Param('id', ParseUUIDPipe) id: string, @RequestActor() actor: Actor) {
    const r = await this.idem.run(`user:${u.id}:transfers.confirm`, key, { method: 'POST', path: `/transfers/${id}/confirm`, body: {} }, async () => ({
      status: 200,
      body: await this.engine.confirm(u.id, id, actor, `${env().APP_ORIGIN}/transfers/${id}`),
    }));
    return r.body;
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @RequestActor() actor: Actor) {
    return transferDto(await this.engine.cancel(u.id, id, actor));
  }
}

@Injectable()
export class PayoutPoller {
  private running = false;
  constructor(private readonly engine: TransferEngine) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick() {
    if (this.running) return; // no overlap within one instance (multi-instance: use pg advisory lock — see ARCHITECTURE.md)
    this.running = true;
    try {
      await this.engine.pollPendingPayouts();
    } finally {
      this.running = false;
    }
  }
}

@Module({
  imports: [LedgerModule, ProvidersModule],
  providers: [TransferEngine, TransfersQueryService, PayoutPoller],
  controllers: [TransfersController],
  exports: [TransferEngine],
})
export class TransfersModule {}
