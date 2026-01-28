/**
 * Notification Service Configuration
 */

import { logger } from 'core-service';
import type { NotificationConfig } from './types.js';

export function loadConfig(): NotificationConfig {
  return {
    // Service
    port: parseInt(process.env.PORT || '3006'),
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // Database
    // Note: When connecting from localhost, directConnection=true prevents replica set member discovery
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/notification_service?directConnection=true',
    // Redis password: default is redis123 (from Docker container), can be overridden via REDIS_PASSWORD env var
    redisUrl: process.env.REDIS_URL || `redis://:${process.env.REDIS_PASSWORD || 'redis123'}@localhost:6379`,
    
    // SMTP (Email)
    smtpHost: process.env.SMTP_HOST,
    smtpPort: parseInt(process.env.SMTP_PORT || '587'),
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    smtpFrom: process.env.SMTP_FROM || 'noreply@example.com',
    smtpSecure: process.env.SMTP_SECURE === 'true',
    
    // Twilio (SMS/WhatsApp)
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
    twilioWhatsAppNumber: process.env.TWILIO_WHATSAPP_NUMBER,
    
    // Push Notifications
    pushProviderApiKey: process.env.PUSH_PROVIDER_API_KEY,
    pushProviderProjectId: process.env.PUSH_PROVIDER_PROJECT_ID,
    
    // Queue
    queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
    queueMaxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3'),
    queueRetryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '5000'),
    
    // Real-time
    sseHeartbeatInterval: parseInt(process.env.SSE_HEARTBEAT_INTERVAL || '30000'),
    socketNamespace: process.env.SOCKET_NAMESPACE || '/notifications',
  };
}

export function validateConfig(config: NotificationConfig): void {
  const errors: string[] = [];
  
  if (!config.mongoUri) {
    errors.push('MONGO_URI is required');
  }
  
  // Warn about missing providers
  if (!config.smtpHost) {
    logger.warn('SMTP not configured - Email notifications disabled');
  }
  
  if (!config.twilioAccountSid) {
    logger.warn('Twilio not configured - SMS/WhatsApp notifications disabled');
  }
  
  if (!config.pushProviderApiKey) {
    logger.warn('Push provider not configured - Push notifications disabled');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export function printConfigSummary(config: NotificationConfig): void {
  logger.info('Configuration:', {
    Port: config.port,
    MongoDB: config.mongoUri,
    Redis: config.redisUrl || 'not configured',
  });
  
  const availableChannels = [
    config.smtpHost && 'Email (SMTP)',
    config.twilioAccountSid && 'SMS (Twilio)',
    config.twilioWhatsAppNumber && 'WhatsApp (Twilio)',
    config.pushProviderApiKey && 'Push Notifications',
    'SSE (Server-Sent Events)',
    'Socket.IO (Real-time)',
  ].filter(Boolean);
  
  logger.info('Available Channels:', { channels: availableChannels });
}
