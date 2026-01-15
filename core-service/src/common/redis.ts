/**
 * Redis Client - With health check and configuration
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from './logger.js';

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
// Cleanup
// ═══════════════════════════════════════════════════════════════════

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis disconnected');
  }
}
