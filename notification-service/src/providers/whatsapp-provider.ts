/**
 * WhatsApp Provider using Twilio
 */

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { logger, generateId } from 'core-service';
import type { NotificationProvider, WhatsAppNotification, NotificationResponse, NotificationConfig } from '../types.js';

export class WhatsAppProvider implements NotificationProvider {
  name = 'whatsapp';
  channel = 'whatsapp' as const;
  private client?: Twilio;
  
  constructor(private config: NotificationConfig) {
    if (this.isConfigured()) {
      this.client = twilio(config.twilioAccountSid!, config.twilioAuthToken!);
      logger.info('WhatsApp provider initialized');
    }
  }
  
  isConfigured(): boolean {
    return !!(
      this.config.twilioAccountSid &&
      this.config.twilioAuthToken &&
      this.config.twilioWhatsAppNumber
    );
  }
  
  async send(notification: WhatsAppNotification): Promise<NotificationResponse> {
    if (!this.client) {
      throw new Error('WhatsApp provider not configured');
    }
    
    const recipients = Array.isArray(notification.to) ? notification.to : [notification.to];
    const results: NotificationResponse[] = [];
    
    for (const to of recipients) {
      try {
        // Ensure phone number has whatsapp: prefix
        const whatsappTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
        const whatsappFrom = `whatsapp:${this.config.twilioWhatsAppNumber}`;
        
        const message = await this.client.messages.create({
          from: whatsappFrom,
          to: whatsappTo,
          body: notification.body,
          mediaUrl: notification.mediaUrl ? [notification.mediaUrl] : undefined,
        });
        
        logger.info('WhatsApp sent', {
          sid: message.sid,
          to,
        });
        
        results.push({
          id: generateId(),
          status: 'sent',
          channel: 'whatsapp',
          sentAt: new Date(),
          providerMessageId: message.sid,
        });
      } catch (error: any) {
        logger.error('Failed to send WhatsApp', { error: error.message, to });
        
        results.push({
          id: generateId(),
          status: 'failed',
          channel: 'whatsapp',
          error: error.message,
        });
      }
    }
    
    return results[0];
  }
}
