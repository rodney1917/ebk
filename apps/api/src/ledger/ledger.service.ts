import { Injectable, Module } from '@nestjs/common';
import type { AccountType } from '@prisma/client';
import { assertBalanced, type Journal } from '@ebk/core';
import { minorToDb } from '../common/amounts';
import type { Tx } from '../prisma/prisma.service';

function accountType(code: string): AccountType {
  if (code.startsWith('COLLECTION_CLEARING:') || code.startsWith('PAYOUT_FUNDING:')) return 'ASSET';
  if (code.startsWith('CUSTOMER_TRANSFERS:')) return 'LIABILITY';
  if (code.startsWith('FEE_REVENUE:')) return 'REVENUE';
  return 'EQUITY';
}

/**
 * Posts @ebk/core journals. Balance is checked here AND by a deferred constraint
 * trigger in Postgres, so an unbalanced posting cannot commit even if this code is bypassed.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, journal: Journal, opts: { transferId?: string; idempotencyKey: string; description?: string; reversesId?: string }) {
    assertBalanced(journal.lines);
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing; // already posted (webhook retry etc.)

    const accountIds = new Map<string, string>();
    for (const line of journal.lines) {
      if (accountIds.has(line.account)) continue;
      const acc = await tx.financialAccount.upsert({
        where: { code: line.account },
        update: {},
        create: { code: line.account, name: line.account.replace(/[:_]/g, ' '), type: accountType(line.account), currency: line.currency },
      });
      accountIds.set(line.account, acc.id);
    }
    return tx.ledgerTransaction.create({
      data: {
        eventType: journal.eventType,
        transferId: opts.transferId,
        idempotencyKey: opts.idempotencyKey,
        description: opts.description,
        reversesId: opts.reversesId,
        entries: {
          create: journal.lines.map((l) => ({
            accountId: accountIds.get(l.account)!,
            side: l.side,
            amount: minorToDb(l.amountMinor, l.currency),
            currency: l.currency,
          })),
        },
      },
    });
  }
}

@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
