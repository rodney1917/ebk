/**
 * Webhook signing used by the EBK sandbox adapters. Mirrors the scheme most PSPs use
 * (timestamped HMAC-SHA256) so the webhook pipeline is exercised realistically.
 *
 *   X-EBK-Sandbox-Signature: t=<unix seconds>,v1=<hex hmac of "<t>.<raw body>">
 */
import { hmacSha256, safeEqual } from '../../common/crypto';

export const SANDBOX_SIGNATURE_HEADER = 'x-ebk-sandbox-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signSandboxPayload(secret: string, rawBody: string | Buffer, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  return `t=${nowSeconds},v1=${hmacSha256(secret, `${nowSeconds}.${body}`)}`;
}

export function verifySandboxSignature(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1) return false;
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false; // replay protection
  const expected = hmacSha256(secret, `${t}.${rawBody.toString('utf8')}`);
  return safeEqual(expected, v1);
}
