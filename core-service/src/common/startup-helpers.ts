/**
 * Service Startup Helpers
 * 
 * Provides robust error handling for service initialization.
 * Uses the centralized retry() function for consistent retry logic.
 */

import { logger } from './logger.js';
import { connectDatabase, checkDatabaseHealth } from '../databases/mongodb.js';
import { connectRedis, checkRedisHealth } from '../databases/redis.js';
import { setupGracefulShutdown } from './lifecycle.js';
import { getErrorMessage } from './errors.js';
import { retry } from './retry.js';

export interface StartupOptions {
  /** Service name */
  serviceName: string;
  /** MongoDB connection URI */
  mongoUri?: string;
  /** Redis connection URL (optional) */
  redisUrl?: string;
  /** Whether MongoDB is required (default: true) */
  requireMongo?: boolean;
  /** Whether Redis is required (default: false) */
  requireRedis?: boolean;
  /** Number of retries after initial attempt (default: 2, total 3 attempts) */
  maxRetries?: number;
  /** Retry delay in ms (default: 2000) */
  retryDelay?: number;
  /** Enable graceful shutdown handlers (default: true) */
  enableGracefulShutdown?: boolean;
}

/**
 * Initialize database connection with retry logic
 */
export async function initializeDatabase(
  uri: string,
  options: { maxRetries?: number; retryDelay?: number } = {}
): Promise<void> {
  const { maxRetries = 2, retryDelay = 2000 } = options;

  await retry(
    async () => {
      await connectDatabase(uri);
      const health = await checkDatabaseHealth();
      if (!health.healthy) {
        throw new Error('Database health check failed');
      }
    },
    {
      maxRetries,
      strategy: 'fixed',
      baseDelay: retryDelay,
      jitter: false,
      name: 'Database connection',
    }
  );

  logger.info('Database connection established and verified');
}

/**
 * Initialize Redis connection with graceful degradation
 */
export async function initializeRedis(
  url: string | undefined,
  options: { required?: boolean; maxRetries?: number; retryDelay?: number } = {}
): Promise<boolean> {
  const { required = false, maxRetries = 2, retryDelay = 2000 } = options;

  if (!url) {
    if (required) {
      throw new Error('Redis URL is required but not provided');
    }
    logger.warn('Redis not configured - continuing without Redis');
    return false;
  }

  try {
    await retry(
      async () => {
        await connectRedis(url);
        const health = await checkRedisHealth();
        if (!health.healthy) {
          throw new Error('Redis health check failed');
        }
      },
      {
        maxRetries,
        strategy: 'fixed',
        baseDelay: retryDelay,
        jitter: false,
        name: 'Redis connection',
      }
    );

    logger.info('Redis connection established and verified');
    return true;
  } catch (error) {
    if (required) {
      throw error;
    }
    logger.warn('Redis connection failed - continuing without Redis', {
      error: getErrorMessage(error),
    });
    return false;
  }
}

/**
 * Comprehensive service startup with error handling
 */
export async function initializeService(options: StartupOptions): Promise<{
  databaseConnected: boolean;
  redisConnected: boolean;
}> {
  const {
    serviceName,
    mongoUri,
    redisUrl,
    requireMongo = true,
    requireRedis = false,
    maxRetries = 2,
    retryDelay = 2000,
    enableGracefulShutdown = true,
  } = options;

  logger.info(`Initializing ${serviceName}...`);

  if (enableGracefulShutdown) {
    setupGracefulShutdown();
    logger.debug('Graceful shutdown handlers registered');
  }

  let databaseConnected = false;
  if (mongoUri) {
    try {
      await initializeDatabase(mongoUri, { maxRetries, retryDelay });
      databaseConnected = true;
    } catch (error) {
      if (requireMongo) {
        logger.error(`Failed to initialize database for ${serviceName}`, {
          error: getErrorMessage(error),
        });
        throw error;
      }
      logger.warn(`Database initialization failed for ${serviceName} - continuing without database`, {
        error: getErrorMessage(error),
      });
    }
  } else if (requireMongo) {
    throw new Error(`MongoDB URI is required for ${serviceName} but not provided`);
  }

  let redisConnected = false;
  try {
    redisConnected = await initializeRedis(redisUrl, {
      required: requireRedis,
      maxRetries,
      retryDelay,
    });
  } catch (error) {
    if (requireRedis) {
      logger.error(`Failed to initialize Redis for ${serviceName}`, {
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  logger.info(`${serviceName} initialization complete`, {
    databaseConnected,
    redisConnected,
  });

  return { databaseConnected, redisConnected };
}

/**
 * Safe initialization wrapper - catches and logs errors without throwing
 * Useful for optional components like webhooks, ledger, etc.
 */
export async function safeInitialize<T>(
  name: string,
  initFn: () => Promise<T>,
  options: { required?: boolean; logError?: boolean } = {}
): Promise<T | null> {
  const { required = false, logError = true } = options;

  try {
    const result = await initFn();
    logger.info(`${name} initialized successfully`);
    return result;
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    if (required) {
      logger.error(`Failed to initialize ${name} (required)`, { error: errorMsg });
      throw error;
    }
    if (logError) {
      logger.warn(`Failed to initialize ${name} (optional) - continuing without it`, {
        error: errorMsg,
      });
    }
    return null;
  }
}
