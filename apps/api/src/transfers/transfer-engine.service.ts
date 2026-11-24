/**
 * EBK transaction engine.
 *
 * Invariants (enforced here, and again by Postgres constraints/triggers):
 *  - every status change goes through transition(): row lock (SELECT … FOR UPDATE),
 *    state-machine check, version+1, status-history row, audit row — one DB transaction;
 *  - provider calls happen OUTSIDE database transactions, using a pre-committed attempt
 *    row whose idempotency key is sent to the provider, so a crash mid-call can be
 *    resolved by asking the provider about that key;
 *  - an UNKNOWN provider outcome is never treated as success or failure — it is polled;
 *  - after funds are collected a transfer can only complete or be refunded.
 */
import { ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, Transfer, TransferStatus } from '@prisma/client';
import {
  assertTransition, generateReference, InvalidTransitionError, parseAmount, paymentReceivedJournal, payoutCompletedJournal,
  refundCompletedJournal, type TransferAmounts,
} from '@ebk/core';
import { dbToMinor } from '../common/amounts';
import { AuditService, SYSTEM_ACTOR, type Actor } from '../common/audit.service';
import { env } from '../config/env';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ProviderNotConfiguredError, ProviderRequestError, type ParsedWebhookEvent, type ProviderResult } from '../providers/provider.types';

export const MAX_PAYOUT_ATTEMPTS = 3;
/** Failure codes after which retrying the same payout is pointless. */
const NON_RETRYABLE_PAYOUT_FAILURES = new Set(['PAYEE_NOT_FOUND', 'INVALID_MSISDN', 'NOT_ALLOWED', 'PAYEE_NOT_ALLOWED_TO_RECEIVE']);

interface BeneficiarySnapshot {
  fullName: string;
  countryCode: string;
  dialCode: string;
  payoutMethod: 'MOBILE_MONEY' | 'BANK_ACCOUNT';
  msisdn?: string;
  mobileOperatorCode?: string;
  mobileOperatorName?: string;
}

@Injectable()
export class TransferEngine {
  private readonly log = new Logger(TransferEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly providers: ProviderRegistry,
  ) {}

