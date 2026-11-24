import { Controller, HttpCode, Injectable, Logger, Module, Param, Post, Req, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { sha256 } from '../common/crypto';
import { Public } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry, ProvidersModule } from '../providers/provider-registry.service';
import type { WebhookInput } from '../providers/provider.types';
import { TransferEngine } from '../transfers/transfer-engine.service';
import { TransfersModule } from '../transfers/transfers.module';

const SAFE_HEADERS = ['content-type', 'user-agent', 'x-request-id', 'x-ebk-sandbox-signature'];

@Injectable()
export class WebhookService {
  private readonly log = new Logger(WebhookService.name);
  constructor(private readonly prisma: PrismaService, private readonly registry: ProviderRegistry, private readonly engine: TransferEngine) {}

  /**
   * 1. verify signature  2. store (de-duplicated on provider+event id)  3. process.
   * Invalid signatures are stored as REJECTED for monitoring and answered 401.
   */
  async handle(providerCode: string, input: WebhookInput): Promise<{ status: string }> {
    const adapter = await this.registry.adapterForWebhook(providerCode);
    if (!adapter?.verifyWebhook || !adapter.parseWebhook) throw new UnauthorizedException();

    const headers = Object.fromEntries(SAFE_HEADERS.filter((h) => input.headers[h]).map((h) => [h, String(input.headers[h])]));
    const valid = adapter.verifyWebhook(input);
    if (!valid) {
      await this.prisma.providerWebhook
        .create({ data: { providerCode, eventId: `rejected:${sha256(input.rawBody)}`, signatureValid: false, headers, payload: { rawSha256: sha256(input.rawBody) }, status: 'REJECTED' } })
        .catch(() => undefined);
      this.log.warn(`Rejected webhook with invalid signature from ${providerCode}`);
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE' });
    }

    const ev = adapter.parseWebhook(input);
    let row;
    try {
      row = await this.prisma.providerWebhook.create({
        data: { providerCode, eventId: ev.eventId, eventType: ev.eventType, signatureValid: true, headers, payload: JSON.parse(input.rawBody.toString('utf8')) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { status: 'duplicate' };
      throw e;
    }

    try {
      const outcome = ev.kind === 'PAYOUT' ? await this.engine.onPayoutEvent(ev) : ev.kind === 'COLLECTION' ? await this.engine.onCollectionEvent(ev) : 'IGNORED';
      await this.prisma.providerWebhook.update({ where: { id: row.id }, data: { status: outcome, processedAt: new Date() } });
      return { status: outcome.toLowerCase() };
    } catch (e) {
      await this.prisma.providerWebhook.update({ where: { id: row.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 1000) } });
      throw e; // non-2xx → provider retries; event id de-dup keeps processing idempotent
    }
  }
}

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly svc: WebhookService) {}

  @Public()
  @HttpCode(200)
  @Post(':providerCode')
  receive(@Param('providerCode') providerCode: string, @Req() req: RawBodyRequest<Request>) {
    return this.svc.handle(providerCode, { headers: req.headers, rawBody: req.rawBody ?? Buffer.from('') });
  }
}

@Module({ imports: [ProvidersModule, TransfersModule], providers: [WebhookService], controllers: [WebhooksController], exports: [WebhookService] })
export class WebhooksModule {}
