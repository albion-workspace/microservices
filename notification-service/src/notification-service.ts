/**
 * Notification Service Core
 * 
 * Manages all notification channels and providers
 */

import { logger, getDatabase } from 'core-service';
import type { 
  NotificationRequest, 
  NotificationResponse, 
  NotificationProvider,
  NotificationChannel,
  NotificationConfig,
} from './types.js';
import { 
  EmailProvider, 
  SmsProvider, 
  WhatsAppProvider,
  SseProvider,
  SocketProvider,
} from './providers/index.js';

export class NotificationService {
  private providers: Map<NotificationChannel, NotificationProvider> = new Map();
  private emailProvider: EmailProvider;
  private smsProvider: SmsProvider;
  private whatsappProvider: WhatsAppProvider;
  private sseProvider: SseProvider;
  private socketProvider: SocketProvider;
  
  constructor(private config: NotificationConfig) {
    // Initialize all providers
    this.emailProvider = new EmailProvider(config);
    this.smsProvider = new SmsProvider(config);
    this.whatsappProvider = new WhatsAppProvider(config);
    this.sseProvider = new SseProvider();
    this.socketProvider = new SocketProvider(config);
    
    // Register configured providers
    if (this.emailProvider.isConfigured()) {
      this.providers.set('email', this.emailProvider);
    }
    if (this.smsProvider.isConfigured()) {
      this.providers.set('sms', this.smsProvider);
    }
    if (this.whatsappProvider.isConfigured()) {
      this.providers.set('whatsapp', this.whatsappProvider);
    }
    this.providers.set('sse', this.sseProvider);
    this.providers.set('socket', this.socketProvider);
    
    logger.info('Notification service initialized', {
      providers: Array.from(this.providers.keys()),
    });
  }
  
  /**
   * Initialize Socket.IO (call after gateway starts)
   */
  initializeSocket(): void {
    this.socketProvider.initialize();
  }
  
  /**
   * Send notification via specified channel
   */
  async send(request: NotificationRequest): Promise<NotificationResponse> {
    const db = getDatabase();
    
    try {
      const provider = this.providers.get(request.channel);
      
      if (!provider) {
        throw new Error(`Provider not configured for channel: ${request.channel}`);
      }
      
      // Save notification request to database
      const notification = {
        id: request.id || crypto.randomUUID(),
        ...request,
        status: 'queued',
        createdAt: new Date(),
      };
      
      await db.collection('notifications').insertOne(notification);
      
      // Send via provider
      const result = await provider.send(request as any);
      
      // Update status in database
      await db.collection('notifications').updateOne(
        { id: notification.id },
        {
          $set: {
            status: result.status,
            sentAt: result.sentAt,
            deliveredAt: result.deliveredAt,
            error: result.error,
            providerMessageId: result.providerMessageId,
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('Notification sent', {
        id: notification.id,
        channel: request.channel,
        status: result.status,
      });
      
      return result;
      
    } catch (error: any) {
      logger.error('Failed to send notification', {
        error: error.message,
        channel: request.channel,
      });
      
      return {
        id: request.id || crypto.randomUUID(),
        status: 'failed',
        channel: request.channel,
        error: error.message,
      };
    }
  }
  
  /**
   * Send to multiple channels (broadcast)
   */
  async sendMultiChannel(
    request: Omit<NotificationRequest, 'channel'>,
    channels: NotificationChannel[]
  ): Promise<NotificationResponse[]> {
    const results: NotificationResponse[] = [];
    
    for (const channel of channels) {
      const result = await this.send({
        ...request,
        channel,
      });
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Get available channels
   */
  getAvailableChannels(): NotificationChannel[] {
    return Array.from(this.providers.keys());
  }
  
  /**
   * Check if channel is available
   */
  isChannelAvailable(channel: NotificationChannel): boolean {
    return this.providers.has(channel);
  }
  
  /**
   * Get SSE provider for connection management
   */
  getSseProvider(): SseProvider {
    return this.sseProvider;
  }
  
  /**
   * Get Socket provider for connection management
   */
  getSocketProvider(): SocketProvider {
    return this.socketProvider;
  }
}
