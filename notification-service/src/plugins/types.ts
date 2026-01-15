/**
 * Notification Handler Plugin System
 * 
 * Allows notification-service to be extensible - handlers can be registered
 * as plugins, making the service work with or without specific integrations.
 */

import type { IntegrationEvent } from 'core-service';
import type { NotificationService } from '../notification-service.js';

/**
 * Handler plugin interface - each handler module implements this
 */
export interface NotificationHandlerPlugin {
  /**
   * Unique name for this handler plugin
   */
  name: string;
  
  /**
   * Description of what events this handler processes
   */
  description: string;
  
  /**
   * Redis channels this handler listens to
   */
  channels: string[];
  
  /**
   * Event types this handler can process (for documentation)
   */
  eventTypes: string[];
  
  /**
   * Initialize the handler - register event listeners
   * @param notificationService - The notification service instance
   */
  initialize(notificationService: NotificationService): void;
  
  /**
   * Check if this handler is available (e.g., dependencies present)
   * @returns true if handler can be used
   */
  isAvailable(): boolean;
}

/**
 * Handler context passed to handler functions
 */
export interface HandlerContext {
  notificationService: NotificationService;
  event: IntegrationEvent<any>;
  logger: typeof import('core-service').logger;
}

/**
 * Type for event handler functions
 */
export type EventHandler<T = any> = (
  context: HandlerContext
) => Promise<void> | void;
