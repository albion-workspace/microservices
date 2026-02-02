/**
 * Authentication Service
 * 
 * Simplified service that wraps Passport.js for authentication
 * and handles token/session management.
 * 
 * ALL authentication logic (password verification, account lockout, etc.)
 * is now handled by Passport strategies.
 */

import { 
  logger, 
  createTokenPair as coreCreateTokenPair,
  findById,
  normalizeDocument,
} from 'core-service';
import { db } from '../database.js';
import type { UserContext } from 'core-service';
import type { LoginInput, User, AuthResponse, TokenPair, Session, DeviceInfo } from '../types.js';
import { 
  parseUserAgent,
  generateDeviceId,
  hashToken,
  createUserContext,
  ensureUserId,
  normalizeUser,
} from '../utils.js';
import {
  findExistingSession,
  createSession,
  updateSessionForReuse,
  invalidateSessionByToken,
  invalidateAllUserSessions,
  updateSessionLastUsed,
} from '../utils/session-utils.js';
import type { AuthConfig } from '../config.js';
import { authenticateLocal } from '../providers/passport-strategies.js';

export class AuthenticationService {
  constructor(private config: AuthConfig) {}
  
  /**
   * Authenticate user with username/email/phone + password
   * 
   * Uses Passport.js LocalStrategy for ALL authentication logic.
   * This service only handles token/session generation.
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    try {
      // Let Passport handle ALL authentication logic
      const { user, info } = await authenticateLocal({
        identifier: input.identifier,
        password: input.password,
        tenantId: input.tenantId,
        twoFactorCode: input.twoFactorCode,
      });
      
      // If Passport returns null/false, authentication failed
      if (!user) {
        return {
          success: false,
          message: info?.message || 'Authentication failed: invalid credentials',
        };
      }
      
      // Ensure user has _id (should always be present from MongoDB)
      if (!user._id) {
        logger.error('User object missing _id field after Passport authentication', {
          userId: user.id,
          email: user.email,
          identifier: input.identifier,
        });
        return {
          success: false,
          message: 'Authentication failed: invalid user data',
        };
      }
      
      // Ensure id matches _id.toString() for consistency
      if (user.id !== user._id.toString()) {
        user.id = user._id.toString();
      }
      
      // Refresh user roles/permissions from database if needed
      if (user.email) {
        try {
          const database = await db.getDb();
          const dbUser = await database.collection('users').findOne({ _id: user._id }) as any;
          
          if (dbUser) {
            user.roles = dbUser.roles || user.roles;
            user.permissions = dbUser.permissions || user.permissions;
          }
        } catch (dbError: any) {
          logger.error('Error refreshing user roles/permissions', {
            error: dbError.message,
            userId: user.id,
          });
        }
      }
      
      // If authentication failed
      if (!user) {
        return {
          success: false,
          message: info?.message || 'Authentication failed',
          requiresOTP: info?.requires2FA || false,
        };
      }
      
      // CRITICAL: Double-check 2FA before generating tokens
      // This is a safety check in case passport strategy didn't catch it
      const twoFactorEnabledValue: any = user.twoFactorEnabled;
      const isTwoFactorEnabled = twoFactorEnabledValue === true || String(twoFactorEnabledValue) === 'true' || Number(twoFactorEnabledValue) === 1;
      
      if (isTwoFactorEnabled && !input.twoFactorCode) {
        return {
          success: false,
          message: 'Two-factor authentication code required',
          requiresOTP: true,
        };
      }
      
      // Log what Passport found - CRITICAL for debugging
      logger.info('User authenticated by Passport', {
        userId: user.id,
        _id: (user as any)._id, // MongoDB _id if present
        email: user.email,
        tenantId: user.tenantId,
        roles: user.roles,
        permissions: user.permissions,
        identifier: input.identifier,
        userObjectKeys: Object.keys(user),
      });
      
      // CRITICAL: Verify user.id exists and is valid (not a random UUID or _id)
      if (!user.id || typeof user.id !== 'string') {
        logger.error('User object missing or invalid id field', {
          userId: user.id,
          _id: (user as any)._id,
          email: user.email,
          identifier: input.identifier,
        });
        return {
          success: false,
          message: 'Authentication failed: invalid user ID',
        };
      }
      
      // CRITICAL: If logging in with email, verify the user email matches
      // This prevents token creation with wrong user if Passport finds wrong user
      if (input.identifier.includes('@')) {
        const normalizedIdentifier = input.identifier.toLowerCase().trim();
        const normalizedUserEmail = user.email?.toLowerCase().trim();
        if (normalizedUserEmail !== normalizedIdentifier) {
          logger.error('User email mismatch during login', {
            identifier: input.identifier,
            userEmail: user.email,
            userId: user.id,
          });
          return {
            success: false,
            message: 'Authentication failed: user email mismatch',
          };
        }
      }
      
      // CRITICAL: Activate pending users on first successful login
      // Users created via registration verification start with status 'pending'
      // This ensures they cannot perform operations until they log in at least once
      if (user.status === 'pending') {
        const database = await db.getDb();
        await database.collection('users').updateOne(
          { _id: user._id },
          {
            $set: {
              status: 'active',
              updatedAt: new Date(),
            },
          }
        );
        user.status = 'active';
        logger.info('User activated on first login', {
          userId: user.id,
          tenantId: user.tenantId,
        });
      }
      
      // Authentication successful! Generate tokens and session
      const deviceInfo = this.extractDeviceInfo(input);
      const tokens = await this.createSessionAndTokens(user, deviceInfo);
      
      logger.info('User logged in via Passport', { 
        userId: user.id, 
        tenantId: user.tenantId,
        status: user.status,
      });
      
      // Normalize user for GraphQL compatibility (roles and permissions)
      const normalizedUser = normalizeUser(user);
      
      return {
        success: true,
        message: 'Login successful',
        user: normalizedUser,
        tokens,
      };
      
    } catch (error) {
      logger.error('Login error', { error });
      return {
        success: false,
        message: 'An error occurred during login',
      };
    }
  }
  
  /**
   * Extract device info from request
   */
  private extractDeviceInfo(input: LoginInput): DeviceInfo {
    const parsed = parseUserAgent(input.userAgent);
    
    return {
      deviceId: input.deviceId || generateDeviceId(input.userAgent, input.ipAddress),
      deviceType: parsed.deviceType,
      os: parsed.os,
      browser: parsed.browser,
    };
  }
  
