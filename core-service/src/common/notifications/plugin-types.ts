/**
 * Notification handler plugin types (shared across notification-service and service handlers)
 *
 * Used by auth-service, payment-service, bonus-service to implement notification handlers
 * and by notification-service to register them. notificationService is typed as unknown
 * so core-service does not depend on notification-service.
 */

import type { IntegrationEvent } from '../events/integration.js';

/**
 * Handler plugin interface - each handler module implements this
 */
export interface NotificationHandlerPlugin {
  name: string;
  description: string;
  channels: string[];
  eventTypes: string[];
  initialize(notificationService: unknown): void;
  isAvailable(): boolean;
}

/**
 * Handler context passed to handler functions.
 * notificationService is typed as any so handlers can call sendMultiChannel etc. without casting.
 */
export interface HandlerContext {
  notificationService: any;
  event: IntegrationEvent<any>;
  logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; debug: (...args: unknown[]) => void };
}

/**
 * Type for event handler functions
 */
export type EventHandler<T = unknown> = (context: HandlerContext) => Promise<void> | void;
