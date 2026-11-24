/**
 * Seeds reference data (currencies, countries, operators, corridors, fee rules, RBAC).
 * In non-production environments it also seeds the clearly-labelled SANDBOX providers,
 * a SANDBOX exchange rate and a demo customer. None of that is ever seeded in production.
 *
 *   npm run db:seed            (uses DATABASE_URL)
 */
import { PrismaClient } from '@prisma/client';
import { COUNTRIES, CORRIDORS, CURRENCIES, DEFAULT_FEE_RULES, toDecimalString } from '@ebk/core';
import { hashPassword } from '../src/common/crypto';

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === 'production';
const dec = (minor: bigint | null | undefined) => (minor == null ? null : toDecimalString(minor, 2));

const PERMISSIONS = [
  'customers.read', 'customers.suspend', 'customers.notes',
  'kyc.review', 'transfers.read', 'transfers.retry', 'refunds.request', 'refunds.approve',
  'providers.manage', 'reconciliation.run', 'compliance.cases', 'audit.read', 'settings.manage', 'admins.manage',
] as const;

const ROLES: Record<string, { name: string; permissions: readonly (typeof PERMISSIONS)[number][] }> = {
  SUPER_ADMIN: { name: 'Super administrator', permissions: PERMISSIONS },
  OPERATIONS: { name: 'Operations', permissions: ['customers.read', 'transfers.read', 'transfers.retry', 'refunds.request', 'reconciliation.run'] },
  COMPLIANCE: { name: 'Compliance officer', permissions: ['customers.read', 'customers.suspend', 'kyc.review', 'transfers.read', 'compliance.cases', 'refunds.approve', 'audit.read'] },
  SUPPORT: { name: 'Customer support', permissions: ['customers.read', 'customers.notes', 'transfers.read'] },
  FINANCE: { name: 'Finance', permissions: ['transfers.read', 'reconciliation.run', 'refunds.approve', 'audit.read'] },
};