  /**
   * Create session and generate tokens
   * Simple flow: Use the user object from Passport directly
   * If roles/permissions need updating, user should refresh token or log out/in
   */
  async createSessionAndTokens(user: User, deviceInfo: DeviceInfo): Promise<TokenPair> {
    // Ensure user has valid ID
    const userId = ensureUserId(user as User & { _id?: any });
    
    // Calculate expiry times
    const accessExpiresIn = this.parseExpiry(this.config.jwtExpiresIn);
    const refreshExpiresIn = this.parseExpiry(this.config.jwtRefreshExpiresIn ?? '7d');
    const sessionMaxAgeSeconds = this.config.sessionMaxAge * 24 * 60 * 60;
    
    // Ensure deviceId exists
    if (!deviceInfo.deviceId) {
      deviceInfo.deviceId = generateDeviceId('', '');
    }
    
    // Smart token reuse: Check for existing valid session for this device
    const existingSession = await findExistingSession(userId, user.tenantId, deviceInfo.deviceId);
    
    let refreshTokenValue: string;
    
    if (existingSession) {
      // Reuse existing session - rotate refresh token for security
      logger.info('Reusing existing session for device (rotating refresh token)', {
        userId,
        deviceId: deviceInfo.deviceId,
        sessionId: existingSession.id,
      });
      
      refreshTokenValue = await updateSessionForReuse(existingSession, deviceInfo, refreshExpiresIn);
    } else {
      // Create new session
      logger.info('Creating new session', {
        userId,
        email: user.email,
        tenantId: user.tenantId,
        deviceId: deviceInfo.deviceId,
      });
      
      const sessionResult = await createSession(
        userId,
        user.tenantId,
        deviceInfo.deviceId,
        deviceInfo,
        refreshExpiresIn,
        sessionMaxAgeSeconds
      );
      
      refreshTokenValue = sessionResult.refreshToken;
    }
    
    // Create UserContext using reusable utility
    const userContext = createUserContext(user);
    
    // Generate JWT access token
    const jwtTokens = coreCreateTokenPair(userContext, {
      secret: this.config.jwtSecret,
      refreshSecret: this.config.jwtRefreshSecret,
      expiresIn: this.config.jwtExpiresIn,
      refreshExpiresIn: this.config.jwtRefreshExpiresIn,
    });
    
    return {
      accessToken: jwtTokens.accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: accessExpiresIn,
      refreshExpiresIn,
    };
  }
  
  /**
   * Parse expiry string to seconds (e.g., '1h' -> 3600)
   */
  private parseExpiry(exp: string): number {
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // default 1h
    const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(match[1]) * (mult[match[2]] || 3600);
  }
  
