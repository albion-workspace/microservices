/**
 * OTP Service
 * Handles OTP generation, sending, and verification across multiple channels
 */

import { getDatabase, logger, generateMongoId } from 'core-service';
import type { SendOTPInput, VerifyOTPInput, OTP, OTPResponse } from '../types.js';
import { generateOTP, hashToken, addMinutes } from '../utils.js';
import type { AuthConfig } from '../types.js';
import type { OTPProviderFactory } from '../providers/otp-provider.js';

export class OTPService {
  constructor(
    private config: AuthConfig,
    private otpProviders: OTPProviderFactory
  ) {}
  
  /**
   * Send OTP to user
   */
  async sendOTP(input: SendOTPInput): Promise<OTPResponse> {
    const db = getDatabase();
    
    try {
      // Check if channel is available
      if (!this.otpProviders.isChannelAvailable(input.channel)) {
        return {
          success: false,
          message: `OTP channel '${input.channel}' is not configured`,
        };
      }
      
      // Check rate limiting - max 3 OTPs per 10 minutes
      const recentOTPs = await db.collection('otps').countDocuments({
        tenantId: input.tenantId,
        recipient: input.recipient,
        purpose: input.purpose,
        createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
      });
      
      if (recentOTPs >= 3) {
        return {
          success: false,
          message: 'Too many OTP requests. Please try again later.',
        };
      }
      
      // Invalidate any existing unused OTPs for this recipient/purpose
      await db.collection('otps').updateMany(
        {
          tenantId: input.tenantId,
          recipient: input.recipient,
          purpose: input.purpose,
          isUsed: false,
        },
        {
          $set: { isUsed: true, usedAt: new Date() },
        }
      );
      
      // Generate OTP
      const code = generateOTP(this.config.otpLength);
      const hashedCode = await hashToken(code);
      
      const now = new Date();
      const expiresAt = addMinutes(now, this.config.otpExpiryMinutes);
      
      // Store OTP in database - use MongoDB ObjectId for performant single-insert operation
      const { objectId, idString } = generateMongoId();
      const otp = {
        _id: objectId,
        id: idString,
        userId: input.userId,
        tenantId: input.tenantId,
        code,
        hashedCode,
        channel: input.channel,
        recipient: input.recipient,
        purpose: input.purpose,
        attempts: 0,
        maxAttempts: this.config.otpMaxAttempts,
        isUsed: false,
        createdAt: now,
        expiresAt,
      };
      
      await db.collection('otps').insertOne(otp as any);
      
      // Send OTP via provider (uses notification service)
      const provider = this.otpProviders.getProvider(input.channel);
      await provider.send(input.recipient, code, input.purpose, input.tenantId, input.userId);
      
      logger.info('OTP sent', { 
        recipient: input.recipient, 
        channel: input.channel, 
        purpose: input.purpose 
      });
      
      return {
        success: true,
        message: 'OTP sent successfully',
        otpSentTo: input.recipient,
        channel: input.channel,
        expiresIn: this.config.otpExpiryMinutes * 60,
      };
    } catch (error) {
      logger.error('Failed to send OTP', { error, input });
      return {
        success: false,
        message: 'Failed to send OTP',
      };
    }
  }
  
  /**
   * Verify OTP code
   */
  async verifyOTP(input: VerifyOTPInput): Promise<OTPResponse> {
    const db = getDatabase();
    
    try {
      const hashedCode = await hashToken(input.code);
      
      // Find OTP
      const otp = await db.collection('otps').findOne({
        tenantId: input.tenantId,
        recipient: input.recipient,
        purpose: input.purpose,
        isUsed: false,
      }) as unknown as OTP | null;
      
      if (!otp) {
        return {
          success: false,
          message: 'Invalid or expired OTP',
        };
      }
      
      // Check if expired
      if (otp.expiresAt < new Date()) {
        await db.collection('otps').updateOne(
          { id: otp.id },
          { $set: { isUsed: true, usedAt: new Date() } }
        );
        
        return {
          success: false,
          message: 'OTP has expired',
        };
      }
      
      // Check attempts
      if (otp.attempts >= otp.maxAttempts) {
        await db.collection('otps').updateOne(
          { id: otp.id },
          { $set: { isUsed: true, usedAt: new Date() } }
        );
        
        return {
          success: false,
          message: 'Too many failed attempts',
        };
      }
      
      // Verify code
      if (otp.hashedCode !== hashedCode) {
        // Increment attempts
        await db.collection('otps').updateOne(
          { id: otp.id },
          { $inc: { attempts: 1 } }
        );
        
        return {
          success: false,
          message: 'Invalid OTP code',
        };
      }
      
      // Mark OTP as used
      await db.collection('otps').updateOne(
        { id: otp.id },
        { $set: { isUsed: true, usedAt: new Date() } }
      );
      
      // Update user verification status if applicable
      if (otp.userId) {
        await this.updateUserVerificationStatus(otp);
      }
      
      logger.info('OTP verified', { 
        recipient: input.recipient, 
        purpose: input.purpose 
      });
      
      return {
        success: true,
        message: 'OTP verified successfully',
      };
    } catch (error) {
      logger.error('Failed to verify OTP', { error, input });
      return {
        success: false,
        message: 'Failed to verify OTP',
      };
    }
  }
  
  /**
   * Update user verification status based on OTP purpose
   */
  private async updateUserVerificationStatus(otp: OTP): Promise<void> {
    if (!otp.userId) return;
    
    const db = getDatabase();
    const update: any = { updatedAt: new Date() };
    
    if (otp.purpose === 'email_verification') {
      update.emailVerified = true;
      update.status = 'active'; // Activate account on email verification
    } else if (otp.purpose === 'phone_verification') {
      update.phoneVerified = true;
      update.status = 'active'; // Activate account on phone verification
    }
    
    if (Object.keys(update).length > 1) {
      await db.collection('users').updateOne(
        { id: otp.userId },
        { $set: update }
      );
      
      logger.info('User verification status updated', { 
        userId: otp.userId, 
        purpose: otp.purpose 
      });
    }
  }
  
  /**
   * Resend OTP (with rate limiting)
   */
  async resendOTP(recipient: string, purpose: string, tenantId: string): Promise<OTPResponse> {
    const db = getDatabase();
    
    // Find the last OTP for this recipient/purpose
    const lastOTP = await db.collection('otps').findOne(
      {
        tenantId,
        recipient,
        purpose,
      },
      { sort: { createdAt: -1 } }
    ) as unknown as OTP | null;
    
    if (!lastOTP) {
      return {
        success: false,
        message: 'No OTP request found',
      };
    }
    
    // Check if can resend (must wait at least 60 seconds)
    const timeSinceLastOTP = Date.now() - lastOTP.createdAt.getTime();
    if (timeSinceLastOTP < 60 * 1000) {
      return {
        success: false,
        message: 'Please wait before requesting a new OTP',
      };
    }
    
    // Send new OTP
    return this.sendOTP({
      tenantId,
      recipient,
      channel: lastOTP.channel,
      purpose: lastOTP.purpose,
      userId: lastOTP.userId,
    });
  }
  
  /**
   * Cleanup expired OTPs (run periodically)
   */
  async cleanupExpiredOTPs(): Promise<number> {
    const db = getDatabase();
    
    try {
      const result = await db.collection('otps').deleteMany({
        expiresAt: { $lt: new Date() },
        isUsed: true,
      });
      
      if (result.deletedCount && result.deletedCount > 0) {
        logger.info('Expired OTPs cleaned up', { count: result.deletedCount });
      }
      
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Failed to cleanup expired OTPs', { error });
      return 0;
    }
  }
}
