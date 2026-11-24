import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env';
import { AuditService, type Actor } from '../common/audit.service';
import {
  DUMMY_PASSWORD_HASH, hashPassword, needsRehash, passwordPolicyError, randomToken, sha256, verifyPassword,
} from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

export const RegisterSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    countryOfResidence: z.string().length(2).toUpperCase(),
    phone: z.string().trim().regex(/^\+?[0-9 ]{8,20}$/).optional(),
  })
  .superRefine((v, ctx) => {
    const err = passwordPolicyError(v.password, v.email);
    if (err) ctx.addIssue({ code: 'custom', path: ['password'], message: err });
  });
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string; // set as httpOnly cookie by the controller, never returned in JSON
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly audit: AuditService) {}

  async register(input: RegisterInput, actor: Actor) {
    const country = await this.prisma.country.findUnique({ where: { code: input.countryOfResidence } });
    if (!country?.active || !country.canSend) {
      throw new ForbiddenException({ code: 'COUNTRY_NOT_SUPPORTED', message: 'EBK is not yet available in your country of residence' });
    }
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } } });
    if (existing) throw new ConflictException({ code: 'EMAIL_IN_USE', message: 'An account with this email already exists' });

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone?.replace(/\s/g, ''),
          passwordHash: await hashPassword(input.password),
          profile: {
            create: {
              firstName: input.firstName,
              lastName: input.lastName,
              countryOfResidence: input.countryOfResidence,
              kycStatus: 'NOT_STARTED', // never auto-verified
            },
          },
        },
      });
      await this.audit.record({ ...actor, type: 'CUSTOMER', id: u.id }, 'auth.register', { type: 'user', id: u.id }, { after: { email: u.email } }, tx);
      return u;
    });
    // TODO(phase-2): send email verification link (users.email_verified_at).
    return this.issueTokens(user.id, user.email, actor);
  }

  async login(email: string, password: string, actor: Actor): Promise<IssuedTokens> {
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null } });
    if (!user) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH); // equalise timing
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException({ code: 'ACCOUNT_LOCKED', message: 'Too many attempts. Try again later or reset your password.' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
        },
      });
      await this.audit.record({ ...actor, type: 'CUSTOMER', id: user.id }, 'auth.login_failed', { type: 'user', id: user.id });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_NOT_ACTIVE', message: 'This account is not active. Please contact support.' });
    }
    // TODO(phase-2): if user.mfaEnabled, return an MFA challenge instead of tokens.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        passwordHash: needsRehash(user.passwordHash) ? await hashPassword(password) : undefined,
      },
    });
    await this.audit.record({ ...actor, type: 'CUSTOMER', id: user.id }, 'auth.login', { type: 'user', id: user.id });
    return this.issueTokens(user.id, user.email, actor);
  }

  /**
   * Refresh-token rotation with reuse detection: each refresh token is single-use.
   * Presenting an already-rotated token revokes the whole session family (token theft).
   */
  async refresh(refreshToken: string, actor: Actor): Promise<IssuedTokens> {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'Please sign in again' });
    if (session.revokedAt) {
      if (session.replacedById) {
        await this.prisma.userSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' },
        });
        await this.audit.record({ ...actor, type: 'CUSTOMER', id: session.userId }, 'auth.refresh_reuse_detected', { type: 'session', id: session.familyId });
      }
      throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'Please sign in again' });
    }
    if (session.expiresAt <= new Date() || session.user.status !== 'ACTIVE' || session.user.deletedAt) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Please sign in again' });
    }
    return this.issueTokens(session.userId, session.user.email, actor, session.familyId, session.id);
  }

  async logout(refreshToken: string | undefined, actor: Actor): Promise<void> {
    if (!refreshToken) return;
    const s = await this.prisma.userSession.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!s) return;
    await this.prisma.userSession.updateMany({
      where: { familyId: s.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
    await this.audit.record({ ...actor, type: 'CUSTOMER', id: s.userId }, 'auth.logout', { type: 'session', id: s.familyId });
  }

  private async issueTokens(userId: string, email: string, actor: Actor, familyId = randomUUID(), rotatedFromId?: string): Promise<IssuedTokens> {
    const cfg = env();
    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_DAYS * 86400_000);
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userSession.create({
        data: {
          userId,
          familyId,
          refreshTokenHash: sha256(refreshToken),
          userAgent: actor.userAgent?.slice(0, 300),
          ipAddress: actor.ip,
          expiresAt: refreshExpiresAt,
        },
      });
      if (rotatedFromId) {
        // Conditional update: if another request already rotated this token, this matches 0 rows.
        const res = await tx.userSession.updateMany({
          where: { id: rotatedFromId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'rotated', replacedById: created.id },
        });
        if (res.count !== 1) throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'Please sign in again' });
      }
      return created;
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, sid: session.id, typ: 'access' },
      { expiresIn: cfg.JWT_ACCESS_TTL_SECONDS, audience: 'ebk-customer', issuer: 'ebk-api' },
    );
    return { accessToken, accessTokenExpiresIn: cfg.JWT_ACCESS_TTL_SECONDS, refreshToken, refreshExpiresAt };
  }
}