  /**
   * Refresh access token
   */
  async refreshToken(refreshTokenValue: string, tenantId: string): Promise<AuthResponse> {
    const database = await db.getDb();
    
    try {
      const refreshTokenHash = await hashToken(refreshTokenValue);
      const now = new Date();
      
      // Find session by token hash (unified collection)
      const session = await database.collection('sessions').findOne({
        tokenHash: refreshTokenHash,
        tenantId,
        isValid: true,
      }) as unknown as Session | null;
      
      if (!session) {
        logger.error('Session not found for refresh token', {
          tokenHash: refreshTokenHash.substring(0, 10) + '...',
          tenantId,
        });
        return {
          success: false,
          message: 'Invalid refresh token',
        };
      }
      
      const normalizedSession = normalizeDocument(session);
      if (!normalizedSession) {
        return {
          success: false,
          message: 'Invalid session data',
        };
      }
      
      logger.info('Session found for token refresh', {
        sessionId: normalizedSession.id,
        userId: normalizedSession.userId,
        tenantId,
      });
      
      // Check if refresh token expired
      if (normalizedSession.refreshTokenExpiresAt < now) {
        await database.collection('sessions').updateOne(
          { _id: (session as any)._id },
          { $set: { isValid: false, revokedAt: now, revokedReason: 'expired' } }
        );
        
        return {
          success: false,
          message: 'Refresh token expired',
        };
      }
      
      // Check if session expired
      if (normalizedSession.sessionExpiresAt < now) {
        await database.collection('sessions').updateOne(
          { _id: (session as any)._id },
          { $set: { isValid: false, revokedAt: now, revokedReason: 'session_expired' } }
        );
        
        return {
          success: false,
          message: 'Session expired',
        };
      }
      
      // Update last used timestamp
      await updateSessionLastUsed(normalizedSession);
      
      // Get user
      const user = await findById<User>(database.collection('users'), normalizedSession.userId, { tenantId });
      
      if (!user) {
        logger.error('User not found during token refresh', {
          userId: normalizedSession.userId,
          tenantId,
        });
        return {
          success: false,
          message: 'User not found or inactive',
        };
      }
      
      const normalizedUser = normalizeDocument(user);
      
      if (!normalizedUser || normalizedUser.status !== 'active') {
        return {
          success: false,
          message: 'User not found or inactive',
        };
      }
      
      if (!normalizedUser.id) {
        logger.error('User missing id field after refresh token lookup', {
          userId: normalizedSession.userId,
        });
        return {
          success: false,
          message: 'User ID is required for token refresh',
        };
      }
      
      // Create UserContext using reusable utility
      const userContext = createUserContext(normalizedUser);
      
      const jwtTokens = coreCreateTokenPair(userContext, {
        secret: this.config.jwtSecret,
        refreshSecret: this.config.jwtRefreshSecret,
        expiresIn: this.config.jwtExpiresIn,
        refreshExpiresIn: this.config.jwtRefreshExpiresIn,
      });
      
      return {
        success: true,
        message: 'Token refreshed',
        tokens: {
          accessToken: jwtTokens.accessToken,
          refreshToken: refreshTokenValue, // Return same refresh token
          expiresIn: this.parseExpiry(this.config.jwtExpiresIn),
          refreshExpiresIn: this.parseExpiry(this.config.jwtRefreshExpiresIn ?? '7d'),
        },
      };
    } catch (error: any) {
      logger.error('Token refresh error', { 
        error: error.message,
        stack: error.stack,
      });
      return {
        success: false,
        message: `Failed to refresh token: ${error.message || 'Unknown error'}`,
      };
    }
  }
  
  /**
   * Logout user (invalidate session)
   */
  async logout(userId: string, refreshTokenValue: string): Promise<{ success: boolean }> {
    try {
      const refreshTokenHash = await hashToken(refreshTokenValue);
      const success = await invalidateSessionByToken(refreshTokenHash, userId, 'logout');
      
      if (!success) {
        logger.warn('Session not found for logout', { userId, tokenHash: refreshTokenHash.substring(0, 10) + '...' });
      }
      
      logger.info('User logged out', { userId });
      return { success: true };
    } catch (error) {
      logger.error('Logout error', { error, userId });
      return { success: false };
    }
  }
  
  /**
   * Logout from all devices
   */
  async logoutAll(userId: string, tenantId: string): Promise<{ success: boolean; count: number }> {
    try {
      const count = await invalidateAllUserSessions(userId, tenantId, 'logout_all');
      logger.info('User logged out from all devices', { userId, tenantId, count });
      return { success: true, count };
    } catch (error) {
      logger.error('Logout all error', { error, userId, tenantId });
      return { success: false, count: 0 };
    }
  }
  
  /**
   * Cleanup expired and invalid sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const database = await db.getDb();
    const now = new Date();
    
    try {
      // Delete expired sessions (refresh token or session expired)
      const expiredResult = await database.collection('sessions').deleteMany({
        $or: [
          { refreshTokenExpiresAt: { $lt: now } },
          { sessionExpiresAt: { $lt: now } },
        ],
      });
      
      // Delete invalid sessions older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const invalidResult = await database.collection('sessions').deleteMany({
        isValid: false,
        revokedAt: { $lt: thirtyDaysAgo },
      });
      
      const totalDeleted = (expiredResult.deletedCount || 0) + (invalidResult.deletedCount || 0);
      
      if (totalDeleted > 0) {
        logger.info('Cleaned up expired/invalid sessions', {
          expired: expiredResult.deletedCount || 0,
          invalid: invalidResult.deletedCount || 0,
          total: totalDeleted,
        });
      }
      
      return totalDeleted;
    } catch (error) {
      logger.error('Failed to cleanup sessions', { error });
      return 0;
    }
  }
}
