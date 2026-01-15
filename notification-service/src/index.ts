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
import { handlerRegistry } from './plugins/index.js';
import type { NotificationHandlerPlugin } from './plugins/index.js';

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
║  Extensible Plugin System:                                            ║
║  • Handlers loaded dynamically from other services                   ║
║  • Works standalone or with service integrations                     ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  printConfigSummary(config);
  
  // Create gateway
  const gateway = await createGateway(gatewayConfig);
  
  // Initialize Socket.IO after gateway starts
  notificationService.initializeSocket();
  
  // Dynamically load handlers from other services (if available)
  // This makes notification-service extensible - services can provide their own handlers
  await loadHandlersFromServices(notificationService);
  
  // Initialize all registered handlers
  handlerRegistry.initialize(notificationService);
  
  // Start listening to Redis events (only for channels that have handlers)
  if (config.redisUrl) {
    try {
      const channels = handlerRegistry.getChannels();
      
      if (channels.length > 0) {
        await startListening(channels);
        logger.info('Started listening to event channels', { 
          channels,
          plugins: handlerRegistry.getPlugins().map(p => p.name),
        });
      } else {
        logger.info('No handler plugins registered - event listening skipped');
      }
    } catch (err) {
      logger.warn('Could not start event listener', { error: (err as Error).message });
    }
  } else {
    logger.warn('Redis not configured - inter-service events disabled');
  }
  
  logger.info('Notification service started successfully', { port: config.port });
}

/**
 * Dynamically load notification handlers from other services
 * Services export their handlers, and notification-service loads them if available
 */
async function loadHandlersFromServices(notificationService: NotificationService): Promise<void> {
  const handlerModules = [
    // Try to load handlers from other services
    { name: 'auth-service', path: '../auth-service/src/notifications/auth-handler.js' },
    { name: 'payment-service', path: '../payment-service/src/notifications/payment-handler.js' },
    { name: 'bonus-service', path: '../bonus-service/src/notifications/bonus-handler.js' },
  ];

  logger.info('Loading notification handlers from services...');

  for (const module of handlerModules) {
    try {
      // Try to dynamically import the handler
      const handlerModule = await import(module.path);
      
      // Look for exported handler (could be named differently)
      const handler = handlerModule.authNotificationHandler || 
                     handlerModule.paymentNotificationHandler || 
                     handlerModule.bonusNotificationHandler ||
                     handlerModule.default;
      
      if (handler && typeof handler === 'object' && 'name' in handler) {
        handlerRegistry.register(handler as NotificationHandlerPlugin);
        logger.info(`Loaded notification handler from ${module.name}`, { handler: handler.name });
      } else {
        logger.debug(`No valid handler found in ${module.name}`);
      }
    } catch (error: any) {
      // Service not available or handler not found - this is OK
      if (error.code === 'ERR_MODULE_NOT_FOUND' || error.message?.includes('Cannot find module')) {
        logger.debug(`Handler from ${module.name} not available (service may not be present)`, {
          path: module.path,
        });
      } else {
        logger.warn(`Failed to load handler from ${module.name}`, { error: error.message });
      }
    }
  }

  const loadedHandlers = handlerRegistry.getPlugins();
  logger.info(`Loaded ${loadedHandlers.length} notification handler(s)`, {
    handlers: loadedHandlers.map(h => h.name),
  });
}

main().catch((err) => {
  logger.error('Failed to start notification-service', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

// Setup process-level error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in notification-service', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in notification-service', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit - log and continue (some rejections are acceptable)
});
