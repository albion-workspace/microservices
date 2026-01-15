/**
 * SMS Provider using Twilio
 */

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { logger } from 'core-service';
import type { NotificationProvider, SmsNotification, NotificationResponse, NotificationConfig } from '../types.js';

export class SmsProvider implements NotificationProvider {
  name = 'sms';
  channel = 'sms' as const;
  private client?: Twilio;
  
  constructor(private config: NotificationConfig) {
    if (this.isConfigured()) {
      this.client = twilio(config.twilioAccountSid!, config.twilioAuthToken!);
      logger.info('SMS provider initialized');
    }
  }
  
  isConfigured(): boolean {
    return !!(
      this.config.twilioAccountSid &&
      this.config.twilioAuthToken &&
      this.config.twilioPhoneNumber
    );
  }
  
  async send(notification: SmsNotification): Promise<NotificationResponse> {
    if (!this.client) {
      throw new Error('SMS provider not configured');
    }
    
    const recipients = Array.isArray(notification.to) ? notification.to : [notification.to];
    const results: NotificationResponse[] = [];
    
    for (const to of recipients) {
      try {
        const message = await this.client.messages.create({
          from: notification.from || this.config.twilioPhoneNumber!,
          to,
          body: notification.body,
          mediaUrl: notification.mediaUrl,
        });
        
        logger.info('SMS sent', {
          sid: message.sid,
          to,
        });
        
        results.push({
          id: crypto.randomUUID(),
          status: 'sent',
          channel: 'sms',
          sentAt: new Date(),
          providerMessageId: message.sid,
        });
      } catch (error: any) {
        logger.error('Failed to send SMS', { error: error.message, to });
        
        results.push({
          id: crypto.randomUUID(),
          status: 'failed',
          channel: 'sms',
          error: error.message,
        });
      }
    }
    
    // Return first result (or aggregate if needed)
    return results[0];
  }
}
