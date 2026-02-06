/**
 * Redis Client - With health check, configuration, and read replica support
 * 
 * Features:
 * - Standalone mode (default)
 * - Sentinel mode (master-slave with automatic failover)
 * - Read/write splitting (read from replicas, write to master)
 * - Health checks and monitoring
 * 
 * Usage:
 * - Standalone: connectRedis('redis://localhost:6379')
 * - Sentinel: connectRedis({ sentinel: { hosts: [...], name: 'mymaster' } })
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../../common/logger.js';
import { getErrorMessage } from '../../common/errors.js';

let client: RedisClientType | null = null;
let readClient: RedisClientType | null = null; // For read replica

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

export interface RedisSentinelConfig {
  /** Sentinel hosts (e.g., [{ host: 'sentinel1', port: 26379 }]) */
  hosts: Array<{ host: string; port: number }>;
  /** Master name (e.g., 'mymaster') */
  name: string;
  /** Sentinel password (optional) */
  password?: string;
}

export interface RedisReplicaConfig {
  /** Enable read/write splitting */
  enabled: boolean;
  /** Read replica URLs (for load balancing) */
  urls?: string[];
  /** Strategy: 'round-robin' | 'random' | 'first-available' */
  strategy?: 'round-robin' | 'random' | 'first-available';
}

export interface RedisConfig {
  url: string;
  /** Connection timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Socket idle timeout in ms - auto-close idle sockets (default: undefined - no timeout) */
  socketTimeout?: number;
  /** Enable auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts before giving up (default: 10) */
  maxReconnectRetries?: number;
  /** Delay between reconnect attempts in ms (default: 1000) */
  reconnectDelay?: number;
  /** Client name for monitoring (shows in CLIENT LIST) */
  clientName?: string;
  /** Send PING at interval in ms to keep connection alive (useful for Azure Cache) */
  pingInterval?: number;
  /** Max commands queue length - prevents memory issues (default: unlimited) */
  commandsQueueMaxLength?: number;
  /** Disable offline queue - reject commands when disconnected (default: false) */
  disableOfflineQueue?: boolean;
  /** Sentinel configuration (for master-slave with auto-failover) */
  sentinel?: RedisSentinelConfig;
  /** Read replica configuration (for read/write splitting) */
  readReplicas?: RedisReplicaConfig;
}

const DEFAULT_CONFIG: Omit<Required<RedisConfig>, 'url' | 'sentinel' | 'readReplicas' | 'clientName' | 'pingInterval' | 'commandsQueueMaxLength'> = {
  connectTimeout: 5000,
  socketTimeout: 0, // 0 = no timeout (use pingInterval instead for keep-alive)
  autoReconnect: true,
  maxReconnectRetries: 10,
  reconnectDelay: 1000,
  disableOfflineQueue: false,
};

// Round-robin counter for read replica selection
let replicaIndex = 0;

// ═══════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════

export async function connectRedis(urlOrConfig: string | RedisConfig): Promise<RedisClientType> {
  if (client) return client;

  const config: RedisConfig = typeof urlOrConfig === 'string' ? { url: urlOrConfig } : urlOrConfig;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Check for Sentinel configuration (master-slave with auto-failover)
  if (config.sentinel) {
    return connectRedisSentinel(config.sentinel, cfg);
  }

  let redisUrl = cfg.url;
  let password: string | undefined;
  
  const urlMatch = redisUrl.match(/^redis:\/\/:([^@]+)@(.+)$/);
  if (urlMatch) {
    password = urlMatch[1];
    redisUrl = `redis://${urlMatch[2]}`;
  } else {
    password = process.env.REDIS_PASSWORD;
  }

  // Build client options using node-redis v5 features
  const clientOptions: any = {
    url: redisUrl,
    socket: {
      connectTimeout: cfg.connectTimeout,
      // Socket idle timeout (auto-close idle connections)
      socketTimeout: cfg.socketTimeout || undefined,
      // Keep TCP connection alive
      keepAlive: true,
      keepAliveInitialDelay: 5000,
      // Disable Nagle's algorithm for lower latency
      noDelay: true,
      // Reconnect strategy with exponential backoff + jitter
      reconnectStrategy: cfg.autoReconnect 
        ? (retries: number) => {
            if (retries > cfg.maxReconnectRetries) {
              logger.error('Redis max reconnect attempts reached');
              return new Error('Max reconnect attempts reached');
            }
            // Exponential backoff with jitter (node-redis v5 best practice)
            const jitter = Math.floor(Math.random() * 200);
            const delay = Math.min(Math.pow(2, retries) * 50, cfg.reconnectDelay || 2000);
            return delay + jitter;
          }
        : false,
    },
    // Disable offline queue if configured (reject commands when disconnected)
    disableOfflineQueue: cfg.disableOfflineQueue,
  };

  // Client name (visible in CLIENT LIST for debugging)
  if (cfg.clientName) {
    clientOptions.name = cfg.clientName;
  }
  
  // Ping interval (keep connection alive, useful for Azure Cache)
  if (cfg.pingInterval) {
    clientOptions.pingInterval = cfg.pingInterval;
  }
  
  // Commands queue max length (prevent memory issues)
  if (cfg.commandsQueueMaxLength) {
    clientOptions.commandsQueueMaxLength = cfg.commandsQueueMaxLength;
  }

  if (password) {
    clientOptions.password = password;
  }

  client = createClient(clientOptions);
  
  // Event handlers (node-redis v5)
  client.on('error', (err) => logger.error('Redis error', { error: err.message }));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));
  client.on('ready', () => logger.debug('Redis ready'));
  client.on('end', () => logger.debug('Redis connection closed'));
  
  await client.connect();
  
  // Get Redis server info for logging
  let redisVersion = 'unknown';
  try {
    const info = await client.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    if (versionMatch) redisVersion = versionMatch[1];
  } catch { /* ignore */ }
  
  logger.info('Connected to Redis', { 
    url: redisUrl.replace(/:[^:@]+@/, ':***@'),
    authenticated: !!password,
    mode: 'standalone',
    redisVersion,
    clientName: cfg.clientName || 'default',
    pingInterval: cfg.pingInterval,
  });
  
  // Connect to read replicas if configured
  if (config.readReplicas?.enabled && config.readReplicas.urls?.length) {
    await connectReadReplicas(config.readReplicas, cfg);
  }
  
  return client;
}

