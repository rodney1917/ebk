import { Body, Controller, HttpCode, Injectable, Module, Post, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { buildQuote, canLockQuote, currencyInfo, parseAmount, QuoteError, type Quote } from '@ebk/core';
import { z } from 'zod';
import { minorToDb, money } from '../common/amounts';
import { CurrentUser, ZodPipe, type AuthUser } from '../common/http';
import { isProduction } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceDataModule, ReferenceDataService } from '../reference-data/reference-data.service';

export const QuoteRequestSchema = z.object({
  corridorId: z.string().min(1).max(20),
  payoutMethod: z.enum(['MOBILE_MONEY', 'BANK_ACCOUNT']),
  sendAmount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 150 or 150.00'),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export function quoteDto(q: Quote, extra: { id?: string; expiresAt?: Date; locked: boolean }) {
  return {
    id: extra.id ?? null,
    locked: extra.locked,
    expiresAt: extra.expiresAt?.toISOString() ?? null,
    sendAmount: money(q.sendAmountMinor, q.sourceCurrency),
    fee: money(q.feeMinor, q.sourceCurrency),
    totalPayable: money(q.totalPayableMinor, q.sourceCurrency),
    recipientAmount: money(q.recipientAmountMinor, q.destinationCurrency),
    rate: {
      value: q.rate,
      kind: q.rateKind, // LIVE | ESTIMATED | SANDBOX — UI must label accordingly
      source: q.rateSource,
      fetchedAt: q.rateFetchedAt,
    },
    payoutMethod: q.payoutMethod,
  };
}

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService, private readonly ref: ReferenceDataService) {}

  async calculate(req: QuoteRequest) {
    const corridor = await this.ref.corridor(req.corridorId);
    const [rate, feeRules] = await Promise.all([
      this.ref.currentRate(corridor.sourceCurrency, corridor.destinationCurrency),
      this.ref.feeRules(corridor.sourceCurrency, corridor.destinationCountry),
    ]);
    try {
      const quote = buildQuote({
        sourceCurrency: corridor.sourceCurrency,
        destinationCurrency: corridor.destinationCurrency,
        destinationCountry: corridor.destinationCountry,
        payoutMethod: req.payoutMethod,
        sendAmountMinor: parseAmount(req.sendAmount, currencyInfo(corridor.sourceCurrency).minorUnits),
        rate,
        feeRules,
        limits: corridor.limits,
        now: new Date(),
      });
      return { quote, corridor, rateId: rate.id };
    } catch (e) {
      if (e instanceof QuoteError) throw new UnprocessableEntityException({ code: e.code, message: e.message });
      throw e;
    }
  }

  /** Indicative quote — not stored, not binding. */
  async estimate(req: QuoteRequest) {
    const { quote } = await this.calculate(req);
    return quoteDto(quote, { locked: false });
  }

  /** Confirmed quote — stored and locked for the corridor's lock window. */
  async lock(userId: string, req: QuoteRequest) {
    const { quote, corridor, rateId } = await this.calculate(req);
    if (!canLockQuote(quote, isProduction() ? 'production' : 'non-production')) {
      throw new UnprocessableEntityException({
        code: 'RATE_NOT_CONFIRMABLE',
        message: 'A confirmed rate is not available right now. You can still see an estimate.',
      });
    }
    const expiresAt = new Date(Date.now() + corridor.quoteLockSeconds * 1000);
    const row = await this.prisma.quote.create({
      data: {
        userId,
        corridorId: corridor.id,
        payoutMethod: quote.payoutMethod as 'MOBILE_MONEY' | 'BANK_ACCOUNT',
        sendAmount: minorToDb(quote.sendAmountMinor, quote.sourceCurrency),
        fee: minorToDb(quote.feeMinor, quote.sourceCurrency),
        totalPayable: minorToDb(quote.totalPayableMinor, quote.sourceCurrency),
        exchangeRateId: rateId,
        rate: quote.rate,
        rateKind: quote.rateKind,
        recipientAmount: minorToDb(quote.recipientAmountMinor, quote.destinationCurrency),
        feeRuleId: quote.feeRuleId,
        expiresAt,
      },
    });
    return quoteDto(quote, { id: row.id, expiresAt, locked: true });
  }
}

@ApiTags('quotes')
@ApiBearerAuth()
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @HttpCode(200)
  @Post('estimate')
  estimate(@Body(new ZodPipe(QuoteRequestSchema)) body: QuoteRequest) {
    return this.quotes.estimate(body);
  }

  @Post()
  lock(@CurrentUser() user: AuthUser, @Body(new ZodPipe(QuoteRequestSchema)) body: QuoteRequest) {
    return this.quotes.lock(user.id, body);
  }
}

@Module({ imports: [ReferenceDataModule], providers: [QuotesService], controllers: [QuotesController], exports: [QuotesService] })
export class QuotesModule {}
