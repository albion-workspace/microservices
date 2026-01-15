/**
 * SSE (Server-Sent Events) Provider
 * 
 * Uses core-service's SSE support for real-time notifications to end users
 */

import { logger } from 'core-service';
import type { NotificationProvider, SseNotification, NotificationResponse } from '../types.js';

export class SseProvider implements NotificationProvider {
  name = 'sse';
  channel = 'sse' as const;
  private connections: Map<string, any> = new Map();
  
  constructor() {
    logger.info('SSE provider initialized');
  }
  
  isConfigured(): boolean {
    return true; // SSE is always available
  }
  
  /**
   * Register SSE connection for a user
   */
  registerConnection(userId: string, connection: any): void {
    this.connections.set(userId, connection);
    logger.info('SSE connection registered', { userId });
  }
  
  /**
   * Unregister SSE connection
   */
  unregisterConnection(userId: string): void {
    this.connections.delete(userId);
    logger.info('SSE connection unregistered', { userId });
  }
  
  /**
   * Send notification via SSE
   */
  async send(notification: SseNotification): Promise<NotificationResponse> {
    const connection = this.connections.get(notification.userId);
    
    if (!connection) {
      logger.warn('No SSE connection for user', { userId: notification.userId });
      return {
        id: crypto.randomUUID(),
        status: 'failed',
        channel: 'sse',
        error: 'No active SSE connection',
      };
    }
    
    try {
      // Send SSE event
      connection.write(`event: ${notification.event}\n`);
      connection.write(`data: ${JSON.stringify(notification.data)}\n\n`);
      
      logger.info('SSE notification sent', {
        userId: notification.userId,
        event: notification.event,
      });
      
      return {
        id: crypto.randomUUID(),
        status: 'sent',
        channel: 'sse',
        sentAt: new Date(),
      };
    } catch (error: any) {
      logger.error('Failed to send SSE notification', {
        error: error.message,
        userId: notification.userId,
      });
      
      return {
        id: crypto.randomUUID(),
        status: 'failed',
        channel: 'sse',
        error: error.message,
      };
    }
  }
  
  /**
   * Get count of active connections
   */
  getActiveConnections(): number {
    return this.connections.size;
  }
  
  /**
   * Get connected user IDs
   */
  getConnectedUsers(): string[] {
    return Array.from(this.connections.keys());
  }
}
