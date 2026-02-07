/**
 * Notification Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * NotificationConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import { logger, loadBaseServiceConfig, getBaseServiceConfigDefaults, getServiceConfigKey, configKeyOpts } from 'core-service';
import type { NotificationConfig } from './types.js';

export type { NotificationConfig };

export const SERVICE_NAME = 'notification-service';

export async function loadConfig(brand?: string, tenantId?: string): Promise<NotificationConfig> {
  const base = await loadBaseServiceConfig(SERVICE_NAME, getBaseServiceConfigDefaults({ port: 9004, serviceName: SERVICE_NAME }), { brand, tenantId });
  const opts = configKeyOpts(brand, tenantId);
  const smtpConfig = await getServiceConfigKey<{ host: string; port: number; user: string; password: string; from: string; secure: boolean }>(
    SERVICE_NAME, 'smtp',
    { host: '', port: 587, user: '', password: '', from: 'noreply@example.com', secure: false },
    opts
  );
  const twilioConfig = await getServiceConfigKey<{ accountSid: string; authToken: string; phoneNumber: string; whatsappNumber: string }>(
    SERVICE_NAME, 'twilio',
    { accountSid: '', authToken: '', phoneNumber: '', whatsappNumber: '' },
    opts
  );
  const pushConfig = await getServiceConfigKey<{ apiKey: string; projectId: string }>(
    SERVICE_NAME, 'push', { apiKey: '', projectId: '' },
    opts
  );
  const queueConfig = await getServiceConfigKey<{ concurrency: number; maxRetries: number; retryDelay: number }>(
    SERVICE_NAME, 'queue', { concurrency: 5, maxRetries: 3, retryDelay: 5000 },
    opts
  );
  const realtimeConfig = await getServiceConfigKey<{ sseHeartbeatInterval: number; socketNamespace: string }>(
    SERVICE_NAME, 'realtime', { sseHeartbeatInterval: 30000, socketNamespace: '/notifications' },
    opts
  );

  return {
    ...base,
    smtpHost: smtpConfig.host || undefined,
    smtpPort: smtpConfig.port,
    smtpUser: smtpConfig.user || undefined,
    smtpPassword: smtpConfig.password || undefined,
    smtpFrom: smtpConfig.from,
    smtpSecure: smtpConfig.secure,
    twilioAccountSid: twilioConfig.accountSid || undefined,
    twilioAuthToken: twilioConfig.authToken || undefined,
    twilioPhoneNumber: twilioConfig.phoneNumber || undefined,
    twilioWhatsAppNumber: twilioConfig.whatsappNumber || undefined,
    pushProviderApiKey: pushConfig.apiKey || undefined,
    pushProviderProjectId: pushConfig.projectId || undefined,
    queueConcurrency: queueConfig.concurrency,
    queueMaxRetries: queueConfig.maxRetries,
    queueRetryDelay: queueConfig.retryDelay,
    sseHeartbeatInterval: realtimeConfig.sseHeartbeatInterval,
    socketNamespace: realtimeConfig.socketNamespace,
  };
}

export function validateConfig(config: NotificationConfig): void {
  const errors: string[] = [];

  if (!config.port || config.port < 1 || config.port > 65535) {
    errors.push('Port must be between 1 and 65535');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  if (!config.smtpHost) {
    logger.warn('SMTP not configured - Email notifications disabled');
  }
  if (!config.twilioAccountSid) {
    logger.warn('Twilio not configured - SMS/WhatsApp notifications disabled');
  }
  if (!config.pushProviderApiKey) {
    logger.warn('Push provider not configured - Push notifications disabled');
  }
}

export function printConfigSummary(config: NotificationConfig): void {
  logger.info('Configuration:', {
    Port: config.port,
    serviceName: config.serviceName,
    MongoDB: config.mongoUri || 'from gateway',
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
