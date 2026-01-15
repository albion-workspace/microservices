/**
 * Application Lifecycle Management
 * 
 * Handles graceful shutdown and cleanup
 */

import { logger } from './logger.js';
import { closeDatabase } from './database.js';
import { closeRedis } from './redis.js';

type CleanupHandler = () => Promise<void> | void;

const cleanupHandlers: CleanupHandler[] = [];
let isShuttingDown = false;

// ═══════════════════════════════════════════════════════════════════
// Cleanup Registration
// ═══════════════════════════════════════════════════════════════════

/**
 * Register a cleanup handler to run on shutdown
 * Handlers are run in reverse order (LIFO)
 */
export function onShutdown(handler: CleanupHandler): void {
  cleanupHandlers.push(handler);
}

/**
 * Remove a previously registered cleanup handler
 */
export function offShutdown(handler: CleanupHandler): void {
  const idx = cleanupHandlers.indexOf(handler);
  if (idx >= 0) cleanupHandlers.splice(idx, 1);
}

// ═══════════════════════════════════════════════════════════════════
// Graceful Shutdown
// ═══════════════════════════════════════════════════════════════════

export interface ShutdownOptions {
  /** Timeout for graceful shutdown in ms (default: 30000) */
  timeout?: number;
  /** Exit process after shutdown (default: true) */
  exit?: boolean;
  /** Exit code on successful shutdown (default: 0) */
  exitCode?: number;
}

/**
 * Perform graceful shutdown
 */
export async function shutdown(options: ShutdownOptions = {}): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  const { timeout = 30000, exit = true, exitCode = 0 } = options;

  logger.info('Starting graceful shutdown...');

  // Set timeout for forced exit
  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timeout, forcing exit');
    if (exit) process.exit(1);
  }, timeout);

  try {
    // Run custom cleanup handlers in reverse order
    for (const handler of [...cleanupHandlers].reverse()) {
      try {
        await handler();
      } catch (error) {
        logger.error('Cleanup handler failed', { error: String(error) });
      }
    }

    // Close built-in connections
    await closeRedis().catch(() => {});
    await closeDatabase().catch(() => {});

    clearTimeout(forceExitTimer);
    logger.info('Graceful shutdown complete');

    if (exit) {
      process.exit(exitCode);
    }
  } catch (error) {
    clearTimeout(forceExitTimer);
    logger.error('Shutdown error', { error: String(error) });
    if (exit) process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Signal Handlers
// ═══════════════════════════════════════════════════════════════════

/**
 * Setup signal handlers for graceful shutdown
 * Call this once at application startup
 */
export function setupGracefulShutdown(options: ShutdownOptions = {}): void {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

  for (const signal of signals) {
    process.on(signal, () => {
      logger.info(`Received ${signal}`);
      shutdown(options);
    });
  }

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown({ ...options, exitCode: 1 });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    shutdown({ ...options, exitCode: 1 });
  });

  logger.debug('Graceful shutdown handlers registered');
}

// ═══════════════════════════════════════════════════════════════════
// Health Status
// ═══════════════════════════════════════════════════════════════════

export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}

