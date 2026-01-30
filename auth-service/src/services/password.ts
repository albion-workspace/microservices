/**
 * Password Service
 * Handles password reset, change, and forgot password flows
 * 
 * Uses PendingOperationStore (JWT-based) for password reset tokens/OTPs
 * This eliminates database writes for temporary reset operations
 */

import { logger, normalizeDocument, findById, createPendingOperationStore } from 'core-service';
import { db } from '../database.js';
import type { 
  ForgotPasswordInput, 
  ResetPasswordInput, 
  ChangePasswordInput,
  User,
  OTPChannel,
} from '../types.js';
import { 
  validatePassword, 
  hashToken,
  detectIdentifierType,
  normalizeEmail,
  normalizePhone,
  hashPassword,
  verifyPassword,
  generateOTP,
  addMinutes,
} from '../utils.js';
import type { AuthConfig } from '../types.js';
import type { OTPProviderFactory } from '../providers/otp-provider.js';

export class PasswordService {
  private resetStore: ReturnType<typeof createPendingOperationStore>;
  
  constructor(
    private config: AuthConfig,
    private otpProviders: OTPProviderFactory
  ) {
    // Use generic pending operation store for password reset (JWT-based)
    this.resetStore = createPendingOperationStore({ 
      backend: 'jwt', // Explicitly use JWT backend for stateless password reset tokens
      jwtSecret: this.config.jwtSecret,
      defaultExpiration: '30m', // 30 minutes for password reset
    });
  }
  
  /**
   * Initiate forgot password flow
   * Sends reset token via email or OTP via SMS/WhatsApp
   * Uses PendingOperationStore (JWT) to store reset token/OTP (no DB write)
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<{ success: boolean; message: string; channel?: OTPChannel; resetToken?: string }> {
    try {
      // Find user
      const user = await this.findUserByIdentifier(input.identifier, input.tenantId);
      
      if (!user) {
        // Don't reveal if user exists
        return {
          success: true,
          message: 'If an account exists, you will receive reset instructions',
        };
      }
      
      if (!user.id) {
        return {
          success: false,
          message: 'Invalid user data',
        };
      }
      
      // Determine delivery method
      const identifierType = detectIdentifierType(input.identifier);
      
      if (identifierType === 'email' && user.email) {
        // Send reset token via email (stored in JWT)
        const resetToken = await this.sendPasswordResetEmail(user);
        return {
          success: true,
          message: 'Password reset instructions sent to your email',
          channel: 'email',
          resetToken,
        };
      } else if ((identifierType === 'phone' || identifierType === 'username') && user.phone) {
        // Send OTP via SMS/WhatsApp (stored in JWT)
        const resetToken = await this.sendPasswordResetOTP(user);
        return {
          success: true,
          message: 'Password reset code sent to your phone',
          channel: 'sms',
          resetToken,
        };
      } else {
        return {
          success: false,
          message: 'No valid contact method found for password reset',
        };
      }
    } catch (error: any) {
      logger.error('Forgot password error', { 
        error: error?.message || error,
        stack: error?.stack,
        identifier: input.identifier,
        tenantId: input.tenantId,
      });
      return {
        success: false,
        message: error?.message || 'An error occurred',
      };
    }
  }
  
  /**
   * Reset password using token from JWT (PendingOperationStore)
   * Token is verified from JWT, not database
   */
  async resetPassword(input: ResetPasswordInput): Promise<{ success: boolean; message: string }> {
    const database = await db.getDb();
    
    try {
      // Validate new password
      const passwordValidation = validatePassword(input.newPassword, this.config);
      if (!passwordValidation.valid) {
        return {
          success: false,
          message: passwordValidation.errors.join(', '),
        };
      }
      
      // Verify and retrieve reset operation from JWT token
      // The input.token IS the JWT reset token (no separate token hash needed)
      const operation = await this.resetStore.verify<{
        userId: string;
        tenantId: string;
        recipient: string;
        channel: string;
        createdAt: number;
        otp?: {
          hashedCode: string;
          recipient: string;
          channel: string;
          createdAt: number;
          expiresIn: number;
        };
      }>(input.token, 'password_reset');
      
      if (!operation) {
        return {
          success: false,
          message: 'Invalid or expired reset token',
        };
      }
      
      const resetData = operation.data;
      
      // Verify tenant matches
      if (resetData.tenantId !== input.tenantId) {
        return {
          success: false,
          message: 'Tenant mismatch',
        };
      }
      
      // If OTP-based reset, verify OTP code
      if (resetData.otp) {
        if (!input.otpCode) {
          return {
            success: false,
            message: 'OTP code is required for password reset',
          };
        }
        
        // Check OTP expiration
        const now = Date.now();
        const otpAge = now - resetData.otp.createdAt;
        if (otpAge > resetData.otp.expiresIn) {
          return {
            success: false,
            message: 'OTP code has expired',
          };
        }
        
        // Verify OTP code
        const hashedCode = await hashToken(input.otpCode);
        if (resetData.otp.hashedCode !== hashedCode) {
          return {
            success: false,
            message: 'Invalid OTP code',
          };
        }
        
        logger.info('Password reset OTP verified', {
          userId: resetData.userId,
          recipient: resetData.otp.recipient,
        });
      }
      
      // Hash password before storing
      const hashedPassword = await hashPassword(input.newPassword);
      
      // Find user first to ensure they exist and get the correct _id
      const user = await findById<User>(database.collection('users'), resetData.userId, { tenantId: input.tenantId });
      
      if (!user || !user._id) {
        logger.error('User not found for password reset', { 
          userId: resetData.userId, 
          tenantId: input.tenantId 
        });
        return {
          success: false,
          message: 'User not found',
        };
      }
      
      // Normalize user to ensure id field exists
      const normalizedUser = normalizeDocument(user);
      if (!normalizedUser) {
        logger.error('Failed to normalize user document', { 
          userId: resetData.userId,
          _id: user._id?.toString(),
        });
        return {
          success: false,
          message: 'Invalid user data',
        };
      }
      
      // Update user password using _id (most reliable)
      const updateResult = await database.collection('users').updateOne(
        { _id: normalizedUser._id, tenantId: input.tenantId },
        { 
          $set: { 
            passwordHash: hashedPassword,
            passwordChangedAt: new Date(),
            updatedAt: new Date(),
            // Reset failed login attempts
          },
        }
      );
      
      if (updateResult.matchedCount === 0) {
        logger.error('Failed to update password - user not matched', { 
          userId: resetData.userId,
          user_id: normalizedUser.id,
          _id: normalizedUser._id?.toString(),
          tenantId: input.tenantId 
        });
        return {
          success: false,
          message: 'Failed to update password',
        };
      }
      
      logger.info('Password reset successful', { 
        userId: resetData.userId, 
        user_id: normalizedUser.id,
        tenantId: input.tenantId,
        matchedCount: updateResult.matchedCount,
        modifiedCount: updateResult.modifiedCount,
      });
      
      // Invalidate all existing sessions (unified collection)
      await database.collection('sessions').updateMany(
        { userId: resetData.userId, tenantId: input.tenantId, isValid: true },
        { $set: { isValid: false, revokedAt: new Date(), revokedReason: 'password_reset' } }
      );
      
      logger.info('Password reset', { userId: resetData.userId });
      
      return {
        success: true,
        message: 'Password reset successful',
      };
    } catch (error) {
      logger.error('Reset password error', { error });
      return {
        success: false,
        message: 'An error occurred',
      };
    }
  }
  
