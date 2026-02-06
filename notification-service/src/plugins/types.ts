/**
 * Notification Handler Plugin System
 *
 * Re-exports plugin types from core-service. HandlerContext is defined here with
 * NotificationService-typed notificationService for use inside notification-service.
 */

export type { NotificationHandlerPlugin, EventHandler } from 'core-service';
import type { IntegrationEvent } from 'core-service';
import type { NotificationService } from '../notification-service.js';

/**
 * Handler context passed to handler functions (notificationService typed for internal use)
 */
export interface HandlerContext {
  notificationService: NotificationService;
  event: IntegrationEvent<any>;
  logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; debug: (...args: unknown[]) => void };
}
