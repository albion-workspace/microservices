/**
 * Notification Service
 * Aligned with service generator scaffold (accessors, config, createGateway). Domain-specific code below.
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
  buildDefaultGatewayConfig,
  allow,
  isAuthenticated,
  hasRole,
  logger,
  startListening,
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
  resolveContext,
  runServiceStartup,
} from 'core-service';

import { db } from './accessors.js';
import { loadConfig, validateConfig, printConfigSummary, SERVICE_NAME, type NotificationConfig } from './config.js';
import { NOTIFICATION_CONFIG_DEFAULTS } from './config-defaults.js';
import { NotificationService } from './notification-service.js';
import { notificationGraphQLTypes, createNotificationResolvers } from './graphql.js';
import { handlerRegistry } from './plugins/index.js';
import type { NotificationHandlerPlugin } from './plugins/index.js';
import { NOTIFICATION_ERROR_CODES } from './error-codes.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration (will be loaded asynchronously in main())
// ═══════════════════════════════════════════════════════════════════

let notificationConfig: NotificationConfig | null = null;
let notificationServiceInstance: NotificationService | null = null;
let notificationResolversInstance: ReturnType<typeof createNotificationResolvers> | null = null;

// Gateway config builder (uses module-level service and resolvers set in afterDb)
function buildGatewayConfigFromStored(): Parameters<typeof createGateway>[0] {
  if (!notificationConfig || !notificationServiceInstance || !notificationResolversInstance) throw new Error('Configuration not loaded yet');
  return buildDefaultGatewayConfig(notificationConfig, {
    services: [
      { name: 'notifications', types: notificationGraphQLTypes, resolvers: notificationResolversInstance },
    ],
    permissions: {
      Query: {
        health: allow,
        notificationHealth: allow,
        myNotifications: isAuthenticated,
        notificationStats: hasRole('system'),
        availableChannels: allow,
      },
      Mutation: {
        sendNotification: allow,
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

async function main() {
  await runServiceStartup<NotificationConfig>({
    serviceName: SERVICE_NAME,
    registerErrorCodes: () => registerServiceErrorCodes(NOTIFICATION_ERROR_CODES),
    registerConfigDefaults: () => registerServiceConfigDefaults(SERVICE_NAME, NOTIFICATION_CONFIG_DEFAULTS),
    resolveContext: async () => {
      const c = await resolveContext();
      return { brand: c.brand ?? 'default', tenantId: c.tenantId };
    },
    loadConfig: (brand?: string, tenantId?: string) => loadConfig(brand, tenantId),
    validateConfig,
    printConfigSummary,
    afterDb: async (context, config) => {
      notificationConfig = config;
      const { database, context: dbContext } = await db.initialize({ brand: context.brand, tenantId: context.tenantId });
      logger.info('Database initialized via service database accessor', { database: database.databaseName, context: dbContext });
      notificationServiceInstance = new NotificationService(config);
      notificationResolversInstance = createNotificationResolvers(notificationServiceInstance);
    },
    buildGatewayConfig: () => buildGatewayConfigFromStored(),
    ensureDefaults: true,
    afterGateway: async (gateway) => {
      const service = notificationServiceInstance!;
      service.setGateway({ broadcast: gateway.broadcast, sse: gateway.sse, io: gateway.io });
      service.initializeSocket();
      await loadHandlersFromServices(service);
      handlerRegistry.initialize(service);
      if (notificationConfig!.redisUrl) {
        try {
          const channels = handlerRegistry.getChannels();
          if (channels.length > 0) {
            await startListening(channels);
            logger.info('Started listening to event channels', { channels, plugins: handlerRegistry.getPlugins().map(p => p.name) });
          } else {
            logger.info('No handler plugins registered - event listening skipped');
          }
        } catch (err) {
          logger.warn('Could not start event listener', { error: (err as Error).message });
        }
      } else {
        logger.warn('Redis not configured - inter-service events disabled');
      }
      logger.info('Notification service started successfully', { port: notificationConfig!.port });
    },
  });
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
