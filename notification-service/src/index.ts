/**
 * Notification Service
 * 
 * Multi-channel notification service supporting:
 * - Email (SMTP)
 * - SMS (Twilio)
 * - WhatsApp (Twilio)
 * - Push Notifications
 * - SSE (Server-Sent Events)
 * - Socket.IO (Real-time WebSocket)
 * 
 * Features:
 * - Inter-service communication via Redis events
 * - Queue management with BullMQ
 * - Template support
 * - Webhook callbacks
 * - Real-time delivery to end users
 */

import {
  createGateway,
  allow,
  isAuthenticated,
  hasRole,
  logger,
  startListening,
} from 'core-service';

import { loadConfig, validateConfig, printConfigSummary } from './config.js';
import { NotificationService } from './notification-service.js';
import { notificationGraphQLTypes, createNotificationResolvers } from './graphql.js';
import { setupEventHandlers } from './event-handlers.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const config = loadConfig();
validateConfig(config);

// ═══════════════════════════════════════════════════════════════════
// Initialize Service
// ═══════════════════════════════════════════════════════════════════

const notificationService = new NotificationService(config);
const notificationResolvers = createNotificationResolvers(notificationService);

// ═══════════════════════════════════════════════════════════════════
// Gateway Configuration
// ═══════════════════════════════════════════════════════════════════

const gatewayConfig = {
  name: 'notification-service',
  port: config.port,
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
      .split(',')
      .map(o => o.trim()),
  },
  jwt: {
    secret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
    expiresIn: '1h',
  },
  services: [
    {
      name: 'notifications',
      types: notificationGraphQLTypes,
      resolvers: notificationResolvers,
    },
  ],
  permissions: {
    Query: {
      health: allow,
      notificationHealth: allow,
      myNotifications: isAuthenticated,
      notificationStats: hasRole('admin'),
      availableChannels: allow, // Allow checking available channels
    },
    Mutation: {
      sendNotification: allow, // Allow service-to-service calls (auth-service, etc.)
    },
  },
  mongoUri: config.mongoUri,
  redisUrl: config.redisUrl,
  defaultPermission: 'deny' as const,
  
  // Enable Socket.IO
  enableSocketIO: true,
  socketIOPath: '/notifications/socket.io',
  
  // Enable SSE
  enableSSE: true,
  ssePath: '/notifications/events',
};

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                     NOTIFICATION SERVICE                              ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  Multi-Channel Notifications:                                         ║
║  • Email (SMTP)                                                       ║
║  • SMS (Twilio)                                                       ║
║  • WhatsApp (Twilio)                                                  ║
║  • Push Notifications                                                 ║
║  • SSE (Server-Sent Events)                                           ║
║  • Socket.IO (Real-time WebSocket)                                    ║
║                                                                       ║
║  Features:                                                            ║
║  • Template management                                                ║
║  • Queue processing with BullMQ                                       ║
║  • Webhook callbacks                                                  ║
║  • Real-time delivery to end users                                    ║
║  • Multi-tenant support                                               ║
║  • Priority routing                                                   ║
║  • Retry logic                                                        ║
║  • Delivery tracking                                                  ║
║                                                                       ║
║  Event Listeners:                                                     ║
║  • Auth events (user.*)                                               ║
║  • Payment events (payment.*)                                         ║
║  • Bonus events (bonus.*)                                             ║
║  • System events (system.*)                                           ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  printConfigSummary(config);
  
  // Create gateway
  const gateway = await createGateway(gatewayConfig);
  
  // Initialize Socket.IO after gateway starts
  notificationService.initializeSocket();
  
  // Setup event handlers for inter-service communication
  setupEventHandlers(notificationService);
  
  // Start listening to Redis events
  if (config.redisUrl) {
    try {
      const channels = [
        'integration:auth',
        'integration:payment',
        'integration:bonus',
        'integration:system',
      ];
      
      await startListening(channels);
      
      logger.info('Started listening to event channels', { channels });
    } catch (err) {
      logger.warn('Could not start event listener', { error: (err as Error).message });
    }
  } else {
    logger.warn('Redis not configured - inter-service events disabled');
  }
  
  logger.info('Notification service started successfully', { port: config.port });
}

main().catch((err) => {
  logger.error('Failed to start notification-service', { error: err.message });
  process.exit(1);
});
