/**
 * Cross-Service Integration Module
 * 
 * Generic pub/sub event handling between microservices.
 * Services define their own event types - this module is service-agnostic.
 * 
 * Usage:
 *   // Emit an event (from any service)
 *   await emit('order.created', tenantId, userId, { orderId: '123', amount: 100 });
 * 
 *   // Listen to events (in any service)
 *   on('order.created', async (event) => {
 *     console.log('Order created:', event.data);
 *   });
 */

import { publish, subscribe } from '../databases/redis.js';
import { logger } from './logger.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Base event structure - all integration events follow this format
 */
export interface IntegrationEvent<T = unknown> {
  /** Unique event ID */
  eventId: string;
  /** Event type in format: "domain.action" (e.g., "order.created", "user.verified") */
  eventType: string;
  /** When the event occurred */
  timestamp: Date;
  /** Tenant ID for multi-tenant systems */
  tenantId: string;
  /** User who triggered the event (if applicable) */
  userId?: string;
  /** Correlation ID for tracing across services */
  correlationId?: string;
  /** Event-specific payload */
  data: T;
}

type EventHandler<T = unknown> = (event: IntegrationEvent<T>) => void | Promise<void>;

// Handler registry: eventType -> Set of handlers
const handlers = new Map<string, Set<EventHandler>>();

// ═══════════════════════════════════════════════════════════════════
// Channel Management
// ═══════════════════════════════════════════════════════════════════

/**
 * Build channel name from event type
 * Event type "order.created" -> channel "integration:order"
 * Event type "user.profile.updated" -> channel "integration:user"
 */
function getChannel(eventType: string): string {
  const namespace = eventType.split('.')[0];
  return `integration:${namespace}`;
}

/**
 * Get all unique channels from registered handlers
 */
function getRegisteredChannels(): string[] {
  const channels = new Set<string>();
  for (const eventType of handlers.keys()) {
    channels.add(getChannel(eventType));
  }
  return Array.from(channels);
}

// ═══════════════════════════════════════════════════════════════════
// Event Emitter (Publisher)
// ═══════════════════════════════════════════════════════════════════

export interface EmitOptions {
  /** Override the default channel */
  channel?: string;
  /** Correlation ID for distributed tracing */
  correlationId?: string;
}

/**
 * Emit an integration event to other services
 * 
 * @param eventType - Event type in format "domain.action" (e.g., "order.created")
 * @param tenantId - Tenant identifier
 * @param userId - User who triggered the event (optional)
 * @param data - Event payload (any serializable data)
 * @param options - Additional options
 * 
 * @example
 * // Simple event
 * await emit('order.created', 'tenant-1', 'user-123', { orderId: 'xyz', amount: 100 });
 * 
 * // With correlation ID for tracing
 * await emit('payment.processed', tenantId, userId, paymentData, { correlationId: requestId });
 */
export async function emit<T = unknown>(
  eventType: string,
  tenantId: string,
  userId: string | undefined,
  data: T,
  options: EmitOptions = {}
): Promise<string> {
  const event: IntegrationEvent<T> = {
    eventId: crypto.randomUUID(),
    eventType,
    timestamp: new Date(),
    tenantId,
    userId,
    correlationId: options.correlationId,
    data,
  };
  
  const channel = options.channel || getChannel(eventType);
  
  try {
    const published = await publish(channel, JSON.stringify(event));
    if (published) {
      logger.debug(`Emitted ${eventType} to ${channel}`, {
        eventId: event.eventId,
        userId: event.userId,
      });
    } else {
      logger.warn(`Failed to emit ${eventType} - Redis not available`, {
        eventId: event.eventId,
        channel,
      });
      // Don't throw - allow service to continue even if Redis is down
      // Events can be queued or retried later
    }
    return event.eventId;
  } catch (error) {
    logger.error(`Failed to emit ${eventType}`, { error, event });
    // Still return eventId even on error - event was created, just not published
    return event.eventId;
  }
}

/**
 * Emit a pre-built event object
 * Useful when you need full control over the event structure
 */
export async function emitEvent<T = unknown>(
  event: IntegrationEvent<T>,
  channel?: string
): Promise<void> {
  const targetChannel = channel || getChannel(event.eventType);
  
  try {
    const published = await publish(targetChannel, JSON.stringify(event));
    if (published) {
      logger.debug(`Emitted ${event.eventType} to ${targetChannel}`, {
        eventId: event.eventId,
        userId: event.userId,
      });
    } else {
      logger.warn(`Failed to emit ${event.eventType} - Redis not available`, {
        eventId: event.eventId,
        channel: targetChannel,
      });
    }
  } catch (error) {
    logger.error(`Failed to emit ${event.eventType}`, { error, event });
    // Don't throw - allow service to continue
  }
}

