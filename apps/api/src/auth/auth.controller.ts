import { Body, Controller, ForbiddenException, Get, HttpCode, Module, Post, Req, Res } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import type { Actor } from '../common/audit.service';
import { CurrentUser, Public, RequestActor, ZodPipe, type AuthUser } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, LoginSchema, RegisterSchema, type IssuedTokens, type RegisterInput } from './auth.service';

export const REFRESH_COOKIE = 'ebk_rt';
/** Custom header required on cookie-authenticated endpoints. Browsers cannot send it cross-site without a CORS preflight, which our CORS policy rejects. */
export const CSRF_HEADER = 'x-ebk-client';

function assertCsrfHeader(req: Request) {
  if (req.headers[CSRF_HEADER] !== 'web') {
    throw new ForbiddenException({ code: 'CSRF_CHECK_FAILED', message: 'Request blocked' });
  }
}

function setRefreshCookie(res: Response, t: IssuedTokens) {
  res.cookie(REFRESH_COOKIE, t.refreshToken, {
    httpOnly: true,
    secure: env().NODE_ENV !== 'development',
    sameSite: 'strict',
    path: '/api/auth',
    expires: t.refreshExpiresAt,
  });
}

const publicTokens = (t: IssuedTokens) => ({ accessToken: t.accessToken, expiresIn: t.accessTokenExpiresIn, tokenType: 'Bearer' });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new ZodPipe(RegisterSchema)) body: RegisterInput, @RequestActor() actor: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const t = await this.auth.register(body, actor);
    setRefreshCookie(res, t);
    return publicTokens(t);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new ZodPipe(LoginSchema)) body: { email: string; password: string }, @RequestActor() actor: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const t = await this.auth.login(body.email, body.password, actor);
    setRefreshCookie(res, t);
    return publicTokens(t);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @RequestActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const t = await this.auth.refresh(String(req.cookies?.[REFRESH_COOKIE] ?? ''), actor);
    setRefreshCookie(res, t);
    return publicTokens(t);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @RequestActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], actor);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } });
    return {
      id: u.id,
      email: u.email,
      phone: u.phone,
      emailVerified: !!u.emailVerifiedAt,
      phoneVerified: !!u.phoneVerifiedAt,
      mfaEnabled: u.mfaEnabled,
      status: u.status,
      profile: u.profile && {
        firstName: u.profile.firstName,
        lastName: u.profile.lastName,
        countryOfResidence: u.profile.countryOfResidence,
        kycStatus: u.profile.kycStatus,
      },
    };
  }
}

@Module({
  imports: [JwtModule.registerAsync({ global: true, useFactory: () => ({ secret: env().JWT_ACCESS_SECRET }) })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
