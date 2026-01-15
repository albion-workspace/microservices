/**
 * Service Lifecycle Utilities
 * 
 * Common patterns for service initialization, cleanup, and maintenance tasks.
 * Helps reduce code duplication across services.
 */

import { logger } from './logger.js';

// ═══════════════════════════════════════════════════════════════════
// Cleanup Task Management
// ═══════════════════════════════════════════════════════════════════

export interface CleanupTask {
  name: string;
  execute: () => Promise<number>; // Returns number of items cleaned up
  intervalMs: number;
  olderThanDays?: number;
}

/**
 * Setup a periodic cleanup task
 * 
 * @example
 * setupCleanupTask({
 *   name: 'webhook deliveries',
 *   execute: () => webhookManager.cleanupDeliveries(30),
 *   intervalMs: 24 * 60 * 60 * 1000, // Daily
 * });
 */
export function setupCleanupTask(task: CleanupTask): void {
  const intervalMs = task.intervalMs;
  const intervalName = getIntervalName(intervalMs);

  logger.info(`Setting up ${intervalName} cleanup task: ${task.name}`);

  setInterval(async () => {
    try {
      const deleted = await task.execute();
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} ${task.name}`, {
          task: task.name,
          deleted,
        });
      }
    } catch (err) {
      logger.error(`Cleanup task failed: ${task.name}`, { 
        error: err instanceof Error ? err.message : String(err),
        task: task.name,
      });
    }
  }, intervalMs);
}

/**
 * Setup multiple cleanup tasks at once
 */
export function setupCleanupTasks(tasks: CleanupTask[]): void {
  for (const task of tasks) {
    setupCleanupTask(task);
  }
}

function getIntervalName(ms: number): string {
  const seconds = ms / 1000;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;

  if (days >= 1) return `${days} day(s)`;
  if (hours >= 1) return `${hours} hour(s)`;
  if (minutes >= 1) return `${minutes} minute(s)`;
  return `${seconds} second(s)`;
}

// ═══════════════════════════════════════════════════════════════════
// Event Listener Setup Helper
// ═══════════════════════════════════════════════════════════════════

export interface EventListenerConfig {
  redisUrl?: string;
  channels: string[];
  onError?: (error: Error) => void;
}

/**
 * Setup event listener with error handling
 * Returns true if listener was started, false if Redis not configured
 */
export async function setupEventListener(
  config: EventListenerConfig,
  startListeningFn: (channels: string[]) => Promise<void>
): Promise<boolean> {
  if (!config.redisUrl) {
    logger.warn('Redis not configured - event listener disabled');
    return false;
  }

  if (config.channels.length === 0) {
    logger.info('No event channels to listen to');
    return false;
  }

  try {
    await startListeningFn(config.channels);
    logger.info('Event listener started', { channels: config.channels });
    return true;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn('Could not start event listener', { 
      error: error.message,
      channels: config.channels,
    });
    
    if (config.onError) {
      config.onError(error);
    }
    
    return false;
  }
}
