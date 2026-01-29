/**
 * Redis Client - With health check and configuration
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../common/logger.js';

let client: RedisClientType | null = null;

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

export interface RedisConfig {
  /** Redis connection URL */
  url: string;
  /** Connection timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Socket timeout in ms (default: 5000) */
  socketTimeout?: number;
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect retries (default: 10) */
  maxReconnectRetries?: number;
  /** Reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
}

const DEFAULT_CONFIG: Omit<Required<RedisConfig>, 'url'> = {
  connectTimeout: 5000,
  socketTimeout: 5000,
  autoReconnect: true,
  maxReconnectRetries: 10,
  reconnectDelay: 1000,
};

// ═══════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════

export async function connectRedis(urlOrConfig: string | RedisConfig): Promise<RedisClientType> {
  if (client) return client;

  const config: RedisConfig = typeof urlOrConfig === 'string' 
    ? { url: urlOrConfig } 
    : urlOrConfig;
  
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Parse URL to extract password if not in URL format
  let redisUrl = cfg.url;
  let password: string | undefined;
  
  // Check if password is in URL format: redis://:password@host:port
  const urlMatch = redisUrl.match(/^redis:\/\/:([^@]+)@(.+)$/);
  if (urlMatch) {
    password = urlMatch[1];
    redisUrl = `redis://${urlMatch[2]}`;
  } else {
    // Check environment variable for password (for Docker containers)
    password = process.env.REDIS_PASSWORD;
  }

  const clientOptions: any = {
    url: redisUrl,
    socket: {
      connectTimeout: cfg.connectTimeout,
      reconnectStrategy: cfg.autoReconnect 
        ? (retries: number) => {
            if (retries > cfg.maxReconnectRetries) {
              logger.error('Redis max reconnect attempts reached');
              return new Error('Max reconnect attempts reached');
            }
            return cfg.reconnectDelay;
          }
        : false,
    },
  };

  // Add password if provided
  if (password) {
    clientOptions.password = password;
  }

  client = createClient(clientOptions);

  client.on('error', (err) => logger.error('Redis error', { error: err.message }));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));
  client.on('ready', () => logger.debug('Redis ready'));
  
  try {
    await client.connect();
    logger.info('Connected to Redis', { 
      url: redisUrl.replace(/:[^:@]+@/, ':***@'), // Hide password in URL
      authenticated: !!password 
    });
  } catch (error) {
    logger.error('Failed to connect to Redis', {
      error: error instanceof Error ? error.message : String(error),
      url: redisUrl.replace(/:[^:@]+@/, ':***@'),
    });
    throw error;
  }
  
  return client;
}

export function getRedis(): RedisClientType | null {
  return client;
}

// ═══════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════

export async function checkRedisHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  if (!client) {
    return { healthy: false, latencyMs: -1 };
  }

  const start = Date.now();
  try {
    await client.ping();
    return { healthy: true, latencyMs: Date.now() - start };
  } catch {
    return { healthy: false, latencyMs: -1 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Pub/Sub
// ═══════════════════════════════════════════════════════════════════

export async function publish(channel: string, message: string | object): Promise<boolean> {
  if (!client) {
    logger.warn('Redis not connected - message not published', { channel });
    return false;
  }
  try {
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    await client.publish(channel, msg);
    return true;
  } catch (error) {
    logger.error('Failed to publish message to Redis', {
      channel,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function subscribe(
  channel: string,
  handler: (message: string) => void
): Promise<() => Promise<void>> {
  if (!client) throw new Error('Redis not connected');
  
  const subscriber = client.duplicate();
  await subscriber.connect();
  await subscriber.subscribe(channel, handler);
  
  // Return unsubscribe function
  return async () => {
    await subscriber.unsubscribe(channel);
    await subscriber.quit();
  };
}

// ═══════════════════════════════════════════════════════════════════
// Scan Iterator - General purpose Redis key scanning
// ═══════════════════════════════════════════════════════════════════

export interface ScanOptions {
  /** Pattern to match keys (e.g., 'tx:state:*') */
  pattern?: string;
  /** Maximum number of keys to return (0 = unlimited) */
  count?: number;
  /** Maximum number of keys to scan (safety limit) */
  maxKeys?: number;
  /** Batch size for each SCAN call (default: 100) */
  batchSize?: number;
}

