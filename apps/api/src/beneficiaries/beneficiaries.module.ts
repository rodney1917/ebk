import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe,
  Patch, Post, UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, type Beneficiary, type MobileOperator } from '@prisma/client';
import { maskMsisdn, validateMobileMoneyNumber, validateRecipientName } from '@ebk/core';
import { z } from 'zod';
import { AuditService, type Actor } from '../common/audit.service';
import { CurrentUser, RequestActor, ZodPipe, type AuthUser } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceDataModule, ReferenceDataService } from '../reference-data/reference-data.service';

export const BeneficiarySchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  nickname: z.string().trim().max(40).optional(),
  countryCode: z.string().length(2).toUpperCase(),
  payoutMethod: z.literal('MOBILE_MONEY'), // BANK_ACCOUNT: schema ready, flow pending a bank payout partner
  mobileOperatorCode: z.string().min(2).max(30),
  mobileNumber: z.string().trim().min(6).max(20),
});
export type BeneficiaryInput = z.infer<typeof BeneficiarySchema>;

export function beneficiaryDto(b: Beneficiary & { mobileOperator: MobileOperator | null }, dialCode: string) {
  return {
    id: b.id,
    fullName: b.fullName,
    nickname: b.nickname,
    countryCode: b.countryCode,
    payoutMethod: b.payoutMethod,
    mobileOperator: b.mobileOperator ? { code: b.mobileOperator.code, name: b.mobileOperator.name } : null,
    mobileNumberMasked: b.msisdn ? maskMsisdn(b.msisdn, dialCode) : null,
    mobileNumber: b.msisdn ? `+${b.msisdn}` : null, // owner-only endpoint; needed for edit form
    createdAt: b.createdAt.toISOString(),
  };
}

@Injectable()
export class BeneficiariesService {
  constructor(private readonly prisma: PrismaService, private readonly ref: ReferenceDataService, private readonly audit: AuditService) {}

  private async validate(input: BeneficiaryInput) {
    const nameError = validateRecipientName(input.fullName);
    if (nameError) throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', fields: [{ path: 'fullName', message: nameError }] });
    const { phone, operators } = await this.ref.phoneConfig(input.countryCode);
    const check = validateMobileMoneyNumber(input.mobileNumber, input.mobileOperatorCode, phone, operators);
    if (!check.ok) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        fields: [{ path: 'mobileNumber', message: check.error }],
        detectedOperator: check.detectedOperator,
      });
    }
    const operator = operators.find((o) => o.code === input.mobileOperatorCode)!;
    return { msisdn: check.msisdn!, operatorId: operator.id, dialCode: phone.dialCode, fullName: input.fullName.trim().replace(/\s+/g, ' ') };
  }

  private async owned(userId: string, id: string) {
    const b = await this.prisma.beneficiary.findFirst({ where: { id, userId, deletedAt: null }, include: { mobileOperator: true } });
    if (!b) throw new NotFoundException({ code: 'BENEFICIARY_NOT_FOUND', message: 'Recipient not found' });
    return b;
  }

  async list(userId: string) {
    const rows = await this.prisma.beneficiary.findMany({
      where: { userId, deletedAt: null },
      include: { mobileOperator: true },
      orderBy: { createdAt: 'desc' },
    });
    const dial = await this.dialCodes(rows.map((r) => r.countryCode));
    return rows.map((r) => beneficiaryDto(r, dial.get(r.countryCode) ?? ''));
  }

  async get(userId: string, id: string) {
    const b = await this.owned(userId, id);
    return beneficiaryDto(b, (await this.dialCodes([b.countryCode])).get(b.countryCode) ?? '');
  }

  async create(userId: string, input: BeneficiaryInput, actor: Actor) {
    const v = await this.validate(input);
    try {
      const b = await this.prisma.beneficiary.create({
        data: {
          userId,
          fullName: v.fullName,
          nickname: input.nickname || null,
          countryCode: input.countryCode,
          payoutMethod: 'MOBILE_MONEY',
          mobileOperatorId: v.operatorId,
          msisdn: v.msisdn,
        },
        include: { mobileOperator: true },
      });
      await this.audit.record(actor, 'beneficiary.create', { type: 'beneficiary', id: b.id }, { after: b });
      return beneficiaryDto(b, v.dialCode);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'BENEFICIARY_EXISTS', message: 'You already have a recipient with this number' });
      }
      throw e;
    }
  }

  async update(userId: string, id: string, input: BeneficiaryInput, actor: Actor) {
    const before = await this.owned(userId, id);
    const v = await this.validate(input);
    // Past transfers are unaffected: each transfer stores a beneficiary snapshot.
    const b = await this.prisma.beneficiary.update({
      where: { id: before.id },
      data: { fullName: v.fullName, nickname: input.nickname || null, mobileOperatorId: v.operatorId, msisdn: v.msisdn },
      include: { mobileOperator: true },
    });
    await this.audit.record(actor, 'beneficiary.update', { type: 'beneficiary', id }, { before, after: b });
    return beneficiaryDto(b, v.dialCode);
  }

  /** Soft delete: the row is retained for transfer history and audit. */
  async remove(userId: string, id: string, actor: Actor) {
    const b = await this.owned(userId, id);
    await this.prisma.beneficiary.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
    await this.audit.record(actor, 'beneficiary.delete', { type: 'beneficiary', id });
  }

  private async dialCodes(codes: string[]) {
    const rows = await this.prisma.country.findMany({ where: { code: { in: [...new Set(codes)] } }, select: { code: true, dialCode: true } });
    return new Map(rows.map((r) => [r.code, r.dialCode]));
  }
}

@ApiTags('beneficiaries')
@ApiBearerAuth()
@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly svc: BeneficiariesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.id);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.id, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(BeneficiarySchema)) body: BeneficiaryInput, @RequestActor() actor: Actor) {
    return this.svc.create(u.id, body, actor);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(BeneficiarySchema)) body: BeneficiaryInput, @RequestActor() actor: Actor) {
    return this.svc.update(u.id, id, body, actor);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @RequestActor() actor: Actor) {
    return this.svc.remove(u.id, id, actor);
  }
}

@Module({ imports: [ReferenceDataModule], providers: [BeneficiariesService], controllers: [BeneficiariesController], exports: [BeneficiariesService] })
export class BeneficiariesModule {}
