import { Controller, Get, Injectable, Module, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CorridorLimits, CountryPhoneConfig, ExchangeRate, FeeRule, MobileOperatorConfig } from '@ebk/core';
import { dbToMinor, minorToDb, rateToString } from '../common/amounts';
import { Public } from '../common/http';
import { isProduction } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface LoadedCorridor {
  id: string;
  sourceCountry: string;
  sourceCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  limits: CorridorLimits;
  quoteLockSeconds: number;
}

/** Loads country/corridor/fee/rate configuration from the database into @ebk/core types. */
@Injectable()
export class ReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  async corridor(id: string): Promise<LoadedCorridor> {
    const c = await this.prisma.corridor.findUnique({ where: { id } });
    if (!c || !c.active) throw new NotFoundException({ code: 'CORRIDOR_NOT_AVAILABLE', message: 'This destination is not available' });
    return {
      id: c.id,
      sourceCountry: c.sourceCountry,
      sourceCurrency: c.sourceCurrency,
      destinationCountry: c.destinationCountry,
      destinationCurrency: c.destinationCurrency,
      limits: { minSendMinor: dbToMinor(c.minSendAmount, c.sourceCurrency), maxSendMinor: dbToMinor(c.maxSendAmount, c.sourceCurrency) },
      quoteLockSeconds: c.quoteLockSeconds,
    };
  }

  async feeRules(sourceCurrency: string, destinationCountry: string): Promise<FeeRule[]> {
    const now = new Date();
    const rows = await this.prisma.feeRule.findMany({
      where: { sourceCurrency, destinationCountry, active: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    });
    return rows.map((r) => ({
      id: r.id,
      sourceCurrency: r.sourceCurrency,
      destinationCountry: r.destinationCountry,
      payoutMethod: r.payoutMethod,
      minSendMinor: dbToMinor(r.minSendAmount, r.sourceCurrency),
      maxSendMinor: r.maxSendAmount == null ? null : dbToMinor(r.maxSendAmount, r.sourceCurrency),
      fixedFeeMinor: dbToMinor(r.fixedFee, r.sourceCurrency),
      percentageBps: r.percentageBps,
      minFeeMinor: r.minFee == null ? null : dbToMinor(r.minFee, r.sourceCurrency),
      maxFeeMinor: r.maxFee == null ? null : dbToMinor(r.maxFee, r.sourceCurrency),
      priority: r.priority,
      active: r.active,
    }));
  }

  /**
   * Latest rate for a pair. In production only LIVE/ESTIMATED rows are considered —
   * a SANDBOX rate can never surface there.
   */
  async currentRate(source: string, destination: string): Promise<ExchangeRate & { id: string }> {
    const row = await this.prisma.exchangeRate.findFirst({
      where: { sourceCurrency: source, destinationCurrency: destination, ...(isProduction() ? { kind: { in: ['LIVE', 'ESTIMATED'] } } : {}) },
      orderBy: { fetchedAt: 'desc' },
    });
    if (!row) throw new ServiceUnavailableException({ code: 'RATE_UNAVAILABLE', message: 'Exchange rates are temporarily unavailable' });
    return {
      id: row.id,
      sourceCurrency: row.sourceCurrency,
      destinationCurrency: row.destinationCurrency,
      rate: rateToString(row.rate),
      kind: row.kind,
      source: row.source,
      fetchedAt: row.fetchedAt.toISOString(),
      validUntil: row.validUntil?.toISOString(),
    };
  }

  async phoneConfig(countryCode: string): Promise<{ phone: CountryPhoneConfig; operators: (MobileOperatorConfig & { id: string })[] }> {
    const c = await this.prisma.country.findUnique({ where: { code: countryCode }, include: { mobileOperators: true } });
    if (!c || !c.active || !c.canReceive) throw new NotFoundException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Sending to this country is not available' });
    return {
      phone: { countryCode: c.code, dialCode: c.dialCode, nationalNumberLength: c.nationalNumberLength, trunkPrefix: c.trunkPrefix ?? undefined },
      operators: c.mobileOperators.map((o) => ({ id: o.id, code: o.code, name: o.name, prefixes: o.prefixes, active: o.active })),
    };
  }
}

@ApiTags('reference-data')
@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: corridors, destination countries and payout operators for the send screen. */
  @Public()
  @Get('corridors')
  async corridors() {
    const rows = await this.prisma.corridor.findMany({ where: { active: true } });
    const countries = await this.prisma.country.findMany({
      where: { code: { in: rows.map((r) => r.destinationCountry) } },
      include: { mobileOperators: { where: { active: true } } },
    });
    return rows.map((c) => {
      const dest = countries.find((d) => d.code === c.destinationCountry);
      return {
        id: c.id,
        source: { country: c.sourceCountry, currency: c.sourceCurrency },
        destination: { country: c.destinationCountry, currency: c.destinationCurrency, name: dest?.name, dialCode: dest?.dialCode },
        limits: { min: minorToDb(dbToMinor(c.minSendAmount, c.sourceCurrency), c.sourceCurrency), max: minorToDb(dbToMinor(c.maxSendAmount, c.sourceCurrency), c.sourceCurrency) },
        payoutMethods: dest?.payoutMethods ?? [],
        mobileOperators: dest?.mobileOperators.map((o) => ({ code: o.code, name: o.name })) ?? [],
      };
    });
  }
}

@Module({ providers: [ReferenceDataService], controllers: [ReferenceDataController], exports: [ReferenceDataService] })
export class ReferenceDataModule {}
