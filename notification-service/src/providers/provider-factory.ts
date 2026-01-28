/**
 * Notification Provider Factory (Factory Method Pattern)
 * 
 * Simplifies provider creation and registration.
 * Eliminates repetitive if/else blocks and makes it easy to add new providers.
 */

import { logger } from 'core-service';
import type { NotificationProvider, NotificationChannel, NotificationConfig } from '../types.js';
import { EmailProvider } from './email-provider.js';
import { SmsProvider } from './sms-provider.js';
import { WhatsAppProvider } from './whatsapp-provider.js';
import { SseProvider } from './sse-provider.js';
import { SocketProvider } from './socket-provider.js';

/**
 * Provider configuration for factory
 */
interface ProviderConfig {
  channel: NotificationChannel;
  factory: (config: NotificationConfig) => NotificationProvider;
  required: boolean; // Always register (e.g., SSE, Socket) vs conditional (Email, SMS)
}

/**
 * Notification Provider Factory
 * 
 * Creates and registers providers based on configuration.
 * Uses Factory Method pattern to encapsulate provider creation logic.
 */
export class NotificationProviderFactory {
  /**
   * Create and register all configured providers
   * 
   * @param config - Notification service configuration
   * @returns Map of channel -> provider instances
   */
  static createProviders(config: NotificationConfig): Map<NotificationChannel, NotificationProvider> {
    const providers = new Map<NotificationChannel, NotificationProvider>();
    
    // Provider configurations with factory methods
    // Strategy Pattern: Each provider has its own creation strategy
    const providerConfigs: ProviderConfig[] = [
      {
        channel: 'sse',
        factory: () => new SseProvider(),
        required: true, // SSE is always available
      },
      {
        channel: 'socket',
        factory: (cfg) => new SocketProvider(cfg),
        required: true, // Socket.IO is always available
      },
      {
        channel: 'email',
        factory: (cfg) => new EmailProvider(cfg),
        required: false, // Requires SMTP configuration
      },
      {
        channel: 'sms',
        factory: (cfg) => new SmsProvider(cfg),
        required: false, // Requires Twilio configuration
      },
      {
        channel: 'whatsapp',
        factory: (cfg) => new WhatsAppProvider(cfg),
        required: false, // Requires Twilio configuration
      },
    ];
    
    // Create and register providers
    for (const { channel, factory, required } of providerConfigs) {
      const provider = factory(config);
      
      // Register if required or if provider is configured
      if (required || provider.isConfigured()) {
        providers.set(channel, provider);
        logger.info(`${channel} provider registered`, { 
          configured: provider.isConfigured(),
          required,
        });
      } else {
        logger.warn(`${channel} provider not registered - not configured`, {
          channel,
          required,
        });
      }
    }
    
    logger.info('Notification providers initialized', {
      providers: Array.from(providers.keys()),
      total: providers.size,
    });
    
    return providers;
  }
  
  /**
   * Create a single provider by channel
   * Useful for testing or dynamic provider creation
   */
  static createProvider(
    channel: NotificationChannel,
    config: NotificationConfig
  ): NotificationProvider | null {
    // Map channel to provider config (using Map to avoid Record type issues)
    const providerConfigMap = new Map<NotificationChannel, ProviderConfig>([
      ['sse', { channel: 'sse', factory: () => new SseProvider(), required: true }],
      ['socket', { channel: 'socket', factory: (cfg) => new SocketProvider(cfg), required: true }],
      ['email', { channel: 'email', factory: (cfg) => new EmailProvider(cfg), required: false }],
      ['sms', { channel: 'sms', factory: (cfg) => new SmsProvider(cfg), required: false }],
      ['whatsapp', { channel: 'whatsapp', factory: (cfg) => new WhatsAppProvider(cfg), required: false }],
    ]);
    
    const configItem = providerConfigMap.get(channel);
    if (!configItem) {
      logger.warn('Unknown notification channel', { channel });
      return null;
    }
    
    const provider = configItem.factory(config);
    
    if (configItem.required || provider.isConfigured()) {
      return provider;
    }
    
    return null;
  }
}
