/**
 * Authentication Service
 * 
 * Simplified service that wraps Passport.js for authentication
 * and handles token/session management.
 * 
 * ALL authentication logic (password verification, account lockout, etc.)
 * is now handled by Passport strategies.
 */

import { getDatabase, logger, createTokenPair as coreCreateTokenPair } from 'core-service';
import type { UserContext } from 'core-service';
import type { LoginInput, User, AuthResponse, TokenPair, Session, RefreshToken, DeviceInfo } from '../types.js';
import { 
  parseUserAgent,
  generateDeviceId,
  generateRefreshToken,
  hashToken,
  addDays,
  addSeconds,
} from '../utils.js';
import type { AuthConfig } from '../types.js';
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
      
      // Authentication successful! Generate tokens and session
      const deviceInfo = this.extractDeviceInfo(input);
      const tokens = await this.createSessionAndTokens(user, deviceInfo);
      
      logger.info('User logged in via Passport', { 
        userId: user.id, 
        tenantId: user.tenantId 
      });
      
      // Normalize permissions (object → array) for GraphQL compatibility
      const normalizedUser = { ...user };
      if (normalizedUser.permissions && !Array.isArray(normalizedUser.permissions)) {
        normalizedUser.permissions = Object.keys(normalizedUser.permissions).filter(
          key => normalizedUser.permissions[key] === true
        );
      } else if (!normalizedUser.permissions) {
        normalizedUser.permissions = [];
      }
      
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
   */
  private async createSessionAndTokens(user: User, deviceInfo: DeviceInfo): Promise<TokenPair> {
    const db = getDatabase();
    const now = new Date();
    
    // Generate refresh token
    const refreshTokenValue = generateRefreshToken();
    const refreshTokenHash = await hashToken(refreshTokenValue);
    
    // Calculate expiry times (parse from config strings like '1h', '7d')
    const accessExpiresIn = this.parseExpiry(this.config.jwtExpiresIn);
    const refreshExpiresIn = this.parseExpiry(this.config.jwtRefreshExpiresIn);
    
    // Create refresh token record
    const refreshTokenId = crypto.randomUUID();
    const refreshToken: RefreshToken = {
      id: refreshTokenId,
      userId: user.id,
      tenantId: user.tenantId,
      token: refreshTokenValue,
      tokenHash: refreshTokenHash,
      deviceId: deviceInfo.deviceId,
      deviceInfo,
      createdAt: now,
      expiresAt: addSeconds(now, refreshExpiresIn),
      isValid: true,
    };
    
    await db.collection('refresh_tokens').insertOne(refreshToken);
    
    // Create session
    const session: Session = {
      id: crypto.randomUUID(),
      userId: user.id,
      tenantId: user.tenantId,
      refreshTokenId,
      deviceInfo,
      createdAt: now,
      expiresAt: addDays(now, this.config.sessionMaxAge),
      lastAccessedAt: now,
      isValid: true,
    };
    
    await db.collection('sessions').insertOne(session);
    
    // Generate JWT access token
    const userContext: UserContext = {
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      permissions: user.permissions,
    };
    
    const jwtTokens = coreCreateTokenPair(userContext, {
      secret: this.config.jwtSecret,
      refreshSecret: this.config.jwtRefreshSecret,
      expiresIn: this.config.jwtExpiresIn,
      refreshExpiresIn: this.config.jwtRefreshExpiresIn,
    });
    
    return {
      accessToken: jwtTokens.accessToken,
      refreshToken: refreshTokenValue, // Return our custom refresh token, not JWT
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
    const db = getDatabase();
    
    try {
      const refreshTokenHash = await hashToken(refreshTokenValue);
      
      // Find refresh token
      const refreshToken = await db.collection('refresh_tokens').findOne({
        tokenHash: refreshTokenHash,
        tenantId,
        isValid: true,
      }) as unknown as RefreshToken | null;
      
      if (!refreshToken) {
        return {
          success: false,
          message: 'Invalid refresh token',
        };
      }
      
      // Check if expired
      if (refreshToken.expiresAt < new Date()) {
        await db.collection('refresh_tokens').updateOne(
          { id: refreshToken.id },
          { $set: { isValid: false, revokedAt: new Date(), revokedReason: 'expired' } }
        );
        
        return {
          success: false,
          message: 'Refresh token expired',
        };
      }
      
      // Update last used
      await db.collection('refresh_tokens').updateOne(
        { id: refreshToken.id },
        { $set: { lastUsedAt: new Date() } }
      );
      
      // Get user
      const user = await db.collection('users').findOne({
        id: refreshToken.userId,
        tenantId,
      }) as unknown as User | null;
      
      if (!user || user.status !== 'active') {
        return {
          success: false,
          message: 'User not found or inactive',
        };
      }
      
      // Generate new access token
      const userContext: UserContext = {
        userId: user.id,
        tenantId: user.tenantId,
        roles: user.roles,
        permissions: user.permissions,
      };
      
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
          refreshToken: refreshTokenValue, // Keep same refresh token
          expiresIn: this.parseExpiry(this.config.jwtExpiresIn),
          refreshExpiresIn: this.parseExpiry(this.config.jwtRefreshExpiresIn),
        },
      };
    } catch (error) {
      logger.error('Token refresh error', { error });
      return {
        success: false,
        message: 'Failed to refresh token',
      };
    }
  }
  
  /**
   * Logout user (invalidate session and refresh token)
   */
  async logout(userId: string, refreshTokenValue: string): Promise<{ success: boolean }> {
    const db = getDatabase();
    
    try {
      const refreshTokenHash = await hashToken(refreshTokenValue);
      
      // Invalidate refresh token
      await db.collection('refresh_tokens').updateOne(
        { tokenHash: refreshTokenHash, userId },
        { $set: { isValid: false, revokedAt: new Date(), revokedReason: 'logout' } }
      );
      
      // Invalidate session
      const refreshToken = await db.collection('refresh_tokens').findOne({
        tokenHash: refreshTokenHash,
        userId,
      }) as unknown as RefreshToken | null;
      
      if (refreshToken) {
        await db.collection('sessions').updateOne(
          { refreshTokenId: refreshToken.id },
          { $set: { isValid: false, invalidatedAt: new Date(), invalidatedReason: 'logout' } }
        );
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
  async logoutAll(userId: string): Promise<{ success: boolean; count: number }> {
    const db = getDatabase();
    
    try {
      // Invalidate all refresh tokens
      const result = await db.collection('refresh_tokens').updateMany(
        { userId, isValid: true },
        { $set: { isValid: false, revokedAt: new Date(), revokedReason: 'logout_all' } }
      );
      
      // Invalidate all sessions
      await db.collection('sessions').updateMany(
        { userId, isValid: true },
        { $set: { isValid: false, invalidatedAt: new Date(), invalidatedReason: 'logout_all' } }
      );
      
      logger.info('User logged out from all devices', { userId, count: result.modifiedCount });
      
      return { success: true, count: result.modifiedCount || 0 };
    } catch (error) {
      logger.error('Logout all error', { error, userId });
      return { success: false, count: 0 };
    }
  }
}
