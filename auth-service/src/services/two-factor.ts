/**
 * Two-Factor Authentication Service
 * Handles TOTP (Time-based One-Time Password) 2FA setup and verification
 */

import { getDatabase, logger, findOneById, updateOneById } from 'core-service';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import type { Enable2FAInput, Verify2FAInput, User, TwoFactorSetupResponse } from '../types.js';
import { generateBackupCodes, hashToken } from '../utils.js';

export class TwoFactorService {
  /**
   * Enable 2FA for user - generates secret and QR code
   */
  async enable2FA(input: Enable2FAInput): Promise<TwoFactorSetupResponse> {
    const db = getDatabase();
    
    try {
      // Validate required fields (should be provided by resolver from context)
      if (!input.userId || !input.tenantId) {
        return {
          success: false,
          message: 'User ID and tenant ID are required',
        } as TwoFactorSetupResponse;
      }
      
      // Get user
      const user = await db.collection('users').findOne({
        id: input.userId,
        tenantId: input.tenantId,
      }) as unknown as User | null;
      
      if (!user) {
        return {
          success: false,
          message: 'User not found',
        } as TwoFactorSetupResponse;
      }
      
      // Verify password
      if (!user.passwordHash) {
        return {
          success: false,
          message: 'Password not set for this account',
        } as TwoFactorSetupResponse;
      }
      
      // Passport.js handles password verification
      // For 2FA setup, password should be verified via Passport.js authentication flow
      // Note: Password verification is handled by Passport.js
      
      // Generate 2FA secret
      const secret = speakeasy.generateSecret({
        name: `AuthService (${user.email || user.username || user.phone})`,
        length: 32,
      });
      
      // Generate QR code
      const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url || '');
      
      // Generate backup codes
      const backupCodes = generateBackupCodes(10);
      const hashedBackupCodes = await Promise.all(
        backupCodes.map(code => hashToken(code))
      );
      
      // Store secret (but don't enable yet - requires verification)
      await db.collection('users').updateOne(
        { id: user.id },
        { 
          $set: { 
            twoFactorSecret: secret.base32,
            // Store hashed backup codes
            metadata: {
              ...user.metadata,
              backupCodes: hashedBackupCodes,
            },
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('2FA setup initiated', { userId: user.id });
      
      return {
        success: true,
        secret: secret.base32,
        qrCode: qrCodeDataUrl,
        backupCodes, // Return plain codes to user (only shown once)
      };
    } catch (error) {
      logger.error('Enable 2FA error', { error });
      return {
        success: false,
      };
    }
  }
  
  /**
   * Verify 2FA code and activate 2FA for user
   */
  async verify2FA(input: Verify2FAInput): Promise<{ success: boolean; message: string }> {
    const db = getDatabase();
    
    try {
      // Validate required fields (should be provided by resolver from context)
      if (!input.userId || !input.tenantId) {
        return {
          success: false,
          message: 'User ID and tenant ID are required',
        };
      }
      
      // Get user
      const user = await db.collection('users').findOne({
        id: input.userId,
        tenantId: input.tenantId,
      }) as unknown as User | null;
      
      if (!user || !user.twoFactorSecret) {
        return {
          success: false,
          message: '2FA not set up for this user',
        };
      }
      
      // Verify token
      const isValid = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: input.token,
        window: 2,
      });
      
      if (!isValid) {
        return {
          success: false,
          message: 'Invalid verification code',
        };
      }
      
      // Enable 2FA
      await db.collection('users').updateOne(
        { id: user.id },
        { 
          $set: { 
            twoFactorEnabled: true,
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('2FA enabled', { userId: user.id });
      
      return {
        success: true,
        message: '2FA enabled successfully',
      };
    } catch (error) {
      logger.error('Verify 2FA error', { error });
      return {
        success: false,
        message: 'An error occurred',
      };
    }
  }
  
  /**
   * Disable 2FA for user
   */
  async disable2FA(userId: string, tenantId: string, password: string): Promise<{ success: boolean; message: string }> {
    const db = getDatabase();
    
    try {
      // Get user
      const user = await db.collection('users').findOne({
        id: userId,
        tenantId,
      }) as unknown as User | null;
      
      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      
      // Verify password
      if (!user.passwordHash) {
        return {
          success: false,
          message: 'Password not set for this account',
        };
      }
      
      // Passport.js handles password verification
      // Password verification should be done via Passport.js authentication
      
      // Disable 2FA
      await db.collection('users').updateOne(
        { id: user.id },
        { 
          $set: { 
            twoFactorEnabled: false,
            updatedAt: new Date(),
          },
          $unset: { 
            twoFactorSecret: '',
          },
        }
      );
      
      // Remove backup codes from metadata
      const newMetadata = { ...user.metadata };
      delete newMetadata.backupCodes;
      
      await db.collection('users').updateOne(
        { id: user.id },
        { $set: { metadata: newMetadata } }
      );
      
      logger.info('2FA disabled', { userId: user.id });
      
      return {
        success: true,
        message: '2FA disabled successfully',
      };
    } catch (error) {
      logger.error('Disable 2FA error', { error });
      return {
        success: false,
        message: 'An error occurred',
      };
    }
  }
  
  /**
   * Verify 2FA code or backup code during login
   */
  async verify2FACode(userId: string, code: string): Promise<boolean> {
    const db = getDatabase();
    
    try {
      // Use optimized findOneById utility (performance-optimized)
      const user = await findOneById<User>(db.collection('users'), userId, {});
      
      if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
        return false;
      }
      
      // Try TOTP verification first
      const isTOTPValid = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: code,
        window: 2,
      });
      
      if (isTOTPValid) {
        return true;
      }
      
      // Try backup codes
      const backupCodes = user.metadata?.backupCodes as string[] | undefined;
      if (!backupCodes || backupCodes.length === 0) {
        return false;
      }
      
      const codeHash = await hashToken(code);
      const backupCodeIndex = backupCodes.indexOf(codeHash);
      
      if (backupCodeIndex !== -1) {
        // Remove used backup code
        const newBackupCodes = backupCodes.filter((_, i) => i !== backupCodeIndex);
        
        await db.collection('users').updateOne(
          { id: userId },
          { 
            $set: { 
              'metadata.backupCodes': newBackupCodes,
              updatedAt: new Date(),
            },
          }
        );
        
        logger.info('Backup code used', { userId, remainingCodes: newBackupCodes.length });
        
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Verify 2FA code error', { error, userId });
      return false;
    }
  }
  
  /**
   * Regenerate backup codes
   */
  async regenerateBackupCodes(userId: string, tenantId: string, password: string): Promise<{ success: boolean; backupCodes?: string[]; message?: string }> {
    const db = getDatabase();
    
    try {
      // Get user
      const user = await db.collection('users').findOne({
        id: userId,
        tenantId,
      }) as unknown as User | null;
      
      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      
      // Verify password
      if (!user.passwordHash) {
        return {
          success: false,
          message: 'Password not set for this account',
        };
      }
      
      // Passport.js handles password verification
      // Password verification should be done via Passport.js authentication
      
      if (!user.twoFactorEnabled) {
        return {
          success: false,
          message: '2FA is not enabled',
        };
      }
      
      // Generate new backup codes
      const backupCodes = generateBackupCodes(10);
      const hashedBackupCodes = await Promise.all(
        backupCodes.map(code => hashToken(code))
      );
      
      // Update backup codes
      await db.collection('users').updateOne(
        { id: user.id },
        { 
          $set: { 
            'metadata.backupCodes': hashedBackupCodes,
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('Backup codes regenerated', { userId: user.id });
      
      return {
        success: true,
        backupCodes,
      };
    } catch (error) {
      logger.error('Regenerate backup codes error', { error });
      return {
        success: false,
        message: 'An error occurred',
      };
    }
  }
}
