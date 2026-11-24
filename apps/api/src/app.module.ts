import { Controller, Get, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.controller';
import { BeneficiariesModule } from './beneficiaries/beneficiaries.module';
import { AuditModule } from './common/audit.service';
import { IdempotencyModule } from './common/idempotency.service';
import { JwtAuthGuard, Public } from './common/http';
import { env, isProduction } from './config/env';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { QuotesModule } from './quotes/quotes.module';
import { ReferenceDataModule } from './reference-data/reference-data.service';
import { SandboxModule } from './sandbox/sandbox.module';
import { TransfersModule } from './transfers/transfers.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', environment: env().NODE_ENV, sandboxProviders: env().SANDBOX_PROVIDERS_ENABLED };
  }
}

function sandboxModules(): DynamicModule[] {
  if (isProduction() || !env().SANDBOX_PROVIDERS_ENABLED) return [];
  return [{ module: SandboxModule }];
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    IdempotencyModule,
    AuthModule,
    ReferenceDataModule,
    QuotesModule,
    BeneficiariesModule,
    TransfersModule,
    WebhooksModule,
    ...sandboxModules(),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