  // -------------------------------------------------------------------------
  // Core transition primitive
  // -------------------------------------------------------------------------
  async transition(tx: Tx, transferId: string, to: TransferStatus, actor: Actor, reason?: string, extra: Prisma.TransferUncheckedUpdateManyInput = {}): Promise<Transfer> {
    const [locked] = await tx.$queryRaw<{ status: TransferStatus; version: number }[]>`
      SELECT status, version FROM transfers WHERE id = ${transferId}::uuid FOR UPDATE`;
    if (!locked) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND' });
    try {
      assertTransition(locked.status, to);
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        throw new UnprocessableEntityException({ code: 'INVALID_STATE', message: `This transfer is ${locked.status.toLowerCase().replace(/_/g, ' ')}` });
      }
      throw e;
    }
    const res = await tx.transfer.updateMany({
      where: { id: transferId, version: locked.version },
      data: { ...extra, status: to, version: locked.version + 1 },
    });
    if (res.count !== 1) throw new Error(`Concurrent update of transfer ${transferId}`);
    await tx.transferStatusHistory.create({
      data: { transferId, fromStatus: locked.status, toStatus: to, reason, actorType: actor.type, actorId: actor.id },
    });
    await this.audit.record(actor, 'transfer.status_changed', { type: 'transfer', id: transferId }, { before: { status: locked.status }, after: { status: to }, metadata: { reason } }, tx);
    return tx.transfer.findUniqueOrThrow({ where: { id: transferId } });
  }

  private amounts(t: Transfer, collectionProvider: string, payoutProvider: string): TransferAmounts {
    return {
      reference: t.reference,
      sourceCurrency: t.sourceCurrency,
      destinationCurrency: t.destinationCurrency,
      sendAmountMinor: dbToMinor(t.sendAmount, t.sourceCurrency),
      feeMinor: dbToMinor(t.fee, t.sourceCurrency),
      recipientAmountMinor: dbToMinor(t.recipientAmount, t.destinationCurrency),
      collectionProvider,
      payoutProvider,
    };
  }

  // -------------------------------------------------------------------------
  // 1. Create (DRAFT) from a locked quote
  // -------------------------------------------------------------------------
  async create(userId: string, input: { quoteId: string; beneficiaryId: string }, idempotencyKey: string, actor: Actor): Promise<Transfer> {
    return this.prisma.financial(async (tx) => {
      const profile = await tx.customerProfile.findUnique({ where: { userId }, include: { user: true } });
      if (!profile || profile.user.status !== 'ACTIVE') throw new ForbiddenException({ code: 'ACCOUNT_NOT_ACTIVE', message: 'Your account is not active' });
      if (profile.kycStatus !== 'VERIFIED') {
        throw new ForbiddenException({ code: 'KYC_REQUIRED', message: 'Please verify your identity before sending money' });
      }
      const quote = await tx.quote.findFirst({ where: { id: input.quoteId, userId }, include: { corridor: true } });
      if (!quote) throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'Quote not found' });
      if (quote.usedAt) throw new UnprocessableEntityException({ code: 'QUOTE_USED', message: 'This quote has already been used' });
      if (quote.expiresAt <= new Date()) throw new UnprocessableEntityException({ code: 'QUOTE_EXPIRED', message: 'This rate has expired. Please refresh the quote.' });

      const b = await tx.beneficiary.findFirst({ where: { id: input.beneficiaryId, userId, deletedAt: null }, include: { mobileOperator: true } });
      if (!b) throw new NotFoundException({ code: 'BENEFICIARY_NOT_FOUND', message: 'Recipient not found' });
      if (b.countryCode !== quote.corridor.destinationCountry || b.payoutMethod !== quote.payoutMethod) {
        throw new UnprocessableEntityException({ code: 'BENEFICIARY_MISMATCH', message: 'This recipient cannot receive this transfer' });
      }

      const country = await tx.country.findUniqueOrThrow({ where: { code: b.countryCode } });
      const snapshot: BeneficiarySnapshot = {
        fullName: b.fullName,
        countryCode: b.countryCode,
        dialCode: country.dialCode,
        payoutMethod: b.payoutMethod,
        msisdn: b.msisdn ?? undefined,
        mobileOperatorCode: b.mobileOperator?.code,
        mobileOperatorName: b.mobileOperator?.name,
      };

      const used = await tx.quote.updateMany({ where: { id: quote.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw new UnprocessableEntityException({ code: 'QUOTE_USED', message: 'This quote has already been used' });

      const t = await tx.transfer.create({
        data: {
          reference: generateReference(),
          userId,
          beneficiaryId: b.id,
          beneficiarySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          quoteId: quote.id,
          corridorId: quote.corridorId,
          sourceCurrency: quote.corridor.sourceCurrency,
          destinationCurrency: quote.corridor.destinationCurrency,
          destinationCountry: quote.corridor.destinationCountry,
          sendAmount: quote.sendAmount,
          fee: quote.fee,
          totalPayable: quote.totalPayable,
          exchangeRate: quote.rate,
          rateKind: quote.rateKind,
          recipientAmount: quote.recipientAmount,
          payoutMethod: quote.payoutMethod,
          status: 'DRAFT',
          idempotencyKey,
        },
      });
      await tx.transferStatusHistory.create({ data: { transferId: t.id, toStatus: 'DRAFT', actorType: actor.type, actorId: actor.id, reason: 'created' } });
      await this.audit.record(actor, 'transfer.create', { type: 'transfer', id: t.id }, { after: t }, tx);
      return t;
    });
  }

  // -------------------------------------------------------------------------
  // 2. Confirm → PENDING_PAYMENT and start collection with the payment partner
  // -------------------------------------------------------------------------
  async confirm(userId: string, transferId: string, actor: Actor, returnUrl: string) {
    const t0 = await this.prisma.transfer.findFirst({ where: { id: transferId, userId }, include: { user: { include: { profile: true } } } });
    if (!t0) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND' });

    const providerRow = await this.providers.selectCollectionProvider(t0.sourceCurrency, t0.user.profile!.countryOfResidence);
    const adapter = this.providers.collectionAdapter(providerRow);

    // Step A (committed before calling the provider): status + attempt row.
    const attempt = await this.prisma.financial(async (tx) => {
      const quote = await tx.quote.findUniqueOrThrow({ where: { id: t0.quoteId } });
      if (quote.expiresAt <= new Date()) throw new UnprocessableEntityException({ code: 'QUOTE_EXPIRED', message: 'This rate has expired. Please start again.' });
      await this.transition(tx, t0.id, 'PENDING_PAYMENT', actor, 'customer confirmed', { paymentProviderId: providerRow.id });
      return tx.paymentAttempt.create({
        data: {
          transferId: t0.id,
          providerId: providerRow.id,
          idempotencyKey: `${t0.reference}:collect:1`,
          amount: t0.totalPayable,
          currency: t0.sourceCurrency,
          status: 'CREATED',
        },
      });
    });

    // Step B: provider call, outside any DB transaction.
    let result: ProviderResult & { checkoutUrl?: string };
    try {
      result = await adapter.initiateCollection({
        idempotencyKey: attempt.idempotencyKey,
        transferReference: t0.reference,
        amountMinor: dbToMinor(t0.totalPayable, t0.sourceCurrency),
        currency: t0.sourceCurrency,
        customer: { id: userId, email: t0.user.email, name: `${t0.user.profile!.firstName} ${t0.user.profile!.lastName}` },
        returnUrl,
        callbackUrl: `${env().API_PUBLIC_URL}/api/webhooks/${providerRow.code}`,
      });
    } catch (e) {
      const definitive = e instanceof ProviderNotConfiguredError || (e instanceof ProviderRequestError && !e.retryable);
      result = { status: definitive ? 'FAILED' : 'UNKNOWN', failureMessage: (e as Error).message };
    }

    // Step C: record outcome.
    await this.prisma.financial(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: result.status === 'FAILED' ? 'FAILED' : result.status === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING',
          providerReference: result.providerReference,
          checkoutUrl: result.checkoutUrl,
          failureCode: result.failureCode,
          failureMessage: result.failureMessage?.slice(0, 500),
          lastResponse: (result.raw ?? null) as Prisma.InputJsonValue,
        },
      });
      if (result.status === 'FAILED') await this.transition(tx, t0.id, 'FAILED', SYSTEM_ACTOR, `payment initiation failed: ${result.failureCode ?? result.failureMessage ?? 'unknown'}`);
    });
    if (result.status === 'FAILED') {
      throw new UnprocessableEntityException({ code: 'PAYMENT_INITIATION_FAILED', message: 'We could not start your payment. You have not been charged.' });
    }
    return { checkoutUrl: result.checkoutUrl ?? null, paymentStatus: result.status, sandbox: adapter.isSandbox };
  }

  // -------------------------------------------------------------------------
  // 3. Collection webhook
  // -------------------------------------------------------------------------
  async onCollectionEvent(ev: ParsedWebhookEvent): Promise<'PROCESSED' | 'IGNORED'> {
    if (!ev.ourReference) return 'IGNORED';
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { idempotencyKey: ev.ourReference }, include: { provider: true } });
    if (!attempt) return 'IGNORED';
    const provider: Actor = { type: 'PROVIDER', id: attempt.provider.code };

    let proceedToPayout = false;
    await this.prisma.financial(async (tx) => {
      const t = await tx.transfer.findUniqueOrThrow({ where: { id: attempt.transferId } });
      const fresh = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      if (fresh.status === 'SUCCEEDED' || fresh.status === 'FAILED') return; // already final — duplicate delivery

      if (ev.status === 'FAILED') {
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', failureCode: ev.failureCode, providerReference: ev.providerReference ?? fresh.providerReference } });
        if (t.status === 'PENDING_PAYMENT' || t.status === 'PAYMENT_PROCESSING') {
          await this.transition(tx, t.id, 'FAILED', provider, `payment failed: ${ev.failureCode ?? 'declined'}`);
        }
        return;
      }
      if (ev.status !== 'SUCCEEDED') return;

      // Amount and currency must match exactly what we asked for.
      const expected = dbToMinor(fresh.amount, fresh.currency);
      if (ev.amountMinor !== expected || ev.currency !== fresh.currency) {
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'UNKNOWN', failureCode: 'AMOUNT_MISMATCH' } });
        await tx.riskFlag.create({
          data: { transferId: t.id, userId: t.userId, ruleCode: 'COLLECTION_AMOUNT_MISMATCH', severity: 'HIGH', details: { expected: expected.toString(), received: String(ev.amountMinor), currency: ev.currency } },
        });
        await tx.complianceCase.create({ data: { transferId: t.id, userId: t.userId, caseType: 'PAYMENT_MISMATCH', summary: `Collected amount does not match transfer ${t.reference}` } });
        return;
      }

      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'SUCCEEDED', providerReference: ev.providerReference ?? fresh.providerReference } });
      await this.transition(tx, t.id, 'PAYMENT_RECEIVED', provider, 'payment confirmed by provider');
      await this.ledger.post(tx, paymentReceivedJournal(this.amounts(t, attempt.provider.code, 'UNASSIGNED')), {
        transferId: t.id,
        idempotencyKey: `${t.reference}:ledger:payment_received`,
      });

      // Screening. Real sanctions/PEP screening integrates here (see SECURITY.md).
      const threshold = parseAmount(env().COMPLIANCE_REVIEW_THRESHOLD_GBP, 2);
      if (t.sourceCurrency === 'GBP' && dbToMinor(t.sendAmount, 'GBP') >= threshold) {
        await tx.riskFlag.create({ data: { transferId: t.id, userId: t.userId, ruleCode: 'AMOUNT_THRESHOLD', severity: 'MEDIUM', details: { threshold: env().COMPLIANCE_REVIEW_THRESHOLD_GBP } } });
        await this.transition(tx, t.id, 'COMPLIANCE_REVIEW', SYSTEM_ACTOR, 'amount at or above review threshold');
        return;
      }
      await this.transition(tx, t.id, 'PAYOUT_PROCESSING', SYSTEM_ACTOR, 'automatic screening passed');
      proceedToPayout = true;
    });

    if (proceedToPayout) await this.startPayout(attempt.transferId).catch((e) => this.log.error(`Payout start failed for ${attempt.transferId}: ${(e as Error).message}`));
    return 'PROCESSED';
  }

  // -------------------------------------------------------------------------
  // 4. Payout
  // -------------------------------------------------------------------------
  async startPayout(transferId: string): Promise<void> {
    const t = await this.prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
    if (t.status !== 'PAYOUT_PROCESSING') return;
    const snap = t.beneficiarySnapshot as unknown as BeneficiarySnapshot;
    const providerRow = t.payoutProviderId
      ? await this.prisma.payoutProvider.findUniqueOrThrow({ where: { id: t.payoutProviderId } })
      : await this.providers.selectPayoutProvider(t.destinationCountry, t.payoutMethod, snap.mobileOperatorCode);
    const adapter = this.providers.payoutAdapter(providerRow);

    const attempt = await this.prisma.financial(async (tx) => {
      await tx.$queryRaw`SELECT id FROM transfers WHERE id = ${transferId}::uuid FOR UPDATE`;
      const open = await tx.payoutAttempt.findFirst({ where: { transferId, status: { in: ['CREATED', 'PENDING', 'UNKNOWN', 'SUCCEEDED'] } } });
      if (open) return null; // in flight or done — never start a second payout
      const n = (await tx.payoutAttempt.count({ where: { transferId } })) + 1;
      if (n > MAX_PAYOUT_ATTEMPTS) return null;
      if (!t.payoutProviderId) await tx.transfer.update({ where: { id: transferId }, data: { payoutProviderId: providerRow.id } });
      return tx.payoutAttempt.create({
        data: {
          transferId,
          providerId: providerRow.id,
          attemptNumber: n,
          idempotencyKey: `${t.reference}:payout:${n}`,
          amount: t.recipientAmount,
          currency: t.destinationCurrency,
          status: 'CREATED',
        },
      });
    });
    if (!attempt) return;

    let result: ProviderResult;
    try {
      result = await adapter.initiatePayout({
        idempotencyKey: attempt.idempotencyKey,
        transferReference: t.reference,
        amountMinor: dbToMinor(t.recipientAmount, t.destinationCurrency),
        currency: t.destinationCurrency,
        recipient: { fullName: snap.fullName, msisdn: snap.msisdn, operatorCode: snap.mobileOperatorCode },
        narration: `Money from EBK ref ${t.reference}`,
        callbackUrl: `${env().API_PUBLIC_URL}/api/webhooks/${providerRow.code}`,
      });
    } catch (e) {
      const definitive = e instanceof ProviderNotConfiguredError || (e instanceof ProviderRequestError && !e.retryable);
      result = { status: definitive ? 'FAILED' : 'UNKNOWN', failureCode: definitive ? 'NOT_SENT' : 'NETWORK', failureMessage: (e as Error).message };
    }
    await this.applyPayoutResult(attempt.id, result);
  }

  /** Apply a payout status (from initiation, polling or webhook). Idempotent. */
  async applyPayoutResult(attemptId: string, result: ProviderResult): Promise<void> {
    let retry = false;
    await this.prisma.financial(async (tx) => {
      const a = await tx.payoutAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { provider: true, transfer: { include: { paymentProvider: true } } } });
      if (a.status === 'SUCCEEDED' || a.status === 'FAILED') return;
      const status = result.status === 'SUCCEEDED' ? 'SUCCEEDED' : result.status === 'FAILED' ? 'FAILED' : result.status === 'PENDING' ? 'PENDING' : 'UNKNOWN';
      await tx.payoutAttempt.update({
        where: { id: a.id },
        data: {
          status,
          providerReference: result.providerReference ?? a.providerReference,
          failureCode: result.failureCode,
          failureMessage: result.failureMessage?.slice(0, 500),
          lastResponse: (result.raw ?? null) as Prisma.InputJsonValue,
        },
      });
      const actor: Actor = { type: 'PROVIDER', id: a.provider.code };
      if (status === 'SUCCEEDED') {
        const t = await this.transition(tx, a.transferId, 'COMPLETED', actor, 'recipient paid', { completedAt: new Date() });
        await this.ledger.post(tx, payoutCompletedJournal(this.amounts(t, a.transfer.paymentProvider?.code ?? 'UNKNOWN', a.provider.code)), {
          transferId: t.id,
          idempotencyKey: `${t.reference}:ledger:payout_completed`,
        });
        await tx.notification.create({
          data: { userId: t.userId, type: 'TRANSFER_COMPLETED', title: 'Money delivered', body: `Transfer ${t.reference} has been paid to the recipient.`, data: { transferId: t.id } },
        });
      } else if (status === 'FAILED') {
        const attempts = await tx.payoutAttempt.count({ where: { transferId: a.transferId } });
        if (attempts < MAX_PAYOUT_ATTEMPTS && !NON_RETRYABLE_PAYOUT_FAILURES.has(result.failureCode ?? '')) {
          retry = true; // transfer stays PAYOUT_PROCESSING; a new attempt is created
        } else {
          await this.transition(tx, a.transferId, 'REFUND_PENDING', SYSTEM_ACTOR, `payout failed: ${result.failureCode ?? 'unknown'}`);
          await tx.complianceCase.create({
            data: { transferId: a.transferId, userId: a.transfer.userId, caseType: 'PAYOUT_FAILED', summary: `Payout failed (${result.failureCode ?? 'unknown'}) — refund required for ${a.transfer.reference}` },
          });
        }
      }
    });
    if (retry) {
      const t = await this.prisma.payoutAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      await this.startPayout(t.transferId);
    }
  }

  /** Poll payouts that are pending or in an unknown state (called by the scheduler). */
  async pollPendingPayouts(olderThanSeconds = 20, limit = 50): Promise<number> {
    const due = await this.prisma.payoutAttempt.findMany({
      where: { status: { in: ['PENDING', 'UNKNOWN', 'CREATED'] }, updatedAt: { lt: new Date(Date.now() - olderThanSeconds * 1000) } },
      include: { provider: true },
      take: limit,
      orderBy: { updatedAt: 'asc' },
    });
    for (const a of due) {
      try {
        const res = await this.providers.payoutAdapter(a.provider).getPayoutStatus(a.idempotencyKey, a.providerReference ?? undefined);
        if (res.status === 'PENDING' || res.status === 'UNKNOWN') {
          await this.prisma.payoutAttempt.update({ where: { id: a.id }, data: { status: res.status, updatedAt: new Date() } });
        } else {
          await this.applyPayoutResult(a.id, res);
        }
      } catch (e) {
        this.log.warn(`Status check failed for payout ${a.idempotencyKey}: ${(e as Error).message}`);
      }
    }
    return due.length;
  }

  /** Called by the webhook pipeline for payout callbacks (re-queries status; never trusts the body alone). */
  async onPayoutEvent(ev: ParsedWebhookEvent): Promise<'PROCESSED' | 'IGNORED'> {
    const a = await this.prisma.payoutAttempt.findFirst({
      where: { OR: [{ idempotencyKey: ev.ourReference ?? '' }, { providerReference: ev.providerReference ?? '' }] },
      include: { provider: true },
    });
    if (!a) return 'IGNORED';
    const res = await this.providers.payoutAdapter(a.provider).getPayoutStatus(a.idempotencyKey, a.providerReference ?? undefined);
    if (res.status === 'SUCCEEDED' || res.status === 'FAILED') await this.applyPayoutResult(a.id, res);
    return 'PROCESSED';
  }

  // -------------------------------------------------------------------------
  // 5. Cancel and refund
  // -------------------------------------------------------------------------
  async cancel(userId: string, transferId: string, actor: Actor) {
    return this.prisma.financial(async (tx) => {
      const t = await tx.transfer.findFirst({ where: { id: transferId, userId } });
      if (!t) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND' });
      const paid = await tx.paymentAttempt.findFirst({ where: { transferId, status: { in: ['SUCCEEDED', 'UNKNOWN'] } } });
      if (paid) throw new UnprocessableEntityException({ code: 'PAYMENT_IN_PROGRESS', message: 'This transfer can no longer be cancelled. Contact support for a refund.' });
      await tx.paymentAttempt.updateMany({ where: { transferId, status: { in: ['CREATED', 'PENDING'] } }, data: { status: 'CANCELLED' } });
      return this.transition(tx, transferId, 'CANCELLED', actor, 'cancelled by customer');
    });
  }

  /** Completes a refund once the collection partner confirms it (admin-initiated, four-eyes in admin portal). */
  async completeRefund(refundId: string, actor: Actor) {
    return this.prisma.financial(async (tx) => {
      const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { transfer: { include: { paymentProvider: true } } } });
      if (r.status === 'COMPLETED') return r;
      await tx.refund.update({ where: { id: r.id }, data: { status: 'COMPLETED' } });
      const t = await this.transition(tx, r.transferId, 'REFUNDED', actor, 'refund completed');
      await this.ledger.post(tx, refundCompletedJournal(this.amounts(t, r.transfer.paymentProvider?.code ?? 'UNKNOWN', 'NONE'), r.includesFee), {
        transferId: t.id,
        idempotencyKey: `${t.reference}:ledger:refund_completed`,
      });
      return r;
    });
  }
}