/**
 * Connect to Redis Sentinel (master-slave with automatic failover)
 * 
 * @example
 * await connectRedis({
 *   url: 'redis://localhost:6379', // fallback
 *   sentinel: {
 *     hosts: [
 *       { host: 'sentinel1', port: 26379 },
 *       { host: 'sentinel2', port: 26379 },
 *     ],
 *     name: 'mymaster',
 *     password: 'optional-sentinel-password',
 *   },
 * });
 */
async function connectRedisSentinel(
  sentinel: RedisSentinelConfig,
  cfg: RedisConfig & typeof DEFAULT_CONFIG
): Promise<RedisClientType> {
  const sentinelOptions: any = {
    sentinels: sentinel.hosts,
    name: sentinel.name,
    socket: {
      connectTimeout: cfg.connectTimeout,
      reconnectStrategy: cfg.autoReconnect
        ? (retries: number) => {
            if (retries > cfg.maxReconnectRetries) {
              logger.error('Redis Sentinel max reconnect attempts reached');
              return new Error('Max reconnect attempts reached');
            }
            return cfg.reconnectDelay;
          }
        : false,
    },
  };

  if (sentinel.password) {
    sentinelOptions.sentinelPassword = sentinel.password;
  }

  // Extract password from URL if present
  const urlMatch = cfg.url.match(/^redis:\/\/:([^@]+)@/);
  if (urlMatch) {
    sentinelOptions.password = urlMatch[1];
  } else if (process.env.REDIS_PASSWORD) {
    sentinelOptions.password = process.env.REDIS_PASSWORD;
  }

  client = createClient(sentinelOptions);
  client.on('error', (err) => logger.error('Redis Sentinel error', { error: err.message }));
  client.on('reconnecting', () => logger.warn('Redis Sentinel reconnecting...'));
  client.on('ready', () => logger.debug('Redis Sentinel ready'));
  
  await client.connect();
  logger.info('Connected to Redis via Sentinel', { 
    masterName: sentinel.name,
    sentinels: sentinel.hosts.length,
    mode: 'sentinel',
  });
  
  return client;
}

/**
 * Connect to read replicas for read/write splitting
 */
async function connectReadReplicas(
  replicaConfig: RedisReplicaConfig,
  cfg: RedisConfig & typeof DEFAULT_CONFIG
): Promise<void> {
  if (!replicaConfig.urls || replicaConfig.urls.length === 0) return;
  
  // For now, connect to first replica (can be extended for multiple)
  const replicaUrl = replicaConfig.urls[0];
  
  let url = replicaUrl;
  let password: string | undefined;
  
  const urlMatch = url.match(/^redis:\/\/:([^@]+)@(.+)$/);
  if (urlMatch) {
    password = urlMatch[1];
    url = `redis://${urlMatch[2]}`;
  }

  const options: any = {
    url,
    socket: {
      connectTimeout: cfg.connectTimeout,
      reconnectStrategy: cfg.autoReconnect
        ? (retries: number) => {
            if (retries > cfg.maxReconnectRetries) return new Error('Max reconnect attempts');
            return cfg.reconnectDelay;
          }
        : false,
    },
    readonly: true, // Mark as read-only replica
  };

  if (password) options.password = password;

  readClient = createClient(options);
  readClient.on('error', (err) => logger.warn('Redis read replica error', { error: err.message }));
  
  await readClient.connect();
  logger.info('Connected to Redis read replica', { 
    url: url.replace(/:[^:@]+@/, ':***@'),
    strategy: replicaConfig.strategy || 'first-available',
  });
}

/**
 * Get Redis client for WRITE operations (always returns master)
 */
export function getRedis(): RedisClientType | null {
  return client;
}

/**
 * Get Redis client for READ operations
 * Uses read replica if available, otherwise falls back to master
 */
export function getRedisForRead(): RedisClientType | null {
  // Use read replica if available and connected
  if (readClient) {
    return readClient;
  }
  // Fall back to master
  return client;
}

/**
 * Check if read replica is available
 */
export function hasReadReplica(): boolean {
  return readClient !== null;
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
      error: getErrorMessage(error),
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
  // Close read replica first
  if (readClient) {
    try {
      await readClient.quit();
      readClient = null;
      logger.debug('Redis read replica disconnected');
    } catch (error) {
      logger.warn('Error closing Redis read replica', { error });
    }
  }
  
  // Close master
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis disconnected');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Redis Stats
// ═══════════════════════════════════════════════════════════════════

export interface RedisConnectionStats {
  connected: boolean;
  mode: 'standalone' | 'sentinel' | 'cluster';
  hasReadReplica: boolean;
  master: {
    connected: boolean;
  };
  replica: {
    connected: boolean;
    count: number;
  };
}

/**
 * Get Redis connection statistics
 */
export function getRedisConnectionStats(): RedisConnectionStats {
  return {
    connected: client !== null,
    mode: 'standalone', // Will be 'sentinel' if using sentinel
    hasReadReplica: readClient !== null,
    master: {
      connected: client !== null,
    },
    replica: {
      connected: readClient !== null,
      count: readClient ? 1 : 0,
    },
  };
}