async function main() {
  for (const c of Object.values(CURRENCIES)) {
    await prisma.currency.upsert({ where: { code: c.code }, update: { name: c.name, symbol: c.symbol }, create: c });
  }
  for (const c of COUNTRIES) {
    const data = {
      name: c.name, currencyCode: c.currency, dialCode: c.phone.dialCode, nationalNumberLength: c.phone.nationalNumberLength,
      trunkPrefix: c.phone.trunkPrefix ?? null, canSend: c.canSend, canReceive: c.canReceive, payoutMethods: c.payoutMethods,
    };
    await prisma.country.upsert({ where: { code: c.code }, update: data, create: { code: c.code, ...data } });
    for (const o of c.mobileOperators) {
      const maxPayoutAmount = o.maxPayoutMinor == null ? null : toDecimalString(o.maxPayoutMinor, 2);
      await prisma.mobileOperator.upsert({
        where: { code: o.code },
        update: { name: o.name, prefixes: o.prefixes, active: o.active, maxPayoutAmount },
        create: { code: o.code, name: o.name, prefixes: o.prefixes, active: o.active, countryCode: c.code, maxPayoutAmount },
      });
    }
  }
  for (const c of CORRIDORS) {
    const data = {
      sourceCountry: c.sourceCountry, sourceCurrency: c.sourceCurrency, destinationCountry: c.destinationCountry, destinationCurrency: c.destinationCurrency,
      minSendAmount: dec(c.minSendMinor)!, maxSendAmount: dec(c.maxSendMinor)!, quoteLockSeconds: c.quoteLockSeconds, active: c.active,
    };
    await prisma.corridor.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
  }
  for (const r of DEFAULT_FEE_RULES) {
    const data = {
      sourceCurrency: r.sourceCurrency, destinationCountry: r.destinationCountry, payoutMethod: (r.payoutMethod ?? null) as 'MOBILE_MONEY' | null,
      minSendAmount: dec(r.minSendMinor)!, maxSendAmount: dec(r.maxSendMinor), fixedFee: dec(r.fixedFeeMinor)!, percentageBps: r.percentageBps,
      minFee: dec(r.minFeeMinor), maxFee: dec(r.maxFeeMinor), priority: r.priority, active: r.active,
    };
    await prisma.feeRule.upsert({ where: { code: r.id }, update: data, create: { code: r.id, ...data } });
  }
  for (const code of PERMISSIONS) await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  for (const [code, role] of Object.entries(ROLES)) {
    const r = await prisma.role.upsert({ where: { code }, update: { name: role.name }, create: { code, name: role.name } });
    for (const p of role.permissions) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code: p } });
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: r.id, permissionId: perm.id } }, update: {}, create: { roleId: r.id, permissionId: perm.id } });
    }
  }
  // Production payment providers are added through the admin portal after partner onboarding.
  await prisma.payoutProvider.upsert({
    where: { code: 'MTN_MOMO_ZM' },
    update: {},
    create: {
      code: 'MTN_MOMO_ZM', name: 'MTN MoMo (Disbursement API)', adapter: 'mtn-momo-disbursement', environment: 'SANDBOX',
      countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY', mobileOperatorCodes: ['MTN_ZM'], supportedCurrencies: ['ZMW'],
      config: { sandboxCurrencyOverride: 'EUR' }, credentialsRef: 'MTN_MOMO_DISBURSEMENT_*', active: false, priority: 10,
    },
  });
  // Flutterwave: payouts to MTN, Airtel and Zamtel. Inactive until FLW_* keys are configured and
  // it is switched on deliberately (UPDATE payout_providers SET active = true WHERE code = 'FLUTTERWAVE_ZM').
  await prisma.payoutProvider.upsert({
    where: { code: 'FLUTTERWAVE_ZM' },
    update: {},
    create: {
      code: 'FLUTTERWAVE_ZM', name: 'Flutterwave Transfers', adapter: 'flutterwave-transfers', environment: 'SANDBOX',
      countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY', mobileOperatorCodes: ['MTN_ZM', 'AIRTEL_ZM', 'ZAMTEL_ZM'], supportedCurrencies: ['ZMW'],
      config: { operatorMap: { MTN_ZM: 'MTN', AIRTEL_ZM: 'AIRTEL', ZAMTEL_ZM: 'ZAMTEL' } }, credentialsRef: 'FLW_SECRET_KEY / FLW_WEBHOOK_SECRET_HASH',
      active: false, priority: 20,
    },
  });
  await prisma.payoutProvider.upsert({
    where: { code: 'AIRTEL_MONEY_ZM' },
    update: {},
    create: {
      code: 'AIRTEL_MONEY_ZM', name: 'Airtel Money (Disbursement API)', adapter: 'airtel-money-disbursement', environment: 'SANDBOX',
      countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY', mobileOperatorCodes: ['AIRTEL_ZM'], supportedCurrencies: ['ZMW'], active: false, priority: 10,
    },
  });

  if (isProduction) {
    console.log('Production seed complete (reference data only).');
    return;
  }

  // ---------------- SANDBOX / DEVELOPMENT DATA ONLY ----------------
  await prisma.paymentProvider.upsert({
    where: { code: 'SANDBOX_COLLECT' },
    update: { active: true },
    create: {
      code: 'SANDBOX_COLLECT', name: 'EBK Sandbox Checkout (test only)', adapter: 'sandbox-collection', environment: 'SANDBOX',
      supportedCurrencies: ['GBP'], supportedCountries: ['GB'], methods: ['CARD', 'BANK_TRANSFER'], active: true,
    },
  });
  await prisma.payoutProvider.upsert({
    where: { code: 'SANDBOX_PAYOUT_ZM' },
    update: { active: true },
    create: {
      code: 'SANDBOX_PAYOUT_ZM', name: 'EBK Sandbox Mobile Money (test only)', adapter: 'sandbox-payout', environment: 'SANDBOX',
      countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY', mobileOperatorCodes: ['MTN_ZM', 'AIRTEL_ZM'], supportedCurrencies: ['ZMW'], active: true, priority: 1,
    },
  });
  await prisma.exchangeRate.create({
    data: { sourceCurrency: 'GBP', destinationCurrency: 'ZMW', rate: '33.85000000', kind: 'SANDBOX', source: 'seed:sandbox-reference', fetchedAt: new Date() },
  });
  const email = 'demo.sender@ebk.test';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword('Sandbox-Demo-Only-2026'),
        emailVerifiedAt: new Date(),
        // Verified ONLY because this is a seeded sandbox account. Real customers are verified through KYC.
        profile: { create: { firstName: 'Demo', lastName: 'Sender', countryOfResidence: 'GB', kycStatus: 'VERIFIED', kycLevel: 1 } },
        kycCases: { create: { provider: 'SANDBOX_SEED', status: 'VERIFIED', rejectionReason: null } },
      },
    });
  }
  console.log('Development seed complete: SANDBOX providers, SANDBOX rate and demo user demo.sender@ebk.test');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