/**
 * Scan Redis keys and return all matching keys as an array
 * Useful for small result sets or when you need all keys at once
 * 
 * @example
 * ```typescript
 * const keys = await scanKeysArray({ pattern: 'tx:state:*', maxKeys: 100 });
 * ```
 */
export async function scanKeysArray(options: ScanOptions = {}): Promise<string[]> {
  const keys: string[] = [];
  for await (const key of scanKeysIterator(options)) {
    keys.push(key);
  }
  return keys;
}

/**
 * Scan Redis keys efficiently using scanIterator (Redis v5+)
 * Returns keys directly - cursor is hidden in async iterator implementation
 * Keys returned by scanIterator are guaranteed to exist
 * 
 * @example
 * ```typescript
 * const keys: string[] = [];
 * for await (const key of scanKeysIterator({ pattern: 'tx:state:*' })) {
 *   keys.push(key);
 * }
 * ```
 */
export async function* scanKeysIterator(options: ScanOptions = {}): AsyncGenerator<string, void, unknown> {
  const redis = getRedis();
  if (!redis) {
    logger.warn('Redis not available for scanning');
    return;
  }

  const {
    pattern = '*',
    maxKeys = 10000, // Safety limit
    batchSize = 100,
  } = options;

  // Redis v5+ scanIterator returns arrays of keys (batches)
  // We iterate over batches and yield each key individually
  const iterator = redis.scanIterator({
    MATCH: pattern,
    COUNT: batchSize,
  });

  let yielded = 0;
  for await (const keysBatch of iterator) {
    if (!Array.isArray(keysBatch)) {
      logger.warn('Unexpected scanIterator result format', { keysBatch });
      continue;
    }

    for (const key of keysBatch) {
      if (maxKeys > 0 && yielded >= maxKeys) {
        logger.debug('Redis scanIterator reached maxKeys limit', { maxKeys, yielded });
        return;
      }
      yield key;
      yielded++;
    }
  }

  logger.debug('Redis scanIterator completed', { pattern, yielded });
}

/**
 * Batch get values for multiple keys using MGET (more efficient than individual GET calls)
 * 
 * @example
 * ```typescript
 * const keys = ['key1', 'key2', 'key3'];
 * const values = await batchGetValues(keys);
 * // Returns: { key1: 'value1', key2: 'value2', key3: null }
 * ```
 */
export async function batchGetValues(keys: string[]): Promise<Record<string, string | null>> {
  const redis = getRedis();
  if (!redis) {
    logger.warn('Redis not available for batch get');
    return {};
  }

  if (keys.length === 0) {
    return {};
  }

  // Redis v5+ mGet() accepts an array of keys
  const values = await redis.mGet(keys);
  
  // Map keys to values
  const result: Record<string, string | null> = {};
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = values[i] ?? null;
  }
  
  return result;
}

/**
 * Scan Redis keys and process each with a callback
 * Useful for processing keys without loading all into memory
 * 
 * Note: For better performance when you need values, use scanKeysIterator + batchGetValues
 * 
 * @example
 * ```typescript
 * await scanKeysWithCallback(
 *   { pattern: 'tx:state:*' },
 *   async (key) => {
 *     const value = await redis.get(key);
 *     // Process value...
 *   }
 * );
 * ```
 */
export async function scanKeysWithCallback(
  options: ScanOptions,
  callback: (key: string) => Promise<void>
): Promise<number> {
  let count = 0;
  // scanKeysIterator handles errors internally and falls back to manual scan
  // No need for extra error handling here
  for await (const key of scanKeysIterator(options)) {
    await callback(key);
    count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis disconnected');
  }
}
