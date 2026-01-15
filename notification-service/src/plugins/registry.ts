/**
 * Handler Registry - Manages notification event handler plugins
 * 
 * Allows dynamic registration of handlers, making notification-service
 * extensible and able to work with or without specific service integrations.
 */

import { logger, on } from 'core-service';
import type { IntegrationEvent } from 'core-service';
import type { NotificationService } from '../notification-service.js';
import type { NotificationHandlerPlugin } from './types.js';

class HandlerRegistry {
  private plugins: Map<string, NotificationHandlerPlugin> = new Map();
  private initialized = false;

  /**
   * Register a handler plugin
   */
  register(plugin: NotificationHandlerPlugin): void {
    if (this.plugins.has(plugin.name)) {
      logger.warn(`Handler plugin ${plugin.name} already registered, skipping`);
      return;
    }

    if (!plugin.isAvailable()) {
      logger.info(`Handler plugin ${plugin.name} is not available, skipping registration`);
      return;
    }

    this.plugins.set(plugin.name, plugin);
    logger.info(`Registered handler plugin: ${plugin.name}`, {
      description: plugin.description,
      channels: plugin.channels,
      eventTypes: plugin.eventTypes,
    });
  }

  /**
   * Initialize all registered plugins
   */
  initialize(notificationService: NotificationService): void {
    if (this.initialized) {
      logger.warn('Handler registry already initialized');
      return;
    }

    logger.info(`Initializing ${this.plugins.size} handler plugins`);

    for (const [name, plugin] of this.plugins) {
      try {
        plugin.initialize(notificationService);
        logger.info(`Initialized handler plugin: ${name}`);
      } catch (error) {
        logger.error(`Failed to initialize handler plugin ${name}`, { error });
      }
    }

    this.initialized = true;
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): NotificationHandlerPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin by name
   */
  getPlugin(name: string): NotificationHandlerPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all channels that handlers are listening to
   */
  getChannels(): string[] {
    const channels = new Set<string>();
    for (const plugin of this.plugins.values()) {
      for (const channel of plugin.channels) {
        channels.add(channel);
      }
    }
    return Array.from(channels);
  }

  /**
   * Check if any handlers are registered
   */
  hasHandlers(): boolean {
    return this.plugins.size > 0;
  }
}

// Singleton instance
export const handlerRegistry = new HandlerRegistry();

/**
 * Register a notification handler plugin
 * Convenience function that uses the singleton registry
 */
export function registerNotificationHandler(plugin: NotificationHandlerPlugin): void {
  handlerRegistry.register(plugin);
}
