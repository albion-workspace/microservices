/**
 * Notification Service Core
 * 
 * Manages all notification channels and providers
 */

import { logger, updateOneById, generateMongoId, GraphQLError } from 'core-service';
import { db } from './accessors.js';
import { NOTIFICATION_ERRORS } from './error-codes.js';
import type { 
  NotificationRequest, 
  NotificationResponse, 
  NotificationProvider,
  NotificationChannel,
  NotificationConfig,
} from './types.js';
import type { UnifiedRealtimeProvider } from './providers/realtime-interface.js';
import { NotificationProviderFactory } from './providers/provider-factory.js';
import type { 
  EmailProvider, 
  SmsProvider, 
  WhatsAppProvider,
  SseProvider,
  SocketProvider,
} from './providers/index.js';

export class NotificationService {
  private providers: Map<NotificationChannel, NotificationProvider> = new Map();
  private emailProvider?: EmailProvider;
  private smsProvider?: SmsProvider;
  private whatsappProvider?: WhatsAppProvider;
  private sseProvider: SseProvider;
  private socketProvider: SocketProvider;
  private gateway: { 
    broadcast: { 
      toUser: (userId: string, event: string, data: unknown) => void;
      toTenant: (tenantId: string, event: string, data: unknown) => void;
      (event: string, data: unknown, room?: string): void;
    }; 
    sse: { 
      pushToUser: (userId: string, event: string, data: unknown) => void;
      pushToTenant: (tenantId: string, event: string, data: unknown) => void;
      push: (event: string, data: unknown) => void;
      getConnectionCount: () => number;
    };
    io?: any;
  } | null = null;
  
  constructor(private config: NotificationConfig) {
    // Use Factory Method pattern to create and register providers
    // This eliminates repetitive if/else blocks and makes it easy to add new providers
    this.providers = NotificationProviderFactory.createProviders(config);
    
    // Store provider references for direct access (backward compatibility)
    // These are already in the providers Map, but we keep references for convenience
    // SSE and Socket are required providers, so they're always available
    const sseProvider = this.providers.get('sse');
    const socketProvider = this.providers.get('socket');
    
    if (!sseProvider || !socketProvider) {
      throw new GraphQLError(NOTIFICATION_ERRORS.RequiredProvidersFailedToInitialize, {});
    }
    
    this.sseProvider = sseProvider as SseProvider;
    this.socketProvider = socketProvider as SocketProvider;
    this.emailProvider = this.providers.get('email') as EmailProvider | undefined;
    this.smsProvider = this.providers.get('sms') as SmsProvider | undefined;
    this.whatsappProvider = this.providers.get('whatsapp') as WhatsAppProvider | undefined;
  }
  
  /**
   * Initialize Socket.IO (call after gateway starts)
   */
  initializeSocket(): void {
    this.socketProvider.initialize();
  }
  
  /**
   * Set gateway instance for direct Socket.IO and SSE broadcasting
   */
  setGateway(gateway: { 
    broadcast: { 
      toUser: (userId: string, event: string, data: unknown) => void;
      toTenant: (tenantId: string, event: string, data: unknown) => void;
      (event: string, data: unknown, room?: string): void;
    }; 
    sse: { 
      pushToUser: (userId: string, event: string, data: unknown) => void;
      pushToTenant: (tenantId: string, event: string, data: unknown) => void;
      push: (event: string, data: unknown) => void;
      getConnectionCount: () => number;
    };
    io?: any; // Socket.IO server instance
  }): void {
    this.gateway = gateway;
    // Update providers with gateway reference
    // SSE and Socket providers are always available (required providers)
    if (this.socketProvider.setGateway) {
      this.socketProvider.setGateway(gateway.broadcast, gateway.io);
    }
    if (this.sseProvider.setGateway) {
      this.sseProvider.setGateway(gateway.sse);
    }
  }
  
  /**
   * Get unified real-time provider for a channel
   */
  getRealtimeProvider(channel: 'sse' | 'socket'): UnifiedRealtimeProvider | null {
    if (channel === 'sse') {
      return this.sseProvider;
    } else if (channel === 'socket') {
      return this.socketProvider;
    }
    return null;
  }
  
  /**
   * Broadcast to all users via specified channel
   */
  broadcastToAll(channel: 'sse' | 'socket', event: string, data: unknown): void {
    const provider = this.getRealtimeProvider(channel);
    if (provider) {
      provider.getBroadcast().toAll(event, data);
    }
  }
  
  /**
   * Broadcast to tenant via specified channel
   */
  broadcastToTenant(channel: 'sse' | 'socket', tenantId: string, event: string, data: unknown): void {
    const provider = this.getRealtimeProvider(channel);
    if (provider) {
      provider.getBroadcast().toTenant(tenantId, event, data);
    }
  }
  
  /**
   * Broadcast to user via specified channel
   */
  broadcastToUser(channel: 'sse' | 'socket', userId: string, event: string, data: unknown): void {
    const provider = this.getRealtimeProvider(channel);
    if (provider) {
      provider.getBroadcast().toUser(userId, event, data);
    }
  }
  
  /**
   * Broadcast to room (Socket.IO only)
   */
  broadcastToRoom(room: string, event: string, data: unknown): void {
    const provider = this.getRealtimeProvider('socket');
    if (provider) {
      provider.getBroadcast().toRoom(room, event, data);
    }
  }
  
  /**
   * Send notification via specified channel
   */
  async send(request: NotificationRequest): Promise<NotificationResponse> {
    const database = await db.getDb();
    
    // Validate channel is provided
    if (!request.channel) {
      throw new Error('Channel is required');
    }
    
    // Ensure channel is lowercase for consistency
    const channel = request.channel.toLowerCase() as NotificationChannel;
    
    logger.info('NotificationService.send called', {
      originalChannel: request.channel,
      normalizedChannel: channel,
      availableChannels: Array.from(this.providers.keys()),
    });
    
    try {
      const provider = this.providers.get(channel);
      
      if (!provider) {
        throw new GraphQLError(NOTIFICATION_ERRORS.ProviderNotConfigured, { channel });
      }
      
      // Update request with normalized channel
      const normalizedRequest = {
        ...request,
        channel,
      };
      
      // Save notification request to database - use MongoDB ObjectId for performant single-insert operation
      const { objectId, idString } = request.id 
        ? { objectId: null as any, idString: request.id } // Use provided ID if exists
        : generateMongoId();
      const notification = {
        ...(objectId && { _id: objectId }),
        id: idString,
        ...normalizedRequest,
        status: 'queued',
        createdAt: new Date(),
      };
      
      await database.collection('notifications').insertOne(notification as any);
      
      // Send via provider
      const result = await provider.send(normalizedRequest as any);
      
      // Use optimized updateOneById utility (performance-optimized)
      await updateOneById(
        database.collection('notifications'),
        notification.id,
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
        channel: channel,
        status: result.status,
      });
      
      return result;
      
    } catch (error: any) {
      throw new GraphQLError(NOTIFICATION_ERRORS.FailedToSendNotification, {
        error: error.message,
        originalChannel: request.channel,
        normalizedChannel: channel,
        availableChannels: Array.from(this.providers.keys()),
      });
      
      const idString = request.id || generateMongoId().idString;
      return {
        id: idString,
        status: 'failed',
        channel: channel,
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
