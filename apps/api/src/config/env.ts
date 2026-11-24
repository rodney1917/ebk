import { z } from 'zod';

/**
 * Environment configuration, validated at boot. The app refuses to start with an
 * invalid or unsafe configuration (e.g. sandbox providers enabled in production).
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    /** Bind address. 0.0.0.0 inside Docker; 127.0.0.1 when running directly on a server. */
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().url(),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(14),

    /** 32-byte key, base64. Used for AES-256-GCM field encryption (bank account numbers, document numbers, MFA secrets). */
    FIELD_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),

    /** Explicit opt-in for the clearly-labelled sandbox adapters. Forbidden in production. */
    SANDBOX_PROVIDERS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SANDBOX_WEBHOOK_SECRET: z.string().min(16).optional(),

    MTN_MOMO_BASE_URL: z.string().url().default('https://sandbox.momodeveloper.mtn.com'),
    MTN_MOMO_TARGET_ENVIRONMENT: z.string().default('sandbox'),
    MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY: z.string().optional(),
    MTN_MOMO_DISBURSEMENT_API_USER: z.string().optional(),
    MTN_MOMO_DISBURSEMENT_API_KEY: z.string().optional(),
    MTN_MOMO_CALLBACK_SECRET: z.string().optional(),

    /** Flutterwave v3. Test keys start FLWSECK_TEST- and never move real money. */
    FLW_BASE_URL: z.string().url().default('https://api.flutterwave.com'),
    FLW_SECRET_KEY: z.string().optional(),
    /** The "Secret hash" set in Flutterwave dashboard → Settings → Webhooks (sent back as verif-hash). */
    FLW_WEBHOOK_SECRET_HASH: z.string().min(16).optional(),

    COMPLIANCE_REVIEW_THRESHOLD_GBP: z.string().regex(/^\d+(\.\d{1,2})?$/).default('1000.00'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SANDBOX_PROVIDERS_ENABLED) {
      ctx.addIssue({ code: 'custom', path: ['SANDBOX_PROVIDERS_ENABLED'], message: 'Sandbox providers must never be enabled in production' });
    }
    if (env.SANDBOX_PROVIDERS_ENABLED && !env.SANDBOX_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['SANDBOX_WEBHOOK_SECRET'], message: 'Required when sandbox providers are enabled' });
    }
    if (env.NODE_ENV === 'production' && env.FLW_SECRET_KEY?.startsWith('FLWSECK_TEST')) {
      ctx.addIssue({ code: 'custom', path: ['FLW_SECRET_KEY'], message: 'Production cannot use a Flutterwave test key' });
    }
    if (env.FLW_SECRET_KEY && !env.FLW_WEBHOOK_SECRET_HASH) {
      ctx.addIssue({ code: 'custom', path: ['FLW_WEBHOOK_SECRET_HASH'], message: 'Required when FLW_SECRET_KEY is set (Flutterwave dashboard → Settings → Webhooks)' });
    }
    if (env.NODE_ENV === 'production' && env.MTN_MOMO_TARGET_ENVIRONMENT === 'sandbox') {
      ctx.addIssue({ code: 'custom', path: ['MTN_MOMO_TARGET_ENVIRONMENT'], message: 'Production cannot target the MTN sandbox' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Empty values in .env (e.g. `FLW_SECRET_KEY=`) mean "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid EBK configuration:\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export const isProduction = () => env().NODE_ENV === 'production';
