/**
 * Notification Service GraphQL Schema & Resolvers
 */

import { logger, requireAuth, getUserId, getErrorMessage, getDatabase } from 'core-service';
import type { ResolverContext } from 'core-service';
import type { NotificationService } from './notification-service.js';

// ═══════════════════════════════════════════════════════════════════
// GraphQL Schema
// ═══════════════════════════════════════════════════════════════════

export const notificationGraphQLTypes = `
  type Notification {
    id: ID!
    userId: String
    tenantId: String!
    channel: NotificationChannel!
    priority: NotificationPriority!
    to: String!
    subject: String
    body: String!
    status: NotificationStatus!
    sentAt: String
    deliveredAt: String
    error: String
    createdAt: String!
  }
  
  enum NotificationChannel {
    EMAIL
    SMS
    WHATSAPP
    PUSH
    SSE
    SOCKET
  }
  
  enum NotificationPriority {
    LOW
    NORMAL
    HIGH
    URGENT
  }
  
  enum NotificationStatus {
    PENDING
    QUEUED
    SENT
    DELIVERED
    FAILED
    BOUNCED
  }
  
  input SendNotificationInput {
    userId: String
    tenantId: String!
    channel: NotificationChannel!
    priority: NotificationPriority
    to: String!
    subject: String
    body: String!
    html: String
    metadata: JSON
  }
  
  type SendNotificationResponse {
    success: Boolean!
    message: String
    notificationId: ID
    status: NotificationStatus
  }
  
  type NotificationStats {
    total: Int!
    sent: Int!
    failed: Int!
    byChannel: JSON!
    byStatus: JSON!
  }
  
  extend type Query {
    notificationHealth: String!
    myNotifications(limit: Int, offset: Int): [Notification!]!
    notificationStats: NotificationStats!
    availableChannels: [NotificationChannel!]!
  }
  
  extend type Mutation {
    sendNotification(input: SendNotificationInput!): SendNotificationResponse!
  }
`;

// ═══════════════════════════════════════════════════════════════════
// Resolvers
// ═══════════════════════════════════════════════════════════════════

export function createNotificationResolvers(notificationService: NotificationService): {
  Query: Record<string, any>;
  Mutation: Record<string, any>;
} {
  return {
    Query: {
      notificationHealth: (args: any, context: ResolverContext) => {
        return 'Notification service is healthy';
      },
      
      myNotifications: async (
        args: Record<string, any>,
        context: ResolverContext
      ) => {
        requireAuth(context);
        
        const db = getDatabase();
        
        const notifications = await db
          .collection('notifications')
          .find({ userId: getUserId(context) })
          .sort({ createdAt: -1 })
          .limit(args.limit || 50)
          .skip(args.offset || 0)
          .toArray();
        
        return notifications;
      },
      
      notificationStats: async (args: any, context: ResolverContext) => {
        if (!context.user!.roles?.includes('system')) {
          throw new Error('System access required');
        }
        
        const db = getDatabase();
        
        const total = await db.collection('notifications').countDocuments();
        const sent = await db.collection('notifications').countDocuments({ status: 'sent' });
        const failed = await db.collection('notifications').countDocuments({ status: 'failed' });
        
        // Aggregate by channel
        const byChannel = await db
          .collection('notifications')
          .aggregate([
            { $group: { _id: '$channel', count: { $sum: 1 } } },
          ])
          .toArray();
        
        // Aggregate by status
        const byStatus = await db
          .collection('notifications')
          .aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ])
          .toArray();
        
        return {
          total,
          sent,
          failed,
          byChannel: Object.fromEntries(byChannel.map(c => [c._id, c.count])),
          byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
        };
      },
      
      availableChannels: (args: any, context: ResolverContext) => {
        return notificationService.getAvailableChannels().map(c => c.toUpperCase());
      },
    },
    
    Mutation: {
      sendNotification: async (
        args: Record<string, any>,
        context: ResolverContext
      ) => {
        const input = args.input;
        
        try {
          const result = await notificationService.send({
            ...input,
            channel: input.channel.toLowerCase(),
            priority: input.priority?.toLowerCase() || 'normal',
            userId: input.userId || (context.user ? getUserId(context) : undefined), // Use provided userId or context userId
          });
          
          return {
            success: result.status === 'sent' || result.status === 'delivered',
            message: result.error || 'Notification sent successfully',
            notificationId: result.id,
            status: result.status.toUpperCase(),
          };
        } catch (e: any) {
          const error = getErrorMessage(e);
          logger.error('Failed to send notification', { error });
          
          return {
            success: false,
            message: error
          };
        }
      },
    },
  };
}
