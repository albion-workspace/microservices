/**
 * Service Startup Helpers
 * 
 * Provides robust error handling for service initialization
 */

import { logger } from './logger.js';
import { connectDatabase, checkDatabaseHealth } from '../databases/mongodb.js';
import { connectRedis, getRedis, checkRedisHealth } from '../databases/redis.js';
import { setupGracefulShutdown } from './lifecycle.js';
import { getErrorMessage } from './errors.js';

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
  /** Max retries for database connection (default: 3) */
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
  const { maxRetries = 3, retryDelay = 2000 } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await connectDatabase(uri);
      // Verify connection with health check
      const health = await checkDatabaseHealth();
      if (!health.healthy) {
        throw new Error('Database health check failed');
      }
      logger.info('Database connection established and verified');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`Database connection attempt ${attempt}/${maxRetries} failed`, {
        error: getErrorMessage(error),
        attempt,
        maxRetries,
      });

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${getErrorMessage(lastError)}`);
}

/**
 * Initialize Redis connection with graceful degradation
 */
export async function initializeRedis(
  url: string | undefined,
  options: { required?: boolean; maxRetries?: number; retryDelay?: number } = {}
): Promise<boolean> {
  const { required = false, maxRetries = 3, retryDelay = 2000 } = options;

  if (!url) {
    if (required) {
      throw new Error('Redis URL is required but not provided');
    }
    logger.warn('Redis not configured - continuing without Redis');
    return false;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await connectRedis(url);
      // Verify connection with health check
      const health = await checkRedisHealth();
      if (!health.healthy) {
        throw new Error('Redis health check failed');
      }
      logger.info('Redis connection established and verified');
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`Redis connection attempt ${attempt}/${maxRetries} failed`, {
        error: getErrorMessage(error),
        attempt,
        maxRetries,
      });

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  if (required) {
    throw new Error(`Failed to connect to Redis after ${maxRetries} attempts: ${getErrorMessage(lastError)}`);
  }

  logger.warn(`Redis connection failed after ${maxRetries} attempts - continuing without Redis`);
  return false;
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
    maxRetries = 3,
    retryDelay = 2000,
    enableGracefulShutdown = true,
  } = options;

  logger.info(`Initializing ${serviceName}...`);

  // Setup graceful shutdown handlers
  if (enableGracefulShutdown) {
    setupGracefulShutdown();
    logger.debug('Graceful shutdown handlers registered');
  }

  // Initialize database
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
      } else {
        logger.warn(`Database initialization failed for ${serviceName} - continuing without database`, {
          error: getErrorMessage(error),
        });
      }
    }
  } else if (requireMongo) {
    throw new Error(`MongoDB URI is required for ${serviceName} but not provided`);
  }

  // Initialize Redis
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
    // Already logged in initializeRedis
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
    } else {
      if (logError) {
        logger.warn(`Failed to initialize ${name} (optional) - continuing without it`, {
          error: errorMsg,
        });
      }
      return null;
    }
  }
}
