/**
 * Default corridor configuration. This is SEED DATA, not runtime truth: the API
 * loads countries, operators, limits and fee rules from the database (seeded from
 * here), so adding a corridor is a configuration change, not a code change.
 */
import type { CountryPhoneConfig, MobileOperatorConfig, PayoutMethodType } from './beneficiary.js';
import type { FeeRule } from './quote.js';

export interface CountryConfig {
  code: string;
  name: string;
  currency: string;
  phone: CountryPhoneConfig;
  canSend: boolean;
  canReceive: boolean;
  payoutMethods: PayoutMethodType[];
  mobileOperators: MobileOperatorConfig[];
}

export interface CorridorConfig {
  id: string;
  sourceCountry: string;
  sourceCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  minSendMinor: bigint;
  maxSendMinor: bigint;
  quoteLockSeconds: number;
  active: boolean;
}

export const COUNTRIES: CountryConfig[] = [
  {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    phone: { countryCode: 'GB', dialCode: '44', nationalNumberLength: 10, trunkPrefix: '0' },
    canSend: true,
    canReceive: false,
    payoutMethods: [],
    mobileOperators: [],
  },
  {
    code: 'ZM',
    name: 'Zambia',
    currency: 'ZMW',
    phone: { countryCode: 'ZM', dialCode: '260', nationalNumberLength: 9, trunkPrefix: '0' },
    canSend: false,
    canReceive: true,
    payoutMethods: ['MOBILE_MONEY'],
    // Prefixes and per-transfer limits must be confirmed with each payout partner before go-live.
    // K10,000 is a conservative placeholder: published limits seen for inbound remittances vary
    // between K10,000 and K20,000 per transfer depending on network and provider.
    mobileOperators: [
      { code: 'MTN_ZM', name: 'MTN MoMo', prefixes: ['96', '76'], active: true, maxPayoutMinor: 1_000_000n },
      { code: 'AIRTEL_ZM', name: 'Airtel Money', prefixes: ['97', '77'], active: true, maxPayoutMinor: 1_000_000n },
      { code: 'ZAMTEL_ZM', name: 'Zamtel Kwacha', prefixes: ['95', '75'], active: false, maxPayoutMinor: 1_000_000n },
    ],
  },
];

export const CORRIDORS: CorridorConfig[] = [
  {
    id: 'GB-ZM',
    sourceCountry: 'GB',
    sourceCurrency: 'GBP',
    destinationCountry: 'ZM',
    destinationCurrency: 'ZMW',
    minSendMinor: 1_000n, // £10.00
    maxSendMinor: 200_000n, // £2,000.00 per transfer (pre-KYC-tier limits to be agreed with compliance)
    quoteLockSeconds: 600,
    active: true,
  },
];

/**
 * Placeholder fee schedule for development. Commercial pricing must be set by EBK
 * management before launch; these values exist only so the flow can be exercised.
 */
export const DEFAULT_FEE_RULES: FeeRule[] = [
  {
    id: 'gb-zm-mm-small',
    sourceCurrency: 'GBP',
    destinationCountry: 'ZM',
    payoutMethod: 'MOBILE_MONEY',
    minSendMinor: 0n,
    maxSendMinor: 9_999n,
    fixedFeeMinor: 199n,
    percentageBps: 0,
    priority: 10,
    active: true,
  },
  {
    id: 'gb-zm-mm-standard',
    sourceCurrency: 'GBP',
    destinationCountry: 'ZM',
    payoutMethod: 'MOBILE_MONEY',
    minSendMinor: 10_000n,
    maxSendMinor: null,
    fixedFeeMinor: 99n,
    percentageBps: 100,
    maxFeeMinor: 1_999n,
    priority: 10,
    active: true,
  },
];
