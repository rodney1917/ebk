/**
 * Human-friendly, unguessable transfer references: "EBK-7KQ4-M2XP-9C" style.
 * Crockford base32 (no I, L, O, U) + one mod-37 check character so that typos are
 * detected when a customer reads a reference to support staff.
 */

// Web Crypto is available in Node >= 20 and all supported browsers.
const webCrypto = (globalThis as unknown as { crypto: { getRandomValues<T extends Uint8Array>(a: T): T } }).crypto;
function randomBytes(n: number): Uint8Array {
  return webCrypto.getRandomValues(new Uint8Array(n));
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 chars
const CHECK_ALPHABET = ALPHABET + '*~$=U'; // 37 chars (Crockford check symbols)

function checkChar(body: string): string {
  let mod = 0;
  for (const ch of body) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`Invalid reference character: ${ch}`);
    mod = (mod * 32 + v) % 37;
  }
  return CHECK_ALPHABET[mod]!;
}

/** 10 random base32 chars = 50 bits of entropy. Uniqueness is also enforced in the DB. */
export function generateReference(prefix = 'EBK', bytes: Uint8Array = randomBytes(10)): string {
  let body = '';
  for (let i = 0; i < 10; i++) body += ALPHABET[bytes[i]! & 31];
  const c = checkChar(body);
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}${c}`;
}

export function normaliseReference(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[OI L]/g, (c) => (c === 'O' ? '0' : c === ' ' ? '' : '1'));
}

export function isValidReference(ref: string, prefix = 'EBK'): boolean {
  const m = new RegExp(`^${prefix}-([0-9A-Z]{4})-([0-9A-Z]{4})-([0-9A-Z]{2})(.)$`).exec(ref);
  if (!m) return false;
  const body = m[1]! + m[2]! + m[3]!;
  if ([...body].some((c) => !ALPHABET.includes(c))) return false;
  return checkChar(body) === m[4];
}
