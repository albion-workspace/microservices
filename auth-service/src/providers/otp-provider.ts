/**
 * OTP Provider - Uses Notification Service
 * All OTPs are sent via the notification service
 */

import type { AuthConfig } from '../config.js';
import type { OTPChannel } from '../types.js';
import { logger } from 'core-service';
import { getAuthConfig } from '../config.js';

// ═══════════════════════════════════════════════════════════════════
// Base OTP Provider Interface
// ═══════════════════════════════════════════════════════════════════

export interface IOTPProvider {
  send(recipient: string, code: string, purpose: string, tenantId: string, userId?: string): Promise<void>;
  channel: OTPChannel;
}

// ═══════════════════════════════════════════════════════════════════
// Notification Service Client
// ═══════════════════════════════════════════════════════════════════

function getNotificationServiceUrl(): string {
  return getAuthConfig().notificationServiceUrl || 'http://localhost:9004/graphql';
}

/**
 * Send notification via notification service GraphQL API
 */
async function sendViaNotificationService(
  channel: 'email' | 'sms' | 'whatsapp',
  recipient: string,
  subject: string | null,
  body: string,
  html: string | null,
  tenantId: string,
  userId?: string,
  priority: 'low' | 'normal' | 'high' | 'urgent' = 'high'
): Promise<void> {
  const channelUpper = channel.toUpperCase() as 'EMAIL' | 'SMS' | 'WHATSAPP';
  
  const mutation = `
    mutation SendNotification($input: SendNotificationInput!) {
      sendNotification(input: $input) {
        success
        message
        notificationId
        status
      }
    }
  `;

  const variables = {
    input: {
      userId: userId || null,
      tenantId,
      channel: channelUpper,
      priority: priority.toUpperCase(),
      to: recipient,
      subject: subject || null,
      body,
      html: html || null,
    },
  };

  try {
    const authConfig = getAuthConfig();
    const notificationUrl = getNotificationServiceUrl();
    const token = authConfig.notificationServiceToken;
    const response = await fetch(notificationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const result = await response.json() as {
      errors?: Array<{ message?: string }>;
      data?: {
        sendNotification?: {
          success?: boolean;
          message?: string;
        };
      };
    };

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Notification service error');
    }

    if (!result.data?.sendNotification?.success) {
      throw new Error(result.data?.sendNotification?.message || 'Failed to send notification');
    }

    logger.info('OTP sent via notification service', { recipient, channel, purpose: 'otp' });
  } catch (error: any) {
    logger.error('Failed to send OTP via notification service', { 
      error: error.message, 
      recipient, 
      channel 
    });
    
    // In development, log the OTP instead of failing
    if (getAuthConfig().nodeEnv === 'development') {
      logger.warn('OTP (dev mode - notification service unavailable)', { 
        recipient, 
        code: body.match(/\d{4,8}/)?.[0] || 'N/A',
        channel 
      });
      return;
    }
    
    throw new Error(`Failed to send OTP: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Email Provider
// ═══════════════════════════════════════════════════════════════════

export class EmailOTPProvider implements IOTPProvider {
  channel: OTPChannel = 'email';
  
  constructor(config: AuthConfig) {
    // No longer needs SMTP config - uses notification service
    logger.info('Email OTP provider initialized (using notification service)');
  }
  
  async send(recipient: string, code: string, purpose: string, tenantId: string, userId?: string): Promise<void> {
    const subject = this.getSubject(purpose);
    const html = this.getEmailTemplate(code, purpose);
    const text = `Your verification code is: ${code}`;
    
    await sendViaNotificationService(
      'email',
      recipient,
      subject,
      text,
      html,
      tenantId,
      userId,
      'high'
    );
  }
  
  private getSubject(purpose: string): string {
    const subjects: Record<string, string> = {
      registration: 'Welcome! Verify Your Account',
      login: 'Your Login Verification Code',
      password_reset: 'Password Reset Request',
      email_verification: 'Verify Your Email Address',
      phone_verification: 'Phone Verification Code',
      '2fa': 'Two-Factor Authentication Code',
    };
    
    return subjects[purpose] || 'Your Verification Code';
  }
  
  private getEmailTemplate(code: string, purpose: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .code { background: #fff; border: 2px dashed #667eea; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 5px; color: #667eea; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Verification Code</h1>
            </div>
            <div class="content">
              <p>Hello,</p>
              <p>Your verification code for <strong>${purpose.replace(/_/g, ' ')}</strong> is:</p>
              <div class="code">${code}</div>
              <p>This code will expire in 10 minutes.</p>
              <div class="warning">
                <strong>⚠️ Security Notice:</strong> Never share this code with anyone. Our team will never ask for this code.
              </div>
              <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
            </div>
            <div class="footer">
              <p>This is an automated message, please do not reply.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SMS Provider
// ═══════════════════════════════════════════════════════════════════

export class SMSOTPProvider implements IOTPProvider {
  channel: OTPChannel = 'sms';
  
  constructor(config: AuthConfig) {
    // No longer needs Twilio config - uses notification service
    logger.info('SMS OTP provider initialized (using notification service)');
  }
  
  async send(recipient: string, code: string, purpose: string, tenantId: string, userId?: string): Promise<void> {
    const message = this.getSMSMessage(code, purpose);
    
    await sendViaNotificationService(
      'sms',
      recipient,
      null,
      message,
      null,
      tenantId,
      userId,
      'high'
    );
  }
  
  private getSMSMessage(code: string, purpose: string): string {
    return `Your verification code for ${purpose.replace(/_/g, ' ')} is: ${code}. Valid for 10 minutes. Do not share this code.`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// WhatsApp Provider
// ═══════════════════════════════════════════════════════════════════

export class WhatsAppOTPProvider implements IOTPProvider {
  channel: OTPChannel = 'whatsapp';
  
  constructor(config: AuthConfig) {
    // No longer needs Twilio config - uses notification service
    logger.info('WhatsApp OTP provider initialized (using notification service)');
  }
  
  async send(recipient: string, code: string, purpose: string, tenantId: string, userId?: string): Promise<void> {
    const message = this.getWhatsAppMessage(code, purpose);
    
    await sendViaNotificationService(
      'whatsapp',
      recipient,
      null,
      message,
      null,
      tenantId,
      userId,
      'high'
    );
  }
  
  private getWhatsAppMessage(code: string, purpose: string): string {
    return `🔐 *Verification Code*\n\nYour code for ${purpose.replace(/_/g, ' ')} is:\n\n*${code}*\n\nValid for 10 minutes.\n⚠️ Never share this code with anyone.`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Telegram Provider (still uses Telegram API directly)
// ═══════════════════════════════════════════════════════════════════

export class TelegramOTPProvider implements IOTPProvider {
  channel: OTPChannel = 'telegram';
  private botToken: string;
  private apiUrl: string;
  
  constructor(config: AuthConfig) {
    if (!config.telegramBotToken) {
      throw new Error('Telegram OTP provider requires bot token');
    }
    
    this.botToken = config.telegramBotToken;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }
  
  async send(recipient: string, code: string, purpose: string, tenantId: string, userId?: string): Promise<void> {
    // Telegram still uses its own API (not via notification service)
    const message = this.getTelegramMessage(code, purpose);
    
    try {
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: recipient,
          text: message,
          parse_mode: 'Markdown',
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.statusText}`);
      }
      
      logger.info('Telegram OTP sent', { recipient, purpose });
    } catch (error) {
      logger.error('Failed to send Telegram OTP', { error, recipient });
      throw new Error('Failed to send Telegram OTP');
    }
  }
  
  private getTelegramMessage(code: string, purpose: string): string {
    return `🔐 *Verification Code*\n\nYour code for ${purpose.replace(/_/g, ' ')} is:\n\n\`${code}\`\n\nValid for 10 minutes.\n⚠️ Never share this code with anyone.`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// OTP Provider Factory
// ═══════════════════════════════════════════════════════════════════

export class OTPProviderFactory {
  private providers: Map<OTPChannel, IOTPProvider>;
  
  constructor(config: AuthConfig) {
    this.providers = new Map();
    
    // Email provider - always available (uses notification service)
    try {
      this.providers.set('email', new EmailOTPProvider(config));
      logger.info('Email OTP provider available (via notification service)');
    } catch (err) {
      logger.warn('Email OTP provider not available', { error: (err as Error).message });
    }
    
    // SMS provider - always available (uses notification service)
    try {
      this.providers.set('sms', new SMSOTPProvider(config));
      logger.info('SMS OTP provider available (via notification service)');
    } catch (err) {
      logger.warn('SMS OTP provider not available', { error: (err as Error).message });
    }
    
    // WhatsApp provider - always available (uses notification service)
    try {
      this.providers.set('whatsapp', new WhatsAppOTPProvider(config));
      logger.info('WhatsApp OTP provider available (via notification service)');
    } catch (err) {
      logger.warn('WhatsApp OTP provider not available', { error: (err as Error).message });
    }
    
    // Telegram provider (still uses Telegram API directly)
    try {
      this.providers.set('telegram', new TelegramOTPProvider(config));
      logger.info('Telegram OTP provider available');
    } catch (err) {
      logger.warn('Telegram OTP provider not configured', { error: (err as Error).message });
    }
  }
  
  getProvider(channel: OTPChannel): IOTPProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new Error(`OTP provider for channel '${channel}' not configured`);
    }
    return provider;
  }
  
  isChannelAvailable(channel: OTPChannel): boolean {
    return this.providers.has(channel);
  }
  
  getAvailableChannels(): OTPChannel[] {
    return Array.from(this.providers.keys());
  }
}
