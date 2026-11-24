/**
 * End-to-end API test: register/login → beneficiary → quote → transfer → sandbox payment
 * webhook → payout → COMPLETED, plus idempotency and duplicate-webhook checks.
 *
 * Requires: a migrated + seeded test database (DATABASE_URL), SANDBOX_PROVIDERS_ENABLED=true.
 *   npm run test:e2e -w @ebk/api
 *
 * STATUS: written, not yet executed (initial build environment had no package registry access).
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { signSandboxPayload } from '../../src/providers/sandbox/sandbox-signing';
import { TransferEngine } from '../../src/transfers/transfer-engine.service';

describe('EBK transfer flow (e2e, sandbox)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  const client = { 'X-EBK-Client': 'web' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    const login = await request(app.getHttpServer()).post('/api/auth/login').set(client).send({ email: 'demo.sender@ebk.test', password: 'Sandbox-Demo-Only-2026' }).expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => app.close());

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/transfers').expect(401);
  });

  it('rejects a beneficiary whose number belongs to a different operator', async () => {
    const res = await request(app.getHttpServer()).post('/api/beneficiaries').set(auth())
      .send({ fullName: 'Mwila Banda', countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY', mobileOperatorCode: 'MTN_ZM', mobileNumber: '0971234567' }).expect(422);
    expect(res.body.detectedOperator).toBe('AIRTEL_ZM');
  });

  it('completes a sandbox transfer end to end, idempotently', async () => {
    const msisdn = `096${Math.floor(1000000 + Math.random() * 8000000)}`;
    const b = await request(app.getHttpServer()).post('/api/beneficiaries').set(auth())
      .send({ fullName: 'Mwila Banda', countryCode: 'ZM', payoutMethod: 'MOBILE_MONEY', mobileOperatorCode: 'MTN_ZM', mobileNumber: msisdn }).expect(201);

    const q = await request(app.getHttpServer()).post('/api/quotes').set(auth()).send({ corridorId: 'GB-ZM', payoutMethod: 'MOBILE_MONEY', sendAmount: '250.00' }).expect(201);
    expect(q.body.rate.kind).toBe('SANDBOX');
    expect(q.body.totalPayable).toEqual({ amount: '253.49', currency: 'GBP' });

    const key = randomUUID();
    const t1 = await request(app.getHttpServer()).post('/api/transfers').set(auth()).set('Idempotency-Key', key).send({ quoteId: q.body.id, beneficiaryId: b.body.id }).expect(201);
    const t2 = await request(app.getHttpServer()).post('/api/transfers').set(auth()).set('Idempotency-Key', key).send({ quoteId: q.body.id, beneficiaryId: b.body.id }).expect(201);
    expect(t2.headers['idempotent-replayed']).toBe('true');
    expect(t2.body.id).toBe(t1.body.id);

    const c = await request(app.getHttpServer()).post(`/api/transfers/${t1.body.id}/confirm`).set(auth()).set('Idempotency-Key', randomUUID()).expect(200);
    expect(c.body.sandbox).toBe(true);

    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { transferId: t1.body.id } });
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'collection.succeeded', data: { idempotencyKey: attempt.idempotencyKey, providerReference: `p_${randomUUID()}`, amountMinor: '25349', currency: 'GBP' } });
    const sig = signSandboxPayload(process.env.SANDBOX_WEBHOOK_SECRET!, body);
    await request(app.getHttpServer()).post('/api/webhooks/SANDBOX_COLLECT').set('Content-Type', 'application/json').set('X-EBK-Sandbox-Signature', sig).send(body).expect(200);
    const dup = await request(app.getHttpServer()).post('/api/webhooks/SANDBOX_COLLECT').set('Content-Type', 'application/json').set('X-EBK-Sandbox-Signature', sig).send(body).expect(200);
    expect(dup.body.status).toBe('duplicate');

    await new Promise((r) => setTimeout(r, 3200));
    await app.get(TransferEngine).pollPendingPayouts(0);
    const done = await request(app.getHttpServer()).get(`/api/transfers/${t1.body.id}`).set(auth()).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.timeline.map((s: { status: string }) => s.status)).toEqual(['DRAFT', 'PENDING_PAYMENT', 'PAYMENT_RECEIVED', 'PAYOUT_PROCESSING', 'COMPLETED']);

    const ledger = await prisma.ledgerEntry.findMany({ where: { transaction: { transferId: t1.body.id } } });
    expect(ledger).toHaveLength(7);
  });

  it('rejects webhooks with a bad signature', async () => {
    await request(app.getHttpServer()).post('/api/webhooks/SANDBOX_COLLECT').set('Content-Type', 'application/json').set('X-EBK-Sandbox-Signature', 't=1,v1=00').send('{}').expect(401);
  });
});
