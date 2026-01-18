/**
 * JWT - Using jsonwebtoken package with refresh token support
 */

import jwt from 'jsonwebtoken';
import type { SignOptions, VerifyOptions } from 'jsonwebtoken';
import type { UserContext, JwtConfig, TokenPair } from '../types/index.js';
import { logger } from '../index.js';

// Custom payload with our fields
interface CustomJwtPayload {
  sub: string;
  tid: string;
  roles: string[];
  permissions: string[];
  type?: 'access' | 'refresh';
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

// Parse expiry string to seconds
function parseExpiry(exp: string): number {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return 3600; // default 1h
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(match[1]) * (mult[match[2]] || 3600);
}

/** Create access token */
export function createToken(user: UserContext, config: JwtConfig): string {
  const payload = {
    sub: user.userId,
    tid: user.tenantId,
    roles: user.roles,
    permissions: user.permissions,
    type: 'access' as const,
  };

  const options: SignOptions = {
    expiresIn: parseExpiry(config.expiresIn || '1h'),
    algorithm: 'HS256',
    ...(config.issuer && { issuer: config.issuer }),
    ...(config.audience && { audience: config.audience }),
  };

  return jwt.sign(payload, config.secret, options);
}

/** Create refresh token (longer lived, minimal payload) */
export function createRefreshToken(user: UserContext, config: JwtConfig): string {
  const payload = {
    sub: user.userId,
    tid: user.tenantId,
    roles: user.roles,
    permissions: user.permissions,
    type: 'refresh' as const,
  };

  const options: SignOptions = {
    expiresIn: parseExpiry(config.refreshExpiresIn || '7d'),
    algorithm: 'HS256',
    ...(config.issuer && { issuer: config.issuer }),
    ...(config.audience && { audience: config.audience }),
  };

  // Use separate secret for refresh tokens if provided
  const secret = config.refreshSecret || config.secret;
  return jwt.sign(payload, secret, options);
}

/** Create both access and refresh tokens */
export function createTokenPair(user: UserContext, config: JwtConfig): TokenPair {
  return {
    accessToken: createToken(user, config),
    refreshToken: createRefreshToken(user, config),
    expiresIn: parseExpiry(config.expiresIn || '1h'),
    refreshExpiresIn: parseExpiry(config.refreshExpiresIn || '7d'),
  };
}

/** Verify access token */
export function verifyToken(token: string, config: JwtConfig): UserContext | null {
  try {
    const options: VerifyOptions = {
      algorithms: ['HS256'],
      ...(config.issuer && { issuer: config.issuer }),
      ...(config.audience && { audience: config.audience }),
    };

    const payload = jwt.verify(token, config.secret, options) as CustomJwtPayload;

    // Ensure it's an access token
    if (payload.type && payload.type !== 'access') {
      logger?.warn('Token verification failed: not an access token', { type: payload.type });
      return null;
    }

    // Log token payload for debugging (only in development)
    if (process.env.NODE_ENV !== 'production') {
      logger?.info('JWT token verified', {
        userId: payload.sub,
        tenantId: payload.tid,
        roles: payload.roles || [],
        permissions: payload.permissions || [],
        rolesCount: (payload.roles || []).length,
        permissionsCount: (payload.permissions || []).length,
      });
    }

    return {
      userId: payload.sub,
      tenantId: payload.tid,
      roles: payload.roles || [],
      permissions: payload.permissions || [],
    };
  } catch (error) {
    return null;
  }
}

/** Verify refresh token */
export function verifyRefreshToken(token: string, config: JwtConfig): UserContext | null {
  try {
    const options: VerifyOptions = {
      algorithms: ['HS256'],
      ...(config.issuer && { issuer: config.issuer }),
      ...(config.audience && { audience: config.audience }),
    };

    const secret = config.refreshSecret || config.secret;
    const payload = jwt.verify(token, secret, options) as CustomJwtPayload;

    // Ensure it's a refresh token
    if (payload.type !== 'refresh') return null;

    return {
      userId: payload.sub,
      tenantId: payload.tid,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  } catch {
    return null;
  }
}

/** Refresh tokens - verify refresh token and issue new token pair */
export function refreshTokens(refreshToken: string, config: JwtConfig): TokenPair | null {
  const user = verifyRefreshToken(refreshToken, config);
  if (!user) return null;
  return createTokenPair(user, config);
}

/** Decode token without verification (for reading claims) */
export function decodeToken(token: string): CustomJwtPayload | null {
  return jwt.decode(token) as CustomJwtPayload | null;
}

/** Check if token is expired without full verification */
export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now();
}

/** Get token expiration date */
export function getTokenExpiration(token: string): Date | null {
  const payload = decodeToken(token);
  if (!payload?.exp) return null;
  return new Date(payload.exp * 1000);
}

/** Extract Bearer token from Authorization header */
export function extractToken(header: string | undefined): string | null {
  if (!header) return null;
  const [type, token] = header.split(' ');
  return type?.toLowerCase() === 'bearer' ? token || null : null;
}
