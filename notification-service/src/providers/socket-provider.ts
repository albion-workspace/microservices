/**
 * Socket.IO Provider
 * 
 * Uses core-service's Socket.IO support for real-time bidirectional notifications
 * Socket.IO server is automatically created by createGateway() with enableSocketIO: true
 */

import { logger, emit, generateId } from 'core-service';
import type { NotificationProvider, SocketNotification, NotificationResponse, NotificationConfig } from '../types.js';

export class SocketProvider implements NotificationProvider {
  name = 'socket';
  channel = 'socket' as const;
  
  constructor(private config: NotificationConfig) {
    logger.info('Socket provider initialized');
  }
  
  isConfigured(): boolean {
    return true; // Socket.IO is always available from core-service
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
      // Emit via Redis - core-service's Socket.IO will broadcast to clients
      const eventData = {
        event: notification.event,
        data: notification.data,
        room: notification.room,
        userId: notification.userId,
        timestamp: new Date(),
      };
      
      // Emit to socket.io channel in Redis
      // Core-service gateway will broadcast to Socket.IO clients
      const userId = Array.isArray(notification.userId)
        ? notification.userId[0]
        : notification.userId || 'system';
      
      await emit(
        'socket.io',
        'system',
        userId,
        eventData
      );
      
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
      logger.error('Failed to send Socket notification', {
        error: error.message,
      });
      
      return {
        id: generateId(),
        status: 'failed',
        channel: 'socket',
        error: error.message,
      };
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
