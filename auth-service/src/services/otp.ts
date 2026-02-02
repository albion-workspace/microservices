/**
 * OTP Service
 * Handles OTP generation, sending, and verification across multiple channels
 * Uses PendingOperationStore (JWT-based) for unified OTP storage pattern
 */

import { logger, createPendingOperationStore } from 'core-service';
import { db } from '../database.js';
import type { SendOTPInput, VerifyOTPInput, OTPResponse, OTPChannel, OTPPurpose } from '../types.js';
import { generateOTP, hashToken } from '../utils.js';
import type { AuthConfig } from '../config.js';
import type { OTPProviderFactory } from '../providers/otp-provider.js';

export class OTPService {
  private otpStore: ReturnType<typeof createPendingOperationStore>;
  
  constructor(
    private config: AuthConfig,
    private otpProviders: OTPProviderFactory
  ) {
    // Use generic pending operation store for OTPs (JWT-based)
    this.otpStore = createPendingOperationStore({
      backend: 'jwt', // Explicitly use JWT backend for stateless OTP tokens
      jwtSecret: this.config.jwtSecret,
      defaultExpiration: `${this.config.otpExpiryMinutes}m`,
    });
  }
  
  /**
   * Send OTP to user
   * Returns OTP token (JWT) with OTP code embedded in metadata
   */
  async sendOTP(input: SendOTPInput): Promise<OTPResponse> {
    try {
      // Check if channel is available
      if (!this.otpProviders.isChannelAvailable(input.channel)) {
        return {
          success: false,
          message: `OTP channel '${input.channel}' is not configured`,
        };
      }
      
      let code = generateOTP(this.config.otpLength);
      // @TODO: Remove this after testing
      code = '000000'; // Test OTP - replace with generateOTP(this.config.otpLength) in production
      const hashedCode = await hashToken(code);
      
      // Store OTP in JWT token (unified pattern)
      const otpData = {
        userId: input.userId,
        tenantId: input.tenantId,
        recipient: input.recipient,
        channel: input.channel,
        purpose: input.purpose,
        otp: {
          hashedCode,
          channel: input.channel,
          recipient: input.recipient,
          purpose: input.purpose,
          createdAt: Date.now(),
          expiresIn: this.config.otpExpiryMinutes * 60 * 1000, // milliseconds
        },
      };
      
      // Create OTP token in PendingOperationStore (JWT-based)
      const otpToken = await this.otpStore.create(
        'otp_verification',
        otpData,
        {
          operationType: 'otp_verification',
          expiresIn: `${this.config.otpExpiryMinutes}m`,
        }
      );
      
      // Debug log: Output plain OTP code for testing
      logger.debug('OTP code (for testing)', {
        recipient: input.recipient,
        channel: input.channel,
        purpose: input.purpose,
        otpCode: code,
        otpToken: otpToken.substring(0, 50) + '...',
      });
      
      // Send OTP via notification service
      // TODO: Uncomment when providers are configured
      // try {
      //   const provider = this.otpProviders.getProvider(input.channel);
      //   await provider.send(input.recipient, code, input.purpose, input.tenantId, input.userId);
      //   logger.info('OTP sent', { 
      //     recipient: input.recipient, 
      //     channel: input.channel, 
      //     purpose: input.purpose 
      //   });
      // } catch (sendError) {
      //   logger.warn('Failed to send OTP via provider (token stored in JWT)', { 
      //     error: sendError,
      //     recipient: input.recipient,
      //   });
      // }
      
      return {
        success: true,
        message: 'OTP sent successfully',
        otpSentTo: input.recipient,
        channel: input.channel,
        expiresIn: this.config.otpExpiryMinutes * 60,
        otpToken, // Return JWT token with OTP embedded
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
   * Requires otpToken (JWT) from sendOTP response + code
   */
  async verifyOTP(input: VerifyOTPInput): Promise<OTPResponse> {
    try {
      if (!input.otpToken) {
        return {
          success: false,
          message: 'OTP token is required. Please use the token from sendOTP response.',
        };
      }
      
      // Use JWT-based verification (unified pattern)
      const operation = await this.otpStore.verify<{
        userId?: string;
        tenantId: string;
        recipient: string;
        channel: string;
        purpose: string;
        otp: {
          hashedCode: string;
          createdAt: number;
          expiresIn: number;
        };
      }>(input.otpToken, 'otp_verification');
      
      if (!operation) {
        return {
          success: false,
          message: 'Invalid or expired OTP token',
        };
      }
      
      const otpData = operation.data;
      
      // Verify tenant matches
      if (otpData.tenantId !== input.tenantId) {
        return {
          success: false,
          message: 'Tenant mismatch',
        };
      }
      
      // Check OTP expiration
      const now = Date.now();
      const otpAge = now - otpData.otp.createdAt;
      if (otpAge > otpData.otp.expiresIn) {
        return {
          success: false,
          message: 'OTP has expired',
        };
      }
      
      // Verify OTP code
      const hashedCode = await hashToken(input.code);
      if (otpData.otp.hashedCode !== hashedCode) {
        return {
          success: false,
          message: 'Invalid OTP code',
        };
      }
      
      // Update user verification status if applicable
      if (otpData.userId) {
        await this.updateUserVerificationStatus(otpData);
      }
      
      logger.info('OTP verified', { 
        recipient: otpData.recipient, 
        purpose: otpData.purpose 
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
  private async updateUserVerificationStatus(otpData: {
    userId?: string;
    purpose: string;
  }): Promise<void> {
    if (!otpData.userId) return;
    
    const database = await db.getDb();
    const update: any = { updatedAt: new Date() };
    
    if (otpData.purpose === 'email_verification') {
      update.emailVerified = true;
      update.status = 'active';
    } else if (otpData.purpose === 'phone_verification') {
      update.phoneVerified = true;
      update.status = 'active';
    }
    
    if (Object.keys(update).length > 1) {
      await database.collection('users').updateOne(
        { id: otpData.userId },
        { $set: update }
      );
      
      logger.info('User verification status updated', { 
        userId: otpData.userId, 
        purpose: otpData.purpose 
      });
    }
  }
  
  /**
   * Resend OTP (with rate limiting)
   * Requires otpToken from previous sendOTP response
   */
  async resendOTP(recipient: string, purpose: string, tenantId: string, otpToken: string): Promise<OTPResponse> {
    if (!otpToken) {
      return {
        success: false,
        message: 'OTP token is required for resending OTP',
      };
    }
    
    // Extract channel/userId from otpToken
    {
      const operation = await this.otpStore.verify<{
        userId?: string;
        channel: string;
      }>(otpToken, 'otp_verification');
      
      if (operation) {
        // Check if can resend (must wait at least 60 seconds)
        const timeSinceCreation = Date.now() - operation.createdAt;
        if (timeSinceCreation < 60 * 1000) {
          return {
            success: false,
            message: 'Please wait before requesting a new OTP',
          };
        }
        
        // Send new OTP
        return this.sendOTP({
          tenantId,
          recipient,
          channel: operation.data.channel as OTPChannel,
          purpose: purpose as OTPPurpose,
          userId: operation.data.userId,
        });
      }
    }
    
    // Fallback: send new OTP (will create new token)
    return this.sendOTP({
      tenantId,
      recipient,
      channel: 'email', // Default - should be determined from context
      purpose: purpose as OTPPurpose,
    });
  }
}
