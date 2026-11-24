/** API contract types (mirror the DTOs in apps/api). Amounts are decimal strings. */
import type { TransferStatus } from '@ebk/core';

export type { TransferStatus };
export type RateKind = 'LIVE' | 'ESTIMATED' | 'SANDBOX';
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'IN_REVIEW' | 'VERIFIED' | 'REJECTED' | 'RESUBMISSION_REQUIRED';

export interface Money {
  amount: string;
  currency: string;
}

export interface Me {
  id: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  profile: { firstName: string; lastName: string; countryOfResidence: string; kycStatus: KycStatus } | null;
}

export interface Corridor {
  id: string;
  source: { country: string; currency: string };
  destination: { country: string; currency: string; name?: string; dialCode?: string };
  limits: { min: string; max: string };
  payoutMethods: string[];
  mobileOperators: { code: string; name: string }[];
}

export interface QuoteDto {
  id: string | null;
  locked: boolean;
  expiresAt: string | null;
  sendAmount: Money;
  fee: Money;
  totalPayable: Money;
  recipientAmount: Money;
  rate: { value: string; kind: RateKind; source: string; fetchedAt: string };
  payoutMethod: string;
}

export interface Beneficiary {
  id: string;
  fullName: string;
  nickname: string | null;
  countryCode: string;
  payoutMethod: 'MOBILE_MONEY' | 'BANK_ACCOUNT';
  mobileOperator: { code: string; name: string } | null;
  mobileNumberMasked: string | null;
  mobileNumber: string | null;
  createdAt: string;
}

export interface BeneficiaryInput {
  fullName: string;
  nickname?: string;
  countryCode: string;
  payoutMethod: 'MOBILE_MONEY';
  mobileOperatorCode: string;
  mobileNumber: string;
}

export interface TransferDto {
  id: string;
  reference: string;
  status: TransferStatus;
  statusLabel: string;
  statusTone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  sendAmount: Money;
  fee: Money;
  totalPayable: Money;
  recipientAmount: Money;
  exchangeRate: { value: string; kind: RateKind };
  payoutMethod: string;
  recipient: { fullName: string; network: string | null; accountMasked: string | null; country: string };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  timeline: { status: TransferStatus; label: string; at: string }[];
  payment?: { status: string; checkoutUrl: string | null } | null;
}

export interface ReceiptDto extends TransferDto {
  issuer: { name: string; note: string };
  sender: { name: string; email: string };
  paymentMethod: string | null;
  payoutMethodName: string | null;
  isSandbox: boolean;
  generatedAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  code?: string;
  message?: string | string[];
  fields?: { path: string; message: string }[];
  detectedOperator?: string;
}