// ═══════════════════════════════════════════════════════════════════
// Event Listener (Subscriber)
// ═══════════════════════════════════════════════════════════════════

/**
 * Subscribe to integration events by event type
 * 
 * @param eventType - Event type(s) to listen for
 * @param handler - Async function to handle the event
 * @returns Unsubscribe function
 * 
 * @example
 * // Single event type
 * const unsubscribe = on('order.created', async (event) => {
 *   console.log('New order:', event.data);
 * });
 * 
 * // Multiple event types
 * on(['order.created', 'order.updated'], async (event) => {
 *   console.log('Order event:', event.eventType, event.data);
 * });
 * 
 * // Cleanup when done
 * unsubscribe();
 */
export function on<T = unknown>(
  eventType: string | string[],
  handler: EventHandler<T>
): () => void {
  const types = Array.isArray(eventType) ? eventType : [eventType];
  
  for (const type of types) {
    if (!handlers.has(type)) {
      handlers.set(type, new Set());
    }
    handlers.get(type)!.add(handler as EventHandler);
  }
  
  // Return unsubscribe function
  return () => {
    for (const type of types) {
      handlers.get(type)?.delete(handler as EventHandler);
    }
  };
}

/**
 * Subscribe with wildcard pattern matching
 * 
 * @param pattern - Pattern with * wildcard (e.g., "order.*", "*.created")
 * @param handler - Async function to handle matching events
 * 
 * @example
 * // All order events
 * onPattern('order.*', async (event) => {
 *   console.log('Order event:', event.eventType);
 * });
 * 
 * // All creation events
 * onPattern('*.created', async (event) => {
 *   console.log('Something created:', event.eventType);
 * });
 */
const patternHandlers = new Map<string, Set<EventHandler>>();

export function onPattern<T = unknown>(
  pattern: string,
  handler: EventHandler<T>
): () => void {
  if (!patternHandlers.has(pattern)) {
    patternHandlers.set(pattern, new Set());
  }
  patternHandlers.get(pattern)!.add(handler as EventHandler);
  
  return () => {
    patternHandlers.get(pattern)?.delete(handler as EventHandler);
  };
}

function matchPattern(pattern: string, eventType: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(eventType);
}

// ═══════════════════════════════════════════════════════════════════
// Event Listener Startup
// ═══════════════════════════════════════════════════════════════════

/**
 * Start listening to Redis channels
 * Call this once at service startup after registering handlers
 * 
 * @param channels - Specific channels to listen to (default: auto-detect from handlers)
 * 
 * @example
 * // Register handlers first
 * on('order.created', handleOrderCreated);
 * on('payment.completed', handlePaymentCompleted);
 * 
 * // Then start listening
 * await startListening();
 */
export async function startListening(channels?: string[]): Promise<void> {
  const targetChannels = channels || getRegisteredChannels();
  
  if (targetChannels.length === 0) {
    logger.warn('No event handlers registered, skipping event listener setup');
    return;
  }
  
  for (const channel of targetChannels) {
    await subscribe(channel, async (message) => {
      try {
        const event = JSON.parse(message) as IntegrationEvent;
        
        // Exact match handlers
        const exactHandlers = handlers.get(event.eventType);
        if (exactHandlers?.size) {
          for (const handler of exactHandlers) {
            try {
              await handler(event);
            } catch (error) {
              logger.error(`Handler error for ${event.eventType}`, { error, eventId: event.eventId });
            }
          }
        }
        
        // Pattern match handlers
        for (const [pattern, patternHandlerSet] of patternHandlers) {
          if (matchPattern(pattern, event.eventType)) {
            for (const handler of patternHandlerSet) {
              try {
                await handler(event);
              } catch (error) {
                logger.error(`Pattern handler error for ${event.eventType}`, { error, eventId: event.eventId });
              }
            }
          }
        }
      } catch (error) {
        logger.error('Failed to parse integration event', { error, message });
      }
    });
  }
  
  logger.info(`Event listener started on channels: ${targetChannels.join(', ')}`);
}

/**
 * Listen to all events (useful for logging/monitoring)
 */
export async function startGlobalListener(): Promise<void> {
  await subscribe('integration:*', async (message) => {
    try {
      const event = JSON.parse(message) as IntegrationEvent;
      logger.debug(`[GLOBAL] ${event.eventType}`, { eventId: event.eventId, userId: event.userId });
    } catch (error) {
      logger.error('Failed to parse global event', { error });
    }
  });
  
  logger.info('Global event listener started');
}

// ═══════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a typed event builder for a specific event type
 * Useful for services that emit the same event type multiple times
 * 
 * @example
 * const emitOrderCreated = createEmitter<OrderData>('order.created');
 * 
 * // Later...
 * await emitOrderCreated(tenantId, userId, { orderId: '123', items: [...] });
 */
