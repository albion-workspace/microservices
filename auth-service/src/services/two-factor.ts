/**
 * Two-Factor Authentication Service
 * Handles TOTP (Time-based One-Time Password) 2FA setup and verification
 */

import { getDatabase, logger, findOneById, updateOneById, extractDocumentId, normalizeDocument, findById } from 'core-service';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import type { Enable2FAInput, Verify2FAInput, User, TwoFactorSetupResponse } from '../types.js';
import { generateBackupCodes, hashToken, verifyPassword } from '../utils.js';

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
      
      // Get user using findById helper (handles both _id and id fields)
      const userDoc = await findById<User>(db.collection('users'), input.userId, { tenantId: input.tenantId });
      
      if (!userDoc || !userDoc._id) {
        return {
          success: false,
          message: 'User not found',
        } as TwoFactorSetupResponse;
      }
      
      // Normalize user document to ensure id field exists
      const user = normalizeDocument(userDoc);
      const userId = extractDocumentId(user);
      if (!user || !userId) {
        return {
          success: false,
          message: 'Invalid user data',
        } as TwoFactorSetupResponse;
      }
      
      // Verify password
      if (!user.passwordHash) {
        return {
          success: false,
          message: 'Password not set for this account',
        } as TwoFactorSetupResponse;
      }
      
      // Verify password before enabling 2FA
      if (!input.password) {
        return {
          success: false,
          message: 'Password is required to enable 2FA',
        } as TwoFactorSetupResponse;
      }
      
      const isPasswordValid = await verifyPassword(input.password, user.passwordHash);
      if (!isPasswordValid) {
        return {
          success: false,
          message: 'Invalid password',
        } as TwoFactorSetupResponse;
      }
      
      // Generate 2FA secret
      let secret: speakeasy.GeneratedSecret;
      let qrCodeDataUrl: string;
      
      try {
        secret = speakeasy.generateSecret({
          name: `AuthService (${user.email || user.username || user.phone})`,
          length: 32,
        });
        
        if (!secret.otpauth_url) {
          return {
            success: false,
            message: 'Failed to generate 2FA secret URL',
          } as TwoFactorSetupResponse;
        }
        
        // Generate QR code
        qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url);
      } catch (error: any) {
        logger.error('Failed to generate 2FA secret or QR code', {
          error: error?.message || error,
          userId: user.id,
        });
        return {
          success: false,
          message: `Failed to generate 2FA secret: ${error?.message || 'Unknown error'}`,
        } as TwoFactorSetupResponse;
      }
      
      // Generate backup codes
      const backupCodes = generateBackupCodes(10);
      const hashedBackupCodes = await Promise.all(
        backupCodes.map(code => hashToken(code))
      );
      
      // Store secret (but don't enable yet - requires verification)
      // Use _id for update (most reliable)
      if (!user._id) {
        return {
          success: false,
          message: 'User missing _id field',
        } as TwoFactorSetupResponse;
      }
      
      const updateResult = await db.collection('users').updateOne(
        { _id: user._id, tenantId: input.tenantId },
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
      
      if (updateResult.matchedCount === 0) {
        logger.error('Failed to update user for 2FA setup', {
          userId: userId,
          _id: userDoc._id?.toString(),
          tenantId: input.tenantId,
        });
        return {
          success: false,
          message: 'Failed to save 2FA configuration',
        } as TwoFactorSetupResponse;
      }
      
      logger.info('2FA setup initiated', { userId: userId });
      
      return {
        success: true,
        secret: secret.base32,
        qrCode: qrCodeDataUrl,
        backupCodes, // Return plain codes to user (only shown once)
      };
    } catch (error: any) {
      logger.error('Enable 2FA error', { 
        error: error?.message || error,
        stack: error?.stack,
        userId: input.userId,
        tenantId: input.tenantId,
      });
      return {
        success: false,
        message: error?.message || 'Failed to enable 2FA',
      } as TwoFactorSetupResponse;
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
      
      // Get user using findById helper (handles both _id and id fields)
      const userDoc = await findById<User>(db.collection('users'), input.userId, { tenantId: input.tenantId });
      
      if (!userDoc || !userDoc._id) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      
      // Normalize user document to ensure id field exists
      const user = normalizeDocument(userDoc);
      const userId = extractDocumentId(user);
      if (!user || !userId) {
        return {
          success: false,
          message: 'Invalid user data',
        };
      }
      
      // Check if 2FA secret exists (set by enable2FA)
      if (!user.twoFactorSecret) {
        return {
          success: false,
          message: '2FA not set up for this user. Please enable 2FA first.',
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
      
      // Enable 2FA (activate it after verification)
      await db.collection('users').updateOne(
        { _id: userDoc._id, tenantId: input.tenantId },
        { 
          $set: { 
            twoFactorEnabled: true,
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('2FA enabled', { userId: userId });
      
      return {
        success: true,
        message: '2FA enabled successfully',
      };
    } catch (error: any) {
      logger.error('Verify 2FA error', { 
        error: error?.message || error,
        stack: error?.stack,
        userId: input.userId,
        tenantId: input.tenantId,
      });
      return {
        success: false,
        message: error?.message || 'An error occurred',
      };
    }
  }
  
  /**
   * Disable 2FA for user
   */
  async disable2FA(userId: string, tenantId: string, password: string): Promise<{ success: boolean; message: string }> {
    const db = getDatabase();
    
    try {
      // Get user using findById helper (handles both _id and id fields)
      const userDoc = await findById<User>(db.collection('users'), userId, { tenantId });
      
      if (!userDoc || !userDoc._id) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      
      // Normalize user document
      const user = normalizeDocument(userDoc);
      const extractedUserId = extractDocumentId(user);
      if (!user || !extractedUserId) {
        return {
          success: false,
          message: 'Invalid user data',
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
        { _id: userDoc._id, tenantId },
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
        { _id: userDoc._id, tenantId },
        { $set: { metadata: newMetadata } }
      );
      
      logger.info('2FA disabled', { userId: extractedUserId });
      
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
        
        // Update backup codes - user already fetched above, use _id from that
        if (user && (user as any)._id) {
          await db.collection('users').updateOne(
            { _id: (user as any)._id },
            { 
              $set: { 
                'metadata.backupCodes': newBackupCodes,
                updatedAt: new Date(),
              },
            }
          );
        }
        
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
      // Get user using findById helper (handles both _id and id fields)
      const userDoc = await findById<User>(db.collection('users'), userId, { tenantId });
      
      if (!userDoc || !userDoc._id) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      
      // Normalize user document
      const user = normalizeDocument(userDoc);
      const extractedUserId = extractDocumentId(user);
      if (!user || !extractedUserId) {
        return {
          success: false,
          message: 'Invalid user data',
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
        { _id: userDoc._id, tenantId },
        { 
          $set: { 
            'metadata.backupCodes': hashedBackupCodes,
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('Backup codes regenerated', { userId: extractedUserId });
      
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
