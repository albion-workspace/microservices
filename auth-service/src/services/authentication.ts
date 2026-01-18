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
      
      if (!user || !user._id) {
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
          const db = getDatabase();
          const dbUser = await db.collection('users').findOne({ _id: user._id }) as any;
          
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
        const permissionsObj = normalizedUser.permissions as Record<string, boolean>;
        normalizedUser.permissions = Object.keys(permissionsObj).filter(
          key => permissionsObj[key] === true
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
   * Simple flow: Use the user object from Passport directly
   * If roles/permissions need updating, user should refresh token or log out/in
   */
  private async createSessionAndTokens(user: User, deviceInfo: DeviceInfo): Promise<TokenPair> {
    const db = getDatabase();
    const now = new Date();
    
    // Extract roles and permissions from UserRole[] format
    let roles: string[] = [];
    let permissions: string[] = [];
    
    // Handle roles - extract role names from UserRole[] format
    if (user.roles !== undefined && user.roles !== null && Array.isArray(user.roles)) {
      roles = user.roles
        .filter((r: any) => {
          // Handle both UserRole objects and string arrays
          if (typeof r === 'string') return true;
          return r.active !== false;
        })
        .filter((r: any) => {
          if (typeof r === 'string') return true;
          return !r.expiresAt || new Date(r.expiresAt) > new Date();
        })
        .map((r: any) => {
          // Handle both UserRole objects and string arrays
          if (typeof r === 'string') return r;
          return r.role;
        })
        .filter((r: any) => r !== undefined && r !== null); // Remove any undefined/null values
    }
    
    // Handle permissions - check if it exists (empty array is valid)
    if (user.permissions !== undefined && user.permissions !== null) {
      if (Array.isArray(user.permissions)) {
        permissions = user.permissions;
      } else if (typeof user.permissions === 'object' && !Array.isArray(user.permissions)) {
        // Convert object format { "permission1": true, "permission2": false } to array
        const permissionsObj = user.permissions as Record<string, boolean>;
        permissions = Object.keys(permissionsObj).filter(
          key => permissionsObj[key] === true
        );
      }
    }
    
    // Log for debugging
    logger.info('Creating JWT token with roles and permissions', {
      userId: user.id,
      email: user.email,
      roles,
      permissions,
      rolesCount: roles.length,
      permissionsCount: permissions.length,
      rawRoles: user.roles,
      rawRolesType: Array.isArray(user.roles) ? 'array' : typeof user.roles,
      rawRolesLength: Array.isArray(user.roles) ? user.roles.length : 0,
      rawRolesSample: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles[0] : null,
    });
    
    // Generate refresh token
    const refreshTokenValue = generateRefreshToken();
    const refreshTokenHash = await hashToken(refreshTokenValue);
    
    // Calculate expiry times (parse from config strings like '1h', '7d')
    const accessExpiresIn = this.parseExpiry(this.config.jwtExpiresIn);
    const refreshExpiresIn = this.parseExpiry(this.config.jwtRefreshExpiresIn);
    
    // Create refresh token record
    const refreshTokenId = crypto.randomUUID();
    // Ensure user.id is defined (should be guaranteed by checks above)
    if (!user.id) {
      // Try to get id from _id if not set
      if ((user as any)._id) {
        user.id = (user as any)._id.toString();
        logger.warn('User.id was missing, derived from _id', { 
          userId: user.id,
          _id: (user as any)._id.toString(),
        });
      } else {
        throw new Error('User ID is required for token creation');
      }
    }
    
    logger.info('Creating refresh token', {
      userId: user.id,
      user_id: (user as any)._id?.toString(),
      email: user.email,
      tenantId: user.tenantId,
    });
    
    const refreshToken: RefreshToken = {
      id: refreshTokenId,
      userId: user.id, // This should be _id.toString()
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
    // Ensure user.id is defined (should be guaranteed by checks above)
    if (!user.id) {
      throw new Error('User ID is required for session creation');
    }
    const session: Session = {
      sessionId: crypto.randomUUID(), // Use sessionId instead of id to avoid confusion with user.id
      userId: user.id, // Explicitly use user.id to ensure we're using the correct user ID
      tenantId: user.tenantId,
      refreshTokenId,
      deviceInfo,
      createdAt: now,
      expiresAt: addDays(now, this.config.sessionMaxAge),
      lastAccessedAt: now,
      isValid: true,
    };
    
    await db.collection('sessions').insertOne(session);
    
    // Generate JWT access token with roles and permissions from Passport user
    // CRITICAL: Use user.id (from Passport user object), NOT session.sessionId
    // Double-check that user.id is valid before creating token
    if (!user.id || typeof user.id !== 'string') {
      logger.error('Cannot create token: user.id is missing or invalid in createSessionAndTokens', {
        userId: user.id,
        _id: (user as any)._id,
        email: user.email,
        userObjectKeys: Object.keys(user),
      });
      throw new Error(`Invalid user ID in createSessionAndTokens: ${user.id}`);
    }
    
    logger.info('Creating UserContext for JWT token', {
      userId: user.id,
      email: user.email,
      roles,
      permissions,
      rolesCount: roles.length,
      permissionsCount: permissions.length,
    });
    
    const userContext: UserContext = {
      userId: user.id, // Explicitly use user.id to ensure correct user ID in token
      tenantId: user.tenantId,
      roles: roles,
      permissions: permissions,
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
        logger.error('Refresh token not found', {
          tokenHash: refreshTokenHash.substring(0, 10) + '...',
          tenantId,
        });
        return {
          success: false,
          message: 'Invalid refresh token',
        };
      }
      
      logger.info('Refresh token found', {
        refreshTokenId: refreshToken.id,
        refreshTokenUserId: refreshToken.userId,
        refreshTokenUserIdType: typeof refreshToken.userId,
        refreshTokenUserIdLength: refreshToken.userId?.length,
        tenantId,
        expiresAt: refreshToken.expiresAt,
        isValid: refreshToken.isValid,
      });
      
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
      
      // Get user - query by _id (MongoDB's primary key) since refreshToken.userId is stored as _id.toString()
      logger.info('Looking up user for token refresh', {
        refreshTokenUserId: refreshToken.userId,
        refreshTokenUserIdType: typeof refreshToken.userId,
        refreshTokenUserIdLength: refreshToken.userId?.length,
        tenantId,
      });
      
      // Get ObjectId from mongodb package (now available as dependency)
      const { ObjectId } = await import('mongodb');
      
      let user: any = null;
      
      // Try with ObjectId conversion (most reliable)
      if (refreshToken.userId && ObjectId.isValid(refreshToken.userId)) {
        try {
          user = await db.collection('users').findOne({
            _id: new ObjectId(refreshToken.userId),
            tenantId,
          }) as unknown as User | null;
          
          if (user) {
            logger.info('User found by _id (ObjectId)', { userId: user.id || user._id?.toString(), email: user.email });
          }
        } catch (objIdError: any) {
          logger.warn('ObjectId conversion failed, trying string query', { error: objIdError.message });
        }
      }
      
      // Fallback: Try string query (MongoDB driver should auto-convert)
      if (!user) {
        user = await db.collection('users').findOne({
          _id: refreshToken.userId as any,
          tenantId,
        }) as unknown as User | null;
        
        if (user) {
          logger.info('User found by _id (string)', { userId: user.id || user._id?.toString(), email: user.email });
        }
      }
      
      if (!user) {
        // Check what users exist to help debug
        const allUsers = await db.collection('users').find({ tenantId }).limit(5).toArray();
        const sampleUserIds = allUsers.map((u: any) => ({ 
          _id: u._id?.toString(), 
          id: u.id,
          email: u.email 
        }));
        
        logger.error('User not found during token refresh', {
          refreshTokenUserId: refreshToken.userId,
          tenantId,
          sampleUserIds,
          userCount: await db.collection('users').countDocuments({ tenantId }),
        });
        return {
          success: false,
          message: 'User not found or inactive',
        };
      }
      
      logger.info('User found during token refresh', {
        userId: user.id,
        user_id: user._id?.toString(),
        email: user.email,
        status: user.status,
      });
      
      // Ensure user has _id and id fields
      if (user._id && !user.id) {
        user.id = user._id.toString();
      }
      
      if (user.status !== 'active') {
        return {
          success: false,
          message: 'User not found or inactive',
        };
      }
      
      // Ensure user has _id and id fields
      if (user._id && !user.id) {
        user.id = user._id.toString();
      }
      
      // Generate new access token
      // Ensure user.id is defined
      if (!user.id) {
        logger.error('User missing id field after refresh token lookup', {
          userId: refreshToken.userId,
          user_id: user._id?.toString(),
        });
        return {
          success: false,
          message: 'User ID is required for token refresh',
        };
      }
      
      // Extract role names - handle both string[] and UserRole[] formats
      let rolesForContext: string[] = [];
      if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
        if (typeof user.roles[0] === 'string') {
          // Already string[] format
          rolesForContext = user.roles.filter((r: string) => r !== null && r !== undefined);
        } else if (typeof user.roles[0] === 'object' && user.roles[0].role) {
          // UserRole[] format - extract role names
          rolesForContext = user.roles
            .filter((r: any) => r.active !== false)
            .filter((r: any) => !r.expiresAt || new Date(r.expiresAt) > new Date())
            .map((r: any) => r.role)
            .filter((role: string) => role !== undefined && role !== null);
        }
      }
      
      logger.info('Extracted roles for token refresh', {
        userId: user.id,
        rolesForContext,
        rawRoles: user.roles,
        rolesType: Array.isArray(user.roles) && user.roles.length > 0 ? typeof user.roles[0] : 'unknown',
      });
      
      const userContext: UserContext = {
        userId: user.id,
        tenantId: user.tenantId,
        roles: rolesForContext,
        permissions: user.permissions || [],
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
    } catch (error: any) {
      logger.error('Token refresh error', { 
        error: error.message,
        stack: error.stack,
        name: error.name,
      });
      return {
        success: false,
        message: `Failed to refresh token: ${error.message || 'Unknown error'}`,
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