export function createEmitter<T>(eventType: string) {
  return async (
    tenantId: string,
    userId: string | undefined,
    data: T,
    options?: EmitOptions
  ): Promise<string> => {
    return emit(eventType, tenantId, userId, data, options);
  };
}

/**
 * Create a typed handler registration for a specific event type
 * 
 * @example
 * const onOrderCreated = createHandler<OrderData>('order.created');
 * 
 * onOrderCreated(async (event) => {
 *   // event.data is typed as OrderData
 *   console.log(event.data.orderId);
 * });
 */
export function createHandler<T>(eventType: string) {
  return (handler: EventHandler<T>): (() => void) => {
    return on(eventType, handler);
  };
}

/**
 * Build an event object (for inspection/testing without emitting)
 */
export function buildEvent<T>(
  eventType: string,
  tenantId: string,
  userId: string | undefined,
  data: T,
  correlationId?: string
): IntegrationEvent<T> {
  return {
    eventId: crypto.randomUUID(),
    eventType,
    timestamp: new Date(),
    tenantId,
    userId,
    correlationId,
    data,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Unified Event + Webhook Dispatcher
// ═══════════════════════════════════════════════════════════════════

import type { WebhookManager } from './webhooks.js';

/**
 * Options for unified event dispatch
 */
export interface UnifiedEmitOptions extends EmitOptions {
  /** Skip internal event emission (only dispatch webhooks) */
  skipInternal?: boolean;
  /** Skip webhook dispatch (only emit internally) */
  skipWebhook?: boolean;
}

/**
 * Create a unified event emitter that dispatches both internal events and webhooks.
 * Ensures consistency: same data goes to both channels.
 * 
 * @param webhookManager - The webhook manager for external dispatch
 * @returns A unified emit function
 * 
 * @example
 * const bonusWebhooks = createWebhookManager<BonusEvents>({ serviceName: 'bonus' });
 * const emitBonusEvent = createUnifiedEmitter(bonusWebhooks);
 * 
 * // Single call dispatches to both Redis (internal) and webhooks (external)
 * await emitBonusEvent('bonus.awarded', tenantId, userId, {
 *   bonusId: '123',
 *   amount: 100,
 *   currency: 'USD',
 * });
 */
export function createUnifiedEmitter<TEvents extends string>(
  webhookManager: WebhookManager<TEvents>
) {
  return async function emitUnified<T = unknown>(
    eventType: TEvents,
    tenantId: string,
    userId: string | undefined,
    data: T,
    options: UnifiedEmitOptions = {}
  ): Promise<{ eventId: string; webhookCount: number }> {
    let eventId = '';
    let webhookCount = 0;
    
    // 1. Emit internal event (for cross-service communication)
    if (!options.skipInternal) {
      eventId = await emit(eventType, tenantId, userId, data, {
        channel: options.channel,
        correlationId: options.correlationId,
      });
    } else {
      eventId = crypto.randomUUID();
    }
    
    // 2. Dispatch webhooks (for external/third-party integrations)
    if (!options.skipWebhook) {
      try {
        const deliveries = await webhookManager.dispatch({
          eventType,
          tenantId,
          userId,
          data: data as Record<string, unknown>,
        });
        webhookCount = deliveries.length;
      } catch (error) {
        logger.warn(`Webhook dispatch failed for ${eventType}`, { error, eventId });
        // Don't throw - webhooks failing shouldn't break the main flow
      }
    }
    
    logger.debug(`Unified dispatch: ${eventType}`, { eventId, webhookCount });
    
    return { eventId, webhookCount };
  };
}

/**
 * Create a typed unified emitter for specific event types
 * Provides compile-time safety for event data
 * 
 * @example
 * interface BonusAwardedData {
 *   bonusId: string;
 *   amount: number;
 *   currency: string;
 * }
 * 
 * const emitBonusAwarded = createTypedUnifiedEmitter<'bonus.awarded', BonusAwardedData>(
 *   webhookManager,
 *   'bonus.awarded'
 * );
 * 
 * // Type-safe call
 * await emitBonusAwarded(tenantId, userId, { bonusId: '123', amount: 100, currency: 'USD' });
 */
export function createTypedUnifiedEmitter<TEvent extends string, TData>(
  webhookManager: WebhookManager<TEvent>,
  eventType: TEvent
) {
  const unifiedEmit = createUnifiedEmitter(webhookManager);
  
  return async (
    tenantId: string,
    userId: string | undefined,
    data: TData,
    options?: UnifiedEmitOptions
  ): Promise<{ eventId: string; webhookCount: number }> => {
    return unifiedEmit(eventType, tenantId, userId, data, options);
  };
}

