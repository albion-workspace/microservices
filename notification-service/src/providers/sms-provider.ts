/**
 * SMS Provider using Twilio
 */

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { logger, generateId, createServiceError } from 'core-service';
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
      throw createServiceError('notification', 'SMSProviderNotConfigured', {});
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
          id: generateId(),
          status: 'sent',
          channel: 'sms',
          sentAt: new Date(),
          providerMessageId: message.sid,
        });
      } catch (error: any) {
        throw createServiceError('notification', 'FailedToSendSMS', {
          to,
          error: error.message,
        });
      }
    }
    
    // Return first result (or aggregate if needed)
    return results[0];
  }
}
