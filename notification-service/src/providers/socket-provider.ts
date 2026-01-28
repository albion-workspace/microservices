/**
 * Socket.IO Provider
 * 
 * Uses core-service's Socket.IO support for real-time bidirectional notifications
 * Socket.IO server is automatically created by createGateway() with enableSocketIO: true
 */

import { logger, emit, generateId, GraphQLError } from 'core-service';
import { NOTIFICATION_ERRORS } from '../error-codes.js';
import type { NotificationProvider, SocketNotification, NotificationResponse, NotificationConfig } from '../types.js';
import type { SocketIOBroadcast, UnifiedRealtimeProvider, SocketIOFeatures } from './realtime-interface.js';

export class SocketProvider implements NotificationProvider, UnifiedRealtimeProvider {
  name = 'socket';
  channel = 'socket' as const;
  private gatewayBroadcast: { 
    toUser: (userId: string, event: string, data: unknown) => void;
    toTenant: (tenantId: string, event: string, data: unknown) => void;
    (event: string, data: unknown, room?: string): void;
  } | null = null;
  private io: any = null; // Socket.IO server instance
  
  constructor(private config: NotificationConfig) {
    logger.info('Socket provider initialized');
  }
  
  isConfigured(): boolean {
    return true; // Socket.IO is always available from core-service
  }
  
  /**
   * Set gateway broadcast functions and Socket.IO instance for direct emission
   */
  setGateway(broadcast: { 
    toUser: (userId: string, event: string, data: unknown) => void;
    toTenant: (tenantId: string, event: string, data: unknown) => void;
    (event: string, data: unknown, room?: string): void;
  }, io?: any): void {
    this.gatewayBroadcast = broadcast;
    this.io = io;
    logger.info('Socket provider gateway set');
  }
  
  /**
   * Get unified broadcast interface
   */
  getBroadcast(): SocketIOBroadcast {
    return {
      type: 'socket',
      toUser: (userId: string, event: string, data: unknown) => {
        if (this.gatewayBroadcast) {
          this.gatewayBroadcast.toUser(userId, event, data);
        }
      },
      toTenant: (tenantId: string, event: string, data: unknown) => {
        if (this.gatewayBroadcast) {
          this.gatewayBroadcast.toTenant(tenantId, event, data);
        }
      },
      toAll: (event: string, data: unknown) => {
        if (this.gatewayBroadcast) {
          this.gatewayBroadcast(event, data);
        }
      },
      toRoom: (room: string, event: string, data: unknown) => {
        if (this.gatewayBroadcast) {
          this.gatewayBroadcast(event, data, room);
        }
      },
      getConnectionCount: () => {
        return this.io?.sockets?.sockets?.size || 0;
      },
      // Socket.IO specific features
      toUserWithAck: (userId: string, event: string, data: unknown, callback?: (response: unknown) => void) => {
        if (this.io) {
          this.io.to(`user:${userId}`).emit(event, data, callback);
        }
      },
      joinRoom: (userId: string, room: string) => {
        if (this.io) {
          this.io.to(`user:${userId}`).socketsJoin(room);
        }
      },
      leaveRoom: (userId: string, room: string) => {
        if (this.io) {
          this.io.to(`user:${userId}`).socketsLeave(room);
        }
      },
      getUserRooms: (userId: string): string[] => {
        // This would require tracking user rooms - simplified for now
        return [];
      },
    };
  }
  
  /**
   * Get Socket.IO specific features
   */
  getSocketIOFeatures(): SocketIOFeatures {
    return this.getBroadcast();
  }
  
  /**
   * Check if bidirectional
   */
  isBidirectional(): boolean {
    return true; // Socket.IO supports bidirectional communication
  }
  
  /**
   * Get provider type
   */
  getType(): 'socket' {
    return 'socket';
  }
  
  /**
   * Initialize Socket.IO (called after gateway starts)
   * 
   * Note: Socket.IO server is automatically created by createGateway()
   * when enableSocketIO: true is set. We just emit events that will
   * be broadcast to connected clients.
   */
  initialize(): void {
    logger.info('Socket.IO provider ready', {
      namespace: this.config.socketNamespace,
      note: 'Socket.IO server created by core-service gateway',
    });
  }
  
  /**
   * Send notification via Socket.IO
   * 
   * Uses Redis pub/sub via core-service to emit Socket.IO events.
   * Core-service's Socket.IO integration will broadcast these to connected clients.
   */
  async send(notification: SocketNotification): Promise<NotificationResponse> {
    try {
      // Extract notification data - ensure subject and body are included
      const notificationData = notification.data || {};
      const eventData = {
        id: notificationData.id,
        subject: notificationData.subject,
        body: notificationData.body || notificationData.message,
        channel: 'SOCKET',
        priority: notificationData.priority,
        userId: notification.userId,
        tenantId: notificationData.tenantId,
        ...notificationData,
      };
      
      const userId = Array.isArray(notification.userId)
        ? notification.userId[0]
        : notification.userId || 'system';
      
      // Use gateway broadcast directly if available (preferred method)
      if (this.gatewayBroadcast) {
        const eventName = notification.event || 'notification';
        
        // Route based on notification target
        if (notification.room) {
          this.gatewayBroadcast(eventName, eventData, notification.room);
          logger.info('Socket notification sent via gateway broadcast to room', {
            event: eventName,
            room: notification.room,
            eventData,
          });
        } else {
          const targetRoom = `user:${userId}`;
          this.gatewayBroadcast.toUser(userId, eventName, eventData);
          logger.info('Socket notification sent via gateway broadcast to user', {
            event: eventName,
            userId,
            targetRoom,
            eventData: JSON.stringify(eventData),
          });
        }
      } else {
        // Fallback: Emit via Redis (requires listener setup)
        await emit(
          'socket.io',
          'system',
          userId,
          eventData
        );
        
        // Also emit with custom event name if different
        if (notification.event && notification.event !== 'notification') {
          await emit(
            'socket.io',
            'system',
            userId,
            {
              event: notification.event,
              ...eventData,
            }
          );
        }
        logger.info('Socket notification queued via Redis', {
          event: notification.event,
          userId,
        });
      }
      
      logger.info('Socket notification queued', {
        event: notification.event,
        userId: notification.userId,
        room: notification.room,
      });
      
      return {
        id: generateId(),
        status: 'sent',
        channel: 'socket',
        sentAt: new Date(),
      };
    } catch (error: any) {
      throw new GraphQLError(NOTIFICATION_ERRORS.FailedToSendSocketNotification, {
        error: error.message,
      });
    }
  }
  
  /**
   * Get statistics (if needed in future)
   */
  async getStats(): Promise<{ message: string }> {
    return {
      message: 'Socket.IO stats managed by core-service gateway',
    };
  }
}
