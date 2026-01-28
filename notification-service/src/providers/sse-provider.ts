/**
 * SSE (Server-Sent Events) Provider
 * 
 * Uses core-service's SSE support for real-time notifications to end users
 */

import { logger, generateId, emit, GraphQLError } from 'core-service';
import { NOTIFICATION_ERRORS } from '../error-codes.js';
import type { NotificationProvider, SseNotification, NotificationResponse } from '../types.js';
import type { SSEBroadcast, UnifiedRealtimeProvider } from './realtime-interface.js';

export class SseProvider implements NotificationProvider, UnifiedRealtimeProvider {
  name = 'sse';
  channel = 'sse' as const;
  private connections: Map<string, any> = new Map();
  private sseHelpers: { 
    pushToUser: (userId: string, event: string, data: unknown) => void;
    pushToTenant: (tenantId: string, event: string, data: unknown) => void;
    push: (event: string, data: unknown) => void;
    getConnectionCount: () => number;
  } | null = null;
  
  constructor() {
    logger.info('SSE provider initialized');
  }
  
  isConfigured(): boolean {
    return true; // SSE is always available
  }
  
  /**
   * Set gateway SSE helpers for direct SSE emission
   */
  setGateway(sseHelpers: { 
    pushToUser: (userId: string, event: string, data: unknown) => void;
    pushToTenant: (tenantId: string, event: string, data: unknown) => void;
    push: (event: string, data: unknown) => void;
    getConnectionCount: () => number;
  }): void {
    this.sseHelpers = sseHelpers;
    logger.info('SSE provider gateway set');
  }
  
  /**
   * Get unified broadcast interface
   */
  getBroadcast(): SSEBroadcast {
    return {
      type: 'sse',
      toUser: (userId: string, event: string, data: unknown) => {
        if (this.sseHelpers) {
          this.sseHelpers.pushToUser(userId, event, data);
        }
      },
      toTenant: (tenantId: string, event: string, data: unknown) => {
        if (this.sseHelpers) {
          this.sseHelpers.pushToTenant(tenantId, event, data);
        }
      },
      toAll: (event: string, data: unknown) => {
        if (this.sseHelpers) {
          this.sseHelpers.push(event, data);
        }
      },
      toRoom: (room: string, event: string, data: unknown) => {
        // SSE doesn't support rooms, fallback to broadcasting to all
        // In a real implementation, you might want to track room memberships
        if (this.sseHelpers) {
          this.sseHelpers.push(event, data);
        }
        logger.warn('SSE does not support rooms, broadcasting to all instead', { room });
      },
      getConnectionCount: () => {
        return this.sseHelpers?.getConnectionCount() || this.connections.size;
      },
    };
  }
  
  /**
   * Check if bidirectional
   */
  isBidirectional(): boolean {
    return false; // SSE is unidirectional (server -> client only)
  }
  
  /**
   * Get provider type
   */
  getType(): 'sse' {
    return 'sse';
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
   * Uses core-service's SSE push functionality via Redis emit
   */
  async send(notification: SseNotification): Promise<NotificationResponse> {
    try {
      const eventName = notification.event || 'notification';
      const eventData = notification.data || {};
      
      // Use gateway SSE helpers directly if available (preferred method)
      if (this.sseHelpers) {
        this.sseHelpers.pushToUser(notification.userId, eventName, eventData);
        logger.info('SSE notification sent via gateway', {
          userId: notification.userId,
          event: eventName,
        });
      } else {
        // Fallback: Emit via Redis (requires listener setup)
        await emit(
          'sse',
          'system', // tenantId
          notification.userId,
          {
            event: eventName,
            data: eventData,
          }
        );
        logger.info('SSE notification queued via Redis', {
          userId: notification.userId,
          event: eventName,
        });
      }
      
      return {
        id: generateId(),
        status: 'sent',
        channel: 'sse',
        sentAt: new Date(),
      };
    } catch (error: any) {
      throw new GraphQLError(NOTIFICATION_ERRORS.FailedToSendSSENotification, {
        error: error.message,
        userId: notification.userId,
      });
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
