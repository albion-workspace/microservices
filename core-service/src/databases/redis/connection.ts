/**
 * Redis Client - With health check and configuration
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../../common/logger.js';

let client: RedisClientType | null = null;

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

export interface RedisConfig {
  url: string;
  connectTimeout?: number;
  socketTimeout?: number;
  autoReconnect?: boolean;
  maxReconnectRetries?: number;
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

  const config: RedisConfig = typeof urlOrConfig === 'string' ? { url: urlOrConfig } : urlOrConfig;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let redisUrl = cfg.url;
  let password: string | undefined;
  
  const urlMatch = redisUrl.match(/^redis:\/\/:([^@]+)@(.+)$/);
  if (urlMatch) {
    password = urlMatch[1];
    redisUrl = `redis://${urlMatch[2]}`;
  } else {
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

  if (password) {
    clientOptions.password = password;
  }

  client = createClient(clientOptions);
  client.on('error', (err) => logger.error('Redis error', { error: err.message }));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));
  client.on('ready', () => logger.debug('Redis ready'));
  
  await client.connect();
  logger.info('Connected to Redis', { 
    url: redisUrl.replace(/:[^:@]+@/, ':***@'),
    authenticated: !!password 
  });
  
  return client;
}

export function getRedis(): RedisClientType | null {
  return client;
}

// ═══════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════

export async function checkRedisHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  if (!client) return { healthy: false, latencyMs: -1 };

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
  
  return async () => {
    await subscriber.unsubscribe(channel);
    await subscriber.quit();
  };
}

// ═══════════════════════════════════════════════════════════════════
// Scan Iterator
// ═══════════════════════════════════════════════════════════════════

export interface ScanOptions {
  pattern?: string;
  count?: number;
  maxKeys?: number;
  batchSize?: number;
}

export async function scanKeysArray(options: ScanOptions = {}): Promise<string[]> {
  const keys: string[] = [];
  for await (const key of scanKeysIterator(options)) {
    keys.push(key);
  }
  return keys;
}

export async function* scanKeysIterator(options: ScanOptions = {}): AsyncGenerator<string, void, unknown> {
  const redis = getRedis();
  if (!redis) {
    logger.warn('Redis not available for scanning');
    return;
  }

  const { pattern = '*', maxKeys = 10000, batchSize = 100 } = options;

  const iterator = redis.scanIterator({ MATCH: pattern, COUNT: batchSize });

  let yielded = 0;
  for await (const keysBatch of iterator) {
    if (!Array.isArray(keysBatch)) continue;
    for (const key of keysBatch) {
      if (maxKeys > 0 && yielded >= maxKeys) return;
      yield key;
      yielded++;
    }
  }
}

export async function batchGetValues(keys: string[]): Promise<Record<string, string | null>> {
  const redis = getRedis();
  if (!redis || keys.length === 0) return {};

  const values = await redis.mGet(keys);
  const result: Record<string, string | null> = {};
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = values[i] ?? null;
  }
  return result;
}

export async function scanKeysWithCallback(
  options: ScanOptions,
  callback: (key: string) => Promise<void>
): Promise<number> {
  let count = 0;
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
