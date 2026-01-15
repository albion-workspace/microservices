/**
 * Notification Service Plugin System
 * 
 * Export plugin interface and registration utilities for other services
 * to implement their own notification handlers.
 * 
 * This makes notification-service a core, reusable service that other
 * services can extend with their own handlers.
 * 
 * Usage in services:
 * ```typescript
 * import type { NotificationHandlerPlugin, HandlerContext } from 'notification-service/plugins';
 * 
 * export const myHandler: NotificationHandlerPlugin = {
 *   name: 'my-service',
 *   // ... implement handler
 * };
 * ```
 * 
 * Note: Handler implementations are now in their respective services:
 * - auth-service/src/notifications/auth-handler.ts
 * - payment-service/src/notifications/payment-handler.ts
 * - bonus-service/src/notifications/bonus-handler.ts
 */

export { handlerRegistry, registerNotificationHandler } from './registry.js';
export type { NotificationHandlerPlugin, HandlerContext, EventHandler } from './types.js';
export type { NotificationService } from '../notification-service.js';