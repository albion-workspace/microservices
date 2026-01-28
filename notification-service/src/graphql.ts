/**
 * Notification Service GraphQL Schema & Resolvers
 */

import { logger, requireAuth, getUserId, getErrorMessage, getDatabase, generateMongoId, paginateCollection, GraphQLError } from 'core-service';
import { NOTIFICATION_ERRORS } from './error-codes.js';
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
    to: String
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
    to: String
    subject: String
    body: String!
    html: String
    metadata: JSON
    event: String
    data: JSON
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
  
  type ChannelInfo {
    channel: NotificationChannel!
    configured: Boolean!
  }
  
  type NotificationConnection {
    nodes: [Notification!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }
  
  extend type Query {
    notificationHealth: String!
    myNotifications(first: Int, after: String): NotificationConnection!
    notificationStats: NotificationStats!
    availableChannels: [ChannelInfo!]!
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
        const userId = getUserId(context);
        const { first = 20, after } = args;
        
        const result = await paginateCollection(
          db.collection('notifications'),
          {
            first: Math.min(Math.max(1, first || 20), 100),
            after,
            filter: { userId },
            sortField: 'createdAt',
            sortDirection: 'desc',
          }
        );
        
        const nodes = result.edges.map(edge => {
          const notification = edge.node as any;
          return {
            ...notification,
            channel: notification.channel?.toUpperCase() || notification.channel,
            priority: notification.priority?.toUpperCase() || notification.priority,
            status: notification.status?.toUpperCase() || notification.status,
            to: notification.to || notification.userId || 'system',
          };
        });
        
        return {
          nodes,
          pageInfo: result.pageInfo,
          totalCount: result.totalCount || 0,
        };
      },
      
      notificationStats: async (args: any, context: ResolverContext) => {
        if (!context.user!.roles?.includes('system')) {
          throw new GraphQLError(NOTIFICATION_ERRORS.SystemAccessRequired, {});
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
        const allChannels: string[] = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'SSE', 'SOCKET'];
        const configuredChannels = new Set(
          notificationService.getAvailableChannels().map(c => c.toUpperCase())
        );
        
        return allChannels.map(channel => ({
          channel: channel as any,
          configured: configuredChannels.has(channel),
        }));
      },
    },
    
    Mutation: {
      sendNotification: async (
        args: Record<string, any>,
        context: ResolverContext
      ) => {
        const input = args.input;
        const normalizedChannel = input.channel?.toLowerCase();
        let userId = input.userId;
        const to = input.to;
        const currentUserId = context.user ? getUserId(context) : undefined;
        
        if ((normalizedChannel === 'sse' || normalizedChannel === 'socket') && !userId && to) {
          if (to === currentUserId || 
              (context.user && (
                to === (context.user as any).email || 
                to === (context.user as any).username ||
                to === (context.user as any).phone
              ))) {
            userId = currentUserId;
            logger.info('Resolved recipient to current user', { to, userId });
          } else if (/^[0-9a-fA-F]{24}$/.test(to)) {
            userId = to;
            logger.info('Using to field as userId', { userId });
          } else {
            userId = currentUserId;
            logger.warn('Could not resolve userId from to field, using current user', { to, userId: currentUserId });
          }
        } else if (!userId && (normalizedChannel === 'sse' || normalizedChannel === 'socket')) {
          userId = currentUserId;
        }
        
        if (normalizedChannel === 'sse' || normalizedChannel === 'socket') {
          if (!userId) {
            throw new GraphQLError(NOTIFICATION_ERRORS.ChannelRequiresUserId, { channel: normalizedChannel });
          }
        } else {
          if (!to) {
            throw new Error(`${normalizedChannel?.toUpperCase() || 'Notification'} channel requires 'to' field`);
          }
        }
        
        logger.info('Sending notification', {
          originalChannel: input.channel,
          normalizedChannel,
          userId,
          to,
          currentUserId,
        });
        
        try {
          const request: any = {
            tenantId: input.tenantId,
            channel: normalizedChannel,
            priority: input.priority?.toLowerCase() || 'normal',
            body: input.body,
            subject: input.subject,
            metadata: input.metadata,
          };
          
          if (normalizedChannel === 'sse' || normalizedChannel === 'socket') {
            request.userId = userId;
            request.to = userId || 'system';
            request.subject = input.subject;
            request.body = input.body;
            request.event = input.event || 'notification';
            const notificationId = request.id || generateMongoId().idString;
            
            request.data = input.data || { 
              id: notificationId,
              subject: input.subject,
              body: input.body,
              channel: normalizedChannel.toUpperCase(),
              priority: input.priority?.toUpperCase() || 'NORMAL',
              userId: userId,
              tenantId: input.tenantId,
              ...(input.metadata || {}),
            };
          } else {
            if (!to) {
              throw new Error(`${normalizedChannel?.toUpperCase() || 'Notification'} channel requires 'to' field`);
            }
            request.to = to;
            if (userId) {
              request.userId = userId;
            }
          }
          
          const result = await notificationService.send(request);
          
          return {
            success: result.status === 'sent' || result.status === 'delivered',
            message: result.error || 'Notification sent successfully',
            notificationId: result.id,
            status: result.status.toUpperCase(),
          };
        } catch (e: any) {
          const error = getErrorMessage(e);
          throw new GraphQLError(NOTIFICATION_ERRORS.FailedToSendNotification, { 
            error,
            originalChannel: input.channel,
            normalizedChannel,
          });
          
          return {
            success: false,
            message: error
          };
        }
      },
    },
  };
}