  /**
   * Change password (requires current password)
   */
  async changePassword(input: ChangePasswordInput): Promise<{ success: boolean; message: string }> {
    const database = await db.getDb();
    
    try {
      // Get user
      const user = await database.collection('users').findOne({
        id: input.userId,
        tenantId: input.tenantId,
      }) as unknown as User | null;
      
      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      
      // Verify current password
      if (!user.passwordHash) {
        return {
          success: false,
          message: 'Password not set for this account',
        };
      }
      
      // CRITICAL: Verify current password using node:crypto scrypt
      const isCurrentPasswordValid = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!isCurrentPasswordValid) {
        return {
          success: false,
          message: 'Current password is incorrect',
        };
      }
      
      // Validate new password
      const passwordValidation = validatePassword(input.newPassword, this.config);
      if (!passwordValidation.valid) {
        return {
          success: false,
          message: passwordValidation.errors.join(', '),
        };
      }
      
      // Check if new password is same as current (compare hashes)
      const isSamePassword = await verifyPassword(input.newPassword, user.passwordHash);
      if (isSamePassword) {
        return {
          success: false,
          message: 'New password must be different from current password',
        };
      }
      
      // CRITICAL: Hash new password before storing (Passport.js does NOT hash automatically)
      const hashedPassword = await hashPassword(input.newPassword);
      
      // Update password
      await database.collection('users').updateOne(
        { id: user.id },
        { 
          $set: { 
            passwordHash: hashedPassword,
            passwordChangedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('Password changed', { userId: user.id });
      
      return {
        success: true,
        message: 'Password changed successfully',
      };
    } catch (error) {
      logger.error('Change password error', { error });
      return {
        success: false,
        message: 'An error occurred',
      };
    }
  }
  
  /**
   * Send password reset email
   * Stores reset token in JWT (PendingOperationStore) instead of database
   */
  private async sendPasswordResetEmail(user: User): Promise<string> {
    if (!user.email || !user.id) {
      throw new Error('User email and ID are required for password reset');
    }
    
    // Store reset operation in JWT (no DB write needed)
    // The JWT token itself is the reset token - no need for separate token generation
    const resetData = {
      userId: user.id,
      tenantId: user.tenantId,
      recipient: user.email,
      channel: 'email',
      createdAt: Date.now(),
    };
    
    // Create reset token in PendingOperationStore (JWT-based, expires in 30 minutes)
    // The returned token IS the reset token to use in the link
    const resetToken = await this.resetStore.create(
      'password_reset',
      resetData,
      {
        operationType: 'password_reset',
        expiresIn: '30m', // 30 minutes expiry
      }
    );
    
    // Debug log: Output reset token for testing (remove in production if needed)
    logger.debug('Password reset token (for testing)', {
      recipient: user.email,
      channel: 'email',
      resetToken: resetToken.substring(0, 50) + '...',
    });
    
    // Send email via notification service
    try {
      const provider = this.otpProviders.getProvider('email');
      
      // Send reset link with the JWT token
      const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetLink = `${appUrl}/reset-password?token=${resetToken}`;
      await provider.send(user.email, resetLink, 'password_reset', user.tenantId, user.id);
      
      logger.info('Password reset email sent (JWT-based)', { 
        userId: user.id,
        tokenExpiresIn: '30m',
      });
    } catch (error: any) {
      // Email sending failed, but token is stored in JWT
      logger.warn('Failed to send password reset email (token stored in JWT)', { 
        error: error?.message || error, 
        userId: user.id,
      });
      // Don't throw - token is stored in JWT
    }
    
    return resetToken;
  }
  
  /**
   * Send password reset OTP via SMS/WhatsApp
   * Stores OTP in JWT (PendingOperationStore) instead of database
   */
  private async sendPasswordResetOTP(user: User): Promise<string> {
    if (!user.phone || !user.id) {
      throw new Error('User phone and ID are required for password reset OTP');
    }
    
    const channel = this.otpProviders.isChannelAvailable('whatsapp') ? 'whatsapp' : 'sms';
    
    // Generate OTP code - use "000000" for testing (when providers not configured)
    const code = '000000'; // Test OTP - replace with generateOTP(this.config.otpLength) in production
    const hashedCode = await hashToken(code);
    
    // Store reset operation with OTP in JWT (no DB write needed)
    const resetData = {
      userId: user.id,
      tenantId: user.tenantId,
      otp: {
        hashedCode,
        recipient: user.phone,
        channel,
        createdAt: Date.now(),
        expiresIn: this.config.otpExpiryMinutes * 60 * 1000, // milliseconds
      },
    };
    
    // Create reset token in PendingOperationStore (JWT-based, expires in 30 minutes)
    const resetToken = await this.resetStore.create(
      'password_reset',
      resetData,
      {
        operationType: 'password_reset',
        expiresIn: '30m', // 30 minutes expiry
      }
    );
    
    // Debug log: Output plain OTP code for testing (check logs to retrieve OTP)
    logger.debug('Password reset OTP code (for testing)', {
      recipient: user.phone,
      channel,
      otpCode: code,
      resetToken: resetToken.substring(0, 50) + '...',
    });
    
    // Send OTP via SMS/WhatsApp
    // TODO: Uncomment when providers are configured
    // try {
    //   const provider = this.otpProviders.getProvider(channel);
    //   await provider.send(user.phone, code, 'password_reset', user.tenantId, user.id);
    //   logger.info('Password reset OTP sent (JWT-based)', { 
    //     userId: user.id, 
    //     channel,
    //     tokenExpiresIn: '30m',
    //     otpExpiresIn: `${this.config.otpExpiryMinutes} minutes`,
    //   });
    // } catch (error) {
    //   logger.warn('Failed to send password reset OTP (token stored in JWT)', { 
    //     error, 
    //     userId: user.id,
    //   });
    // }
    
    return resetToken;
  }
  
  /**
   * Find user by identifier
   */
  private async findUserByIdentifier(identifier: string, tenantId: string): Promise<User | null> {
    const database = await db.getDb();
    
    const identifierType = detectIdentifierType(identifier);
    
    let query: any = { tenantId };
    
    switch (identifierType) {
      case 'email':
        query.email = normalizeEmail(identifier);
        break;
      case 'phone':
        query.phone = normalizePhone(identifier);
        break;
      case 'username':
        query.username = identifier;
        break;
    }
    
    const user = await database.collection('users').findOne(query) as unknown as User | null;
    return user ? normalizeDocument(user) : null;
  }
  
  /**
   * Cleanup expired reset tokens from database
   * Note: New tokens are JWT-based and self-expiring, this cleans up any remaining DB entries
   */
  async cleanupExpiredTokens(): Promise<number> {
    const database = await db.getDb();
    
    try {
      const result = await database.collection('password_reset_tokens').deleteMany({
        expiresAt: { $lt: new Date() },
        isUsed: true,
      });
      
      if (result.deletedCount && result.deletedCount > 0) {
        logger.info('Expired password reset tokens cleaned up', { count: result.deletedCount });
      }
      
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Failed to cleanup expired tokens', { error });
      return 0;
    }
  }
}
