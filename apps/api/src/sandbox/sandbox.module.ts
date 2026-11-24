/**
 * ============================  SANDBOX ONLY  ============================
 * A stand-in for a payment partner's hosted checkout page, so the full
 * customer journey can be tested end to end without real money.
 * This module is only imported when NODE_ENV !== 'production' AND
 * SANDBOX_PROVIDERS_ENABLED=true (see app.module.ts). No card data is collected.
 * =========================================================================
 */
import { Body, Controller, Get, Header, Module, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dbToMinor } from '../common/amounts';
import { Public, ZodPipe } from '../common/http';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { signSandboxPayload, SANDBOX_SIGNATURE_HEADER } from '../providers/sandbox/sandbox-signing';
import type { SandboxCollectionWebhookBody } from '../providers/sandbox/sandbox.adapters';
import { WebhookService, WebhooksModule } from '../webhooks/webhooks.module';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@ApiExcludeController()
@Controller('sandbox/checkout')
export class SandboxCheckoutController {
  constructor(private readonly prisma: PrismaService, private readonly webhooks: WebhookService) {}

  @Public()
  @Get(':key')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async page(@Param('key') key: string) {
    const a = await this.prisma.paymentAttempt.findUnique({ where: { idempotencyKey: key }, include: { transfer: true } });
    if (!a) throw new NotFoundException();
    const amount = `${a.currency} ${a.amount.toFixed(2)}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EBK Sandbox Checkout</title>
<style>body{font-family:system-ui,sans-serif;background:#F5F8F7;color:#172B35;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;border-radius:16px;padding:28px;max-width:420px;box-shadow:0 8px 30px rgba(16,42,53,.08)}
.b{background:#FEF3C7;color:#92400E;border-radius:8px;padding:10px 12px;font-weight:600;font-size:14px}
button{width:100%;padding:14px;border-radius:10px;border:0;font-size:16px;font-weight:600;margin-top:10px;cursor:pointer}
.ok{background:#16866C;color:#fff}.no{background:#fff;color:#B42318;border:1px solid #F3C1BC}</style></head>
<body><div class="c"><div class="b">SANDBOX — test environment. No real money moves.</div>
<h2>Simulated payment</h2><p>Transfer <strong>${esc(a.transfer.reference)}</strong><br>Amount <strong>${esc(amount)}</strong></p>
<form method="post" action="./${esc(encodeURIComponent(key))}/complete"><input type="hidden" name="outcome" value="succeeded"><button class="ok">Simulate successful payment</button></form>
<form method="post" action="./${esc(encodeURIComponent(key))}/complete"><input type="hidden" name="outcome" value="failed"><button class="no">Simulate declined payment</button></form>
</div></body></html>`;
  }

  /** Builds a webhook exactly as a PSP would, signs it, and feeds it through the real webhook pipeline. */
  @Public()
  @Post(':key/complete')
  async complete(@Param('key') key: string, @Body(new ZodPipe(z.object({ outcome: z.enum(['succeeded', 'failed']) }))) body: { outcome: 'succeeded' | 'failed' }, @Res() res: Response) {
    const a = await this.prisma.paymentAttempt.findUnique({ where: { idempotencyKey: key }, include: { provider: true } });
    if (!a) throw new NotFoundException();
    const payload: SandboxCollectionWebhookBody = {
      id: `evt_${randomUUID()}`,
      type: body.outcome === 'succeeded' ? 'collection.succeeded' : 'collection.failed',
      data: {
        idempotencyKey: a.idempotencyKey,
        providerReference: a.providerReference ?? `sbx_col_${a.idempotencyKey.slice(-12)}`,
        amountMinor: dbToMinor(a.amount, a.currency).toString(),
        currency: a.currency,
        failureCode: body.outcome === 'failed' ? 'CARD_DECLINED' : undefined,
      },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    await this.webhooks.handle(a.provider.code, {
      headers: { [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(env().SANDBOX_WEBHOOK_SECRET!, raw), 'content-type': 'application/json' },
      rawBody: raw,
    });
    res.redirect(303, `${env().APP_ORIGIN}/transfers/${a.transferId}`);
  }
}

@Module({ imports: [WebhooksModule], controllers: [SandboxCheckoutController] })
export class SandboxModule {}
