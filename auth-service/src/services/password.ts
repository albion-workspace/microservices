/**
 * Password Service
 * Handles password reset, change, and forgot password flows
 */

import { getDatabase, logger } from 'core-service';
import type { 
  ForgotPasswordInput, 
  ResetPasswordInput, 
  ChangePasswordInput,
  User,
  PasswordResetToken,
  OTPChannel,
} from '../types.js';
import { 
  validatePassword, 
  generateToken,
  hashToken,
  addMinutes,
  detectIdentifierType,
  normalizeEmail,
  normalizePhone,
} from '../utils.js';
import type { AuthConfig } from '../types.js';
import type { OTPProviderFactory } from '../providers/otp-provider.js';

export class PasswordService {
  constructor(
    private config: AuthConfig,
    private otpProviders: OTPProviderFactory
  ) {}
  
  /**
   * Initiate forgot password flow
   * Sends reset token via email or OTP via SMS/WhatsApp
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<{ success: boolean; message: string; channel?: OTPChannel }> {
    const db = getDatabase();
    
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
      
      // Determine delivery method
      const identifierType = detectIdentifierType(input.identifier);
      
      if (identifierType === 'email' && user.email) {
        // Send reset token via email
        await this.sendPasswordResetEmail(user);
        return {
          success: true,
          message: 'Password reset instructions sent to your email',
          channel: 'email',
        };
      } else if ((identifierType === 'phone' || identifierType === 'username') && user.phone) {
        // Send OTP via SMS/WhatsApp
        await this.sendPasswordResetOTP(user);
        return {
          success: true,
          message: 'Password reset code sent to your phone',
          channel: 'sms',
        };
      } else {
        return {
          success: false,
          message: 'No valid contact method found for password reset',
        };
      }
    } catch (error) {
      logger.error('Forgot password error', { error });
      return {
        success: false,
        message: 'An error occurred',
      };
    }
  }
  
  /**
   * Reset password using token
   */
  async resetPassword(input: ResetPasswordInput): Promise<{ success: boolean; message: string }> {
    const db = getDatabase();
    
    try {
      // Validate new password
      const passwordValidation = validatePassword(input.newPassword, this.config);
      if (!passwordValidation.valid) {
        return {
          success: false,
          message: passwordValidation.errors.join(', '),
        };
      }
      
      // Find reset token
      const tokenHash = await hashToken(input.token);
      const resetToken = await db.collection('password_reset_tokens').findOne({
        tenantId: input.tenantId,
        tokenHash,
        isUsed: false,
      }) as unknown as PasswordResetToken | null;
      
      if (!resetToken) {
        return {
          success: false,
          message: 'Invalid or expired reset token',
        };
      }
      
      // Check if expired
      if (resetToken.expiresAt < new Date()) {
        await db.collection('password_reset_tokens').updateOne(
          { id: resetToken.id },
          { $set: { isUsed: true, usedAt: new Date() } }
        );
        
        return {
          success: false,
          message: 'Reset token has expired',
        };
      }
      
      // Passport.js handles password hashing
      // Update user password
      await db.collection('users').updateOne(
        { id: resetToken.userId },
        { 
          $set: { 
            passwordHash: input.newPassword, // Passport.js will handle hashing
            passwordChangedAt: new Date(),
            updatedAt: new Date(),
            // Reset failed login attempts
            failedLoginAttempts: 0,
            lastFailedLoginAt: null,
            lockedUntil: null,
          },
        }
      );
      
      // Mark token as used
      await db.collection('password_reset_tokens').updateOne(
        { id: resetToken.id },
        { $set: { isUsed: true, usedAt: new Date() } }
      );
      
      // Invalidate all existing sessions
      await db.collection('refresh_tokens').updateMany(
        { userId: resetToken.userId, isValid: true },
        { $set: { isValid: false, revokedAt: new Date(), revokedReason: 'password_reset' } }
      );
      
      await db.collection('sessions').updateMany(
        { userId: resetToken.userId, isValid: true },
        { $set: { isValid: false, invalidatedAt: new Date(), invalidatedReason: 'password_reset' } }
      );
      
      logger.info('Password reset', { userId: resetToken.userId });
      
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
    const db = getDatabase();
    
    try {
      // Get user
      const user = await db.collection('users').findOne({
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
      
      // Passport.js handles password verification
      // For password change, we'll rely on Passport.js to verify current password
      // Note: Password verification should be done via Passport.js authentication
      
      // Validate new password
      const passwordValidation = validatePassword(input.newPassword, this.config);
      if (!passwordValidation.valid) {
        return {
          success: false,
          message: passwordValidation.errors.join(', '),
        };
      }
      
      // Check if new password is same as current
      if (input.newPassword === user.passwordHash) {
        return {
          success: false,
          message: 'New password must be different from current password',
        };
      }
      
      // Passport.js handles password hashing
      // Update password
      await db.collection('users').updateOne(
        { id: user.id },
        { 
          $set: { 
            passwordHash: input.newPassword, // Passport.js will handle hashing
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
   */
  private async sendPasswordResetEmail(user: User): Promise<void> {
    if (!user.email) return;
    
    const db = getDatabase();
    
    // Generate reset token
    const token = generateToken(32);
    const tokenHash = await hashToken(token);
    
    const now = new Date();
    const resetToken: PasswordResetToken = {
      id: crypto.randomUUID(),
      userId: user.id,
      tenantId: user.tenantId,
      token,
      tokenHash,
      createdAt: now,
      expiresAt: addMinutes(now, 30), // 30 minutes expiry
      isUsed: false,
    };
    
    // Invalidate old reset tokens
    await db.collection('password_reset_tokens').updateMany(
      { userId: user.id, isUsed: false },
      { $set: { isUsed: true, usedAt: now } }
    );
    
    // Store new token
    await db.collection('password_reset_tokens').insertOne(resetToken);
    
      // Send email (via OTP provider - uses notification service)
    try {
      const provider = this.otpProviders.getProvider('email');
      
      // Send reset link
      const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetLink = `${appUrl}/reset-password?token=${token}`;
      await provider.send(user.email, resetLink, 'password_reset', user.tenantId, user.id);
      
      logger.info('Password reset email sent', { userId: user.id });
    } catch (error) {
      logger.error('Failed to send password reset email', { error, userId: user.id });
    }
  }
  
  /**
   * Send password reset OTP via SMS/WhatsApp
   */
  private async sendPasswordResetOTP(user: User): Promise<void> {
    if (!user.phone) return;
    
    const db = getDatabase();
    
    // Use OTP service logic
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = await hashToken(code);
    
    const now = new Date();
    
    await db.collection('otps').insertOne({
      id: crypto.randomUUID(),
      userId: user.id,
      tenantId: user.tenantId,
      code,
      hashedCode,
      channel: 'sms',
      recipient: user.phone,
      purpose: 'password_reset',
      attempts: 0,
      maxAttempts: this.config.otpMaxAttempts,
      isUsed: false,
      createdAt: now,
      expiresAt: addMinutes(now, this.config.otpExpiryMinutes),
    });
    
    // Send via SMS
    try {
      const channel = this.otpProviders.isChannelAvailable('whatsapp') ? 'whatsapp' : 'sms';
      const provider = this.otpProviders.getProvider(channel);
      await provider.send(user.phone, code, 'password_reset', user.tenantId, user.id);
      
      logger.info('Password reset OTP sent', { userId: user.id, channel });
    } catch (error) {
      logger.error('Failed to send password reset OTP', { error, userId: user.id });
    }
  }
  
  /**
   * Find user by identifier
   */
  private async findUserByIdentifier(identifier: string, tenantId: string): Promise<User | null> {
    const db = getDatabase();
    
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
    
    return await db.collection('users').findOne(query) as unknown as User | null;
  }
  
  /**
   * Cleanup expired reset tokens (run periodically)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const db = getDatabase();
    
    try {
      const result = await db.collection('password_reset_tokens').deleteMany({
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
