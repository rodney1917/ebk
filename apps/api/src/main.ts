import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadEnv } from './config/env';

// BigInt values must never be serialised implicitly; amounts are converted to strings explicitly.
(BigInt.prototype as unknown as { toJSON: () => never }).toJSON = function () {
  throw new Error('BigInt reached JSON serialisation — convert with money()/minorToDb()');
};

async function bootstrap() {
  const cfg = loadEnv(); // fail fast on invalid configuration
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });

  app.setGlobalPrefix('api');
  app.set('trust proxy', 1); // behind Nginx
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], styleSrc: ["'unsafe-inline'"], formAction: ["'self'"], frameAncestors: ["'none'"] } },
      hsts: cfg.NODE_ENV === 'production' ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '20kb' });
  app.enableCors({
    origin: [cfg.APP_ORIGIN],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-EBK-Client'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  app.enableShutdownHooks();

  if (cfg.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('EBK API')
        .setDescription('EBK — Empower. Bank. Connect. Customer API. Amounts are decimal strings; never floats.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  await app.listen(cfg.PORT);
  Logger.log(`EBK API listening on :${cfg.PORT} (${cfg.NODE_ENV}${cfg.SANDBOX_PROVIDERS_ENABLED ? ', SANDBOX providers enabled' : ''})`, 'Bootstrap');
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
