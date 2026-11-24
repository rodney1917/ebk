/**
 * Beneficiary validation driven by per-country configuration (no country-specific
 * logic hardcoded here — Zambia is just the first configuration, see corridors.ts).
 */

export type PayoutMethodType = 'MOBILE_MONEY' | 'BANK_ACCOUNT';

export interface MobileOperatorConfig {
  code: string; // e.g. "MTN_ZM"
  name: string; // e.g. "MTN MoMo"
  /** National significant number prefixes, e.g. ["96", "76"] */
  prefixes: string[];
  active: boolean;
  /** Maximum a single payout to this network may credit (destination minor units). null = no network limit. */
  maxPayoutMinor?: bigint | null;
}

/** Returns an error message if the recipient amount exceeds the network's per-transfer limit. */
export function payoutLimitError(recipientAmountMinor: bigint, operator: Pick<MobileOperatorConfig, 'name' | 'maxPayoutMinor'>, formatted: (minor: bigint) => string): string | null {
  if (operator.maxPayoutMinor == null || recipientAmountMinor <= operator.maxPayoutMinor) return null;
  return `${operator.name} accepts up to ${formatted(operator.maxPayoutMinor)} per transfer. Please send a smaller amount.`;
}

export interface CountryPhoneConfig {
  countryCode: string; // ISO alpha-2
  dialCode: string; // e.g. "260"
  nationalNumberLength: number; // digits after dial code, e.g. 9
  trunkPrefix?: string; // e.g. "0"
}

export interface MsisdnResult {
  ok: boolean;
  /** E.164 without "+", e.g. "260961234567" */
  msisdn?: string;
  /** Operator detected from the prefix, if any */
  detectedOperator?: string;
  error?: string;
}

/** Normalise local or international formats to E.164 digits and validate length. */
export function normaliseMsisdn(input: string, cfg: CountryPhoneConfig): MsisdnResult {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return { ok: false, error: 'Phone number may only contain digits' };

  let national: string;
  if (digits.startsWith(cfg.dialCode) && digits.length === cfg.dialCode.length + cfg.nationalNumberLength) {
    national = digits.slice(cfg.dialCode.length);
  } else if (cfg.trunkPrefix && digits.startsWith(cfg.trunkPrefix) && digits.length === cfg.trunkPrefix.length + cfg.nationalNumberLength) {
    national = digits.slice(cfg.trunkPrefix.length);
  } else if (digits.length === cfg.nationalNumberLength) {
    national = digits;
  } else {
    return { ok: false, error: `Enter a valid ${cfg.countryCode} mobile number` };
  }
  return { ok: true, msisdn: cfg.dialCode + national };
}

/** Validate that a mobile number belongs to the chosen operator. */
export function validateMobileMoneyNumber(
  input: string,
  operatorCode: string,
  cfg: CountryPhoneConfig,
  operators: MobileOperatorConfig[],
): MsisdnResult {
  const n = normaliseMsisdn(input, cfg);
  if (!n.ok) return n;
  const national = n.msisdn!.slice(cfg.dialCode.length);
  const detected = operators.find((o) => o.active && o.prefixes.some((p) => national.startsWith(p)));
  const chosen = operators.find((o) => o.code === operatorCode);
  if (!chosen || !chosen.active) return { ok: false, error: 'This mobile money operator is not available' };
  if (!detected) return { ok: false, msisdn: n.msisdn, error: 'This number does not match a supported mobile network' };
  if (detected.code !== chosen.code) {
    return {
      ok: false,
      msisdn: n.msisdn,
      detectedOperator: detected.code,
      error: `This looks like ${/^[AEIOU]/i.test(detected.name) ? 'an' : 'a'} ${detected.name} number, not ${chosen.name}`,
    };
  }
  return { ok: true, msisdn: n.msisdn, detectedOperator: detected.code };
}

export function validateRecipientName(name: string): string | null {
  const t = name.trim().replace(/\s+/g, ' ');
  if (t.length < 3) return 'Enter the recipient’s full name';
  if (t.length > 120) return 'Name is too long';
  if (!t.includes(' ')) return 'Enter first and last name, as registered with the mobile money account';
  if (!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(t)) return 'Name contains characters that are not allowed';
  return null;
}

/** Display mask for account numbers in lists and receipts: "+260 96 *** 4567". */
export function maskMsisdn(msisdn: string, dialCode: string): string {
  const national = msisdn.startsWith(dialCode) ? msisdn.slice(dialCode.length) : msisdn;
  if (national.length < 6) return `+${dialCode} ${national}`;
  return `+${dialCode} ${national.slice(0, 2)} *** ${national.slice(-4)}`;
}
