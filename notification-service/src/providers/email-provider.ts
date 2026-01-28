/**
 * Email Provider using Nodemailer
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger, generateId, createServiceError } from 'core-service';
import type { NotificationProvider, EmailNotification, NotificationResponse, NotificationConfig } from '../types.js';

export class EmailProvider implements NotificationProvider {
  name = 'email';
  channel = 'email' as const;
  private transporter?: Transporter;
  
  constructor(private config: NotificationConfig) {
    if (this.isConfigured()) {
      this.transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: config.smtpUser ? {
          user: config.smtpUser,
          pass: config.smtpPassword,
        } : undefined,
      });
      
      logger.info('Email provider initialized', {
        host: config.smtpHost,
        port: config.smtpPort,
      });
    }
  }
  
  isConfigured(): boolean {
    return !!(this.config.smtpHost && this.config.smtpFrom);
  }
  
  async send(notification: EmailNotification): Promise<NotificationResponse> {
    if (!this.transporter) {
      throw createServiceError('notification', 'EmailProviderNotConfigured', {});
    }
    
    try {
      const result = await this.transporter.sendMail({
        from: notification.from || this.config.smtpFrom,
        to: Array.isArray(notification.to) ? notification.to.join(', ') : notification.to,
        cc: notification.cc?.join(', '),
        bcc: notification.bcc?.join(', '),
        replyTo: notification.replyTo,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
        attachments: notification.attachments,
      });
      
      logger.info('Email sent', {
        messageId: result.messageId,
        to: notification.to,
      });
      
      return {
        id: generateId(),
        status: 'sent',
        channel: 'email',
        sentAt: new Date(),
        providerMessageId: result.messageId,
      };
    } catch (error: any) {
      logger.error('Failed to send email', { error: error.message });
      
      return {
        id: generateId(),
        status: 'failed',
        channel: 'email',
        error: error.message,
      };
    }
  }
  
  async verify(): Promise<boolean> {
    if (!this.transporter) return false;
    
    try {
      await this.transporter.verify();
      logger.info('Email provider verified successfully');
      return true;
    } catch (error: any) {
      throw createServiceError('notification', 'EmailProviderVerificationFailed', {
        error: error.message,
      });
    }
  }
}
