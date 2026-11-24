import {
  BadRequestException, CanActivate, createParamDecorator, ExecutionContext, Injectable, PipeTransform,
  SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { ZodSchema } from 'zod';
import type { Actor } from './audit.service';

/** Validates request bodies / queries with zod. Unknown keys are stripped. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid',
        fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

export interface AuthUser {
  id: string;
  email: string;
  sessionId: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export const IS_PUBLIC = 'ebk:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; sid: string; typ: string }>(header.slice(7), {
        audience: 'ebk-customer',
        issuer: 'ebk-api',
      });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      req.user = { id: payload.sub, email: payload.email, sessionId: payload.sid };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_INVALID', message: 'Your session has expired' });
    }
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

export const RequestActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return {
    type: req.user ? 'CUSTOMER' : 'SYSTEM',
    id: req.user?.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
});

/** Requires an Idempotency-Key header (8–128 safe chars) for money-moving POSTs. */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const key = ctx.switchToHttp().getRequest<Request>().headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_\-:.]{8,128}$/.test(key)) {
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid Idempotency-Key header is required' });
  }
  return key;
});

export { Reflector };
