/**
 * Service Redis Accessor
 * 
 * Provides Redis access with:
 * - Automatic key prefixing (brand:service:category:key)
 * - Optional per-brand Redis instances
 * - Health check and stats
 * - Consistent API across services
 * 
 * Usage:
 * ```typescript
 * // In your service (e.g., payment-service/src/redis.ts)
 * import { createServiceRedisAccess } from 'core-service';
 * 
 * export const redis = createServiceRedisAccess('payment-service');
 * 
 * // At startup
 * await redis.initialize({ brand: 'acme' });
 * 
 * // Usage - keys are automatically prefixed
 * await redis.set('tx:state:123', { status: 'pending' }, 300);
 * // Actually stores: acme:payment:tx:state:123
 * 
 * const value = await redis.get('tx:state:123');
 * ```
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Consistent with ServiceDatabaseAccessor pattern
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../common/logger.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface RedisStrategyConfig {
  /** Strategy type */
  strategy: 'shared' | 'per-brand';
  /** Default Redis URL (used for 'shared' or as fallback) */
  defaultUrl: string;
  /** Per-brand Redis URLs (used when strategy is 'per-brand') */
  brandUrls?: Record<string, string>;
  /** Default key prefix (optional, overrides auto-generated prefix) */
  keyPrefix?: string;
}

export interface ServiceRedisOptions {
  /** Brand code (used for key prefixing and per-brand routing) */
  brand?: string;
  /** Custom key prefix (overrides auto-generated) */
  keyPrefix?: string;
}

export interface RedisHealthResult {
  healthy: boolean;
  latencyMs: number;
  strategy: 'shared' | 'per-brand';
  brand?: string;
  service: string;
}

export interface RedisStats {
  connectedClients: number;
  usedMemory: string;
  totalKeys: number;
  keysByPrefix: Record<string, number>;
  /** Redis server version */
  redisVersion?: string;
  /** Server uptime in seconds */
  uptimeSeconds?: number;
  /** Total commands processed */
  totalCommandsProcessed?: number;
  /** Operations per second (instantaneous) */
  opsPerSecond?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Module State
// ═══════════════════════════════════════════════════════════════════

/** Shared Redis client (used when strategy is 'shared') */
let sharedClient: RedisClientType | null = null;

/** Per-brand Redis clients (used when strategy is 'per-brand') */
const brandClients = new Map<string, RedisClientType>();

/** Current strategy configuration */
let currentConfig: RedisStrategyConfig | null = null;

// ═══════════════════════════════════════════════════════════════════
// Internal Connection Management
// ═══════════════════════════════════════════════════════════════════

async function connectToRedis(url: string, label: string): Promise<RedisClientType> {
  // Parse URL to extract password
  let redisUrl = url;
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
      connectTimeout: 5000,
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          logger.error(`Redis [${label}] max reconnect attempts reached`);
          return new Error('Max reconnect attempts reached');
        }
        return 1000;
      },
    },
  };

  if (password) {
    clientOptions.password = password;
  }

  const client = createClient(clientOptions);

  client.on('error', (err) => logger.error(`Redis [${label}] error`, { error: err.message }));
  client.on('reconnecting', () => logger.warn(`Redis [${label}] reconnecting...`));
  client.on('ready', () => logger.debug(`Redis [${label}] ready`));

  await client.connect();
  logger.info(`Connected to Redis [${label}]`, { 
    url: redisUrl.replace(/:[^:@]+@/, ':***@'),
  });

  return client as RedisClientType;
}

// ═══════════════════════════════════════════════════════════════════
// Strategy Configuration
// ═══════════════════════════════════════════════════════════════════

/**
 * Configure Redis strategy globally
 * Call this once at application startup
 */
export async function configureRedisStrategy(config: RedisStrategyConfig): Promise<void> {
  currentConfig = config;
  
  if (config.strategy === 'shared') {
    // Connect to single shared Redis
    if (!sharedClient) {
      sharedClient = await connectToRedis(config.defaultUrl, 'shared');
    }
  }
  // For 'per-brand', connections are created lazily when needed
  
  logger.info('Redis strategy configured', { 
    strategy: config.strategy,
    hasBrandUrls: !!config.brandUrls && Object.keys(config.brandUrls).length > 0,
  });
}

/**
 * Get Redis client for a specific brand
 * For 'shared' strategy, returns the shared client
 * For 'per-brand' strategy, returns brand-specific client (creates if needed)
 */
async function getClientForBrand(brand?: string): Promise<RedisClientType> {
  if (!currentConfig) {
    throw new Error('Redis strategy not configured. Call configureRedisStrategy() first.');
  }

  if (currentConfig.strategy === 'shared' || !brand) {
    if (!sharedClient) {
      sharedClient = await connectToRedis(currentConfig.defaultUrl, 'shared');
    }
    return sharedClient;
  }

  // Per-brand strategy
  let client = brandClients.get(brand);
  if (!client) {
    const url = currentConfig.brandUrls?.[brand] || currentConfig.defaultUrl;
    client = await connectToRedis(url, `brand:${brand}`);
    brandClients.set(brand, client);
  }
  return client;
}

// ═══════════════════════════════════════════════════════════════════
// Service Redis Accessor
// ═══════════════════════════════════════════════════════════════════

export interface ServiceRedisAccessor {
  /** Initialize Redis for this service */
  initialize(options?: ServiceRedisOptions): Promise<void>;
  
  /** Get raw Redis client (use sparingly) */
  getClient(): RedisClientType;
  
  /** Get service name */
  getServiceName(): string;
  
  /** Get current key prefix */
  getKeyPrefix(): string;
  
  /** Build full key with prefix */
  buildKey(key: string): string;
  
  /** Build key with custom category */
  buildKey(category: string, key: string): string;
  
  // ═══════════════════════════════════════════════════════════════
  // Key-Value Operations (auto-prefixed)
  // ═══════════════════════════════════════════════════════════════
  
  /** Get value by key */
  get<T = string>(key: string): Promise<T | null>;
  
  /** Set value with optional TTL */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  
  /** Delete key */
  del(key: string): Promise<boolean>;
  
  /** Check if key exists */
  exists(key: string): Promise<boolean>;
  
  /** Set TTL on existing key */
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  
  /** Get remaining TTL */
  ttl(key: string): Promise<number>;
  
  // ═══════════════════════════════════════════════════════════════
  // Batch Operations
  // ═══════════════════════════════════════════════════════════════
  
  /** Get multiple values */
  mget<T = string>(keys: string[]): Promise<(T | null)[]>;
  
  /** Set multiple values */
  mset(entries: Array<{ key: string; value: unknown; ttl?: number }>): Promise<void>;
  
  /** Delete multiple keys */
  mdel(keys: string[]): Promise<number>;
  
  // ═══════════════════════════════════════════════════════════════
  // Scan Operations
  // ═══════════════════════════════════════════════════════════════
  
  /** Scan keys matching pattern (auto-prefixed) */
  scan(pattern: string, options?: { maxKeys?: number }): AsyncGenerator<string>;
  
  /** Get all keys matching pattern */
  keys(pattern: string, options?: { maxKeys?: number }): Promise<string[]>;
  
  /** Delete all keys matching pattern */
  deletePattern(pattern: string): Promise<number>;
  
  // ═══════════════════════════════════════════════════════════════
  // Pub/Sub (auto-prefixed channels)
  // ═══════════════════════════════════════════════════════════════
  
  /** Publish message to channel */
  publish(channel: string, message: unknown): Promise<boolean>;
  
  /** Subscribe to channel */
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
  
  // ═══════════════════════════════════════════════════════════════
  // Health & Stats
  // ═══════════════════════════════════════════════════════════════
  
  /** Check Redis health */
  checkHealth(): Promise<RedisHealthResult>;
  
  /** Get Redis stats */
  getStats(): Promise<RedisStats>;
  
  /** Check if initialized */
  isInitialized(): boolean;
}

/**
 * Create a service-specific Redis accessor
 * 
 * @param serviceName - Name of the service (e.g., 'payment-service')
 * @returns ServiceRedisAccessor instance
 */
export function createServiceRedisAccess(serviceName: string): ServiceRedisAccessor {
  let initialized = false;
  let brand: string | undefined;
  let keyPrefix: string;
  let client: RedisClientType | null = null;

  // Build default key prefix: {brand}:{service}:
  const updateKeyPrefix = () => {
    keyPrefix = brand ? `${brand}:${serviceName}:` : `${serviceName}:`;
  };
  updateKeyPrefix();

  const ensureInitialized = () => {
    if (!initialized || !client) {
      throw new Error(`ServiceRedisAccessor [${serviceName}] not initialized. Call initialize() first.`);
    }
  };

  const buildFullKey = (key: string): string => {
    return `${keyPrefix}${key}`;
  };

  const accessor: ServiceRedisAccessor = {
    async initialize(options?: ServiceRedisOptions): Promise<void> {
      if (initialized) {
        logger.debug(`ServiceRedisAccessor [${serviceName}] already initialized`);
        return;
      }

      brand = options?.brand;
      if (options?.keyPrefix) {
        keyPrefix = options.keyPrefix;
      } else {
        updateKeyPrefix();
      }

      // Get client based on strategy
      client = await getClientForBrand(brand);
      initialized = true;

      logger.info(`ServiceRedisAccessor [${serviceName}] initialized`, {
        brand: brand || 'default',
        keyPrefix,
        strategy: currentConfig?.strategy || 'shared',
      });
    },

    getClient(): RedisClientType {
      ensureInitialized();
      return client!;
    },

    getServiceName(): string {
      return serviceName;
    },

    getKeyPrefix(): string {
      return keyPrefix;
    },

    buildKey(categoryOrKey: string, key?: string): string {
      if (key !== undefined) {
        return buildFullKey(`${categoryOrKey}:${key}`);
      }
      return buildFullKey(categoryOrKey);
    },

    // ═══════════════════════════════════════════════════════════════
    // Key-Value Operations
    // ═══════════════════════════════════════════════════════════════

    async get<T = string>(key: string): Promise<T | null> {
      ensureInitialized();
      const fullKey = buildFullKey(key);
      const value = await client!.get(fullKey);
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    },

    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      ensureInitialized();
      const fullKey = buildFullKey(key);
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlSeconds) {
        await client!.setEx(fullKey, ttlSeconds, serialized);
      } else {
        await client!.set(fullKey, serialized);
      }
    },

    async del(key: string): Promise<boolean> {
      ensureInitialized();
      const fullKey = buildFullKey(key);
      const result = await client!.del(fullKey);
      return result > 0;
    },

    async exists(key: string): Promise<boolean> {
      ensureInitialized();
      const fullKey = buildFullKey(key);
      const result = await client!.exists(fullKey);
      return result > 0;
    },

    async expire(key: string, ttlSeconds: number): Promise<boolean> {
      ensureInitialized();
      const fullKey = buildFullKey(key);
      const result = await client!.expire(fullKey, ttlSeconds);
      return Boolean(result);
    },

    async ttl(key: string): Promise<number> {
      ensureInitialized();
      const fullKey = buildFullKey(key);
      return await client!.ttl(fullKey);
    },

    // ═══════════════════════════════════════════════════════════════
    // Batch Operations
    // ═══════════════════════════════════════════════════════════════

    async mget<T = string>(keys: string[]): Promise<(T | null)[]> {
      ensureInitialized();
      const fullKeys = keys.map(buildFullKey);
      const values = await client!.mGet(fullKeys);
      return values.map(v => {
        if (v === null) return null;
        try {
          return JSON.parse(v) as T;
        } catch {
          return v as unknown as T;
        }
      });
    },

    async mset(entries: Array<{ key: string; value: unknown; ttl?: number }>): Promise<void> {
      ensureInitialized();
      // Use pipeline for efficiency
      const pipeline = client!.multi();
      for (const entry of entries) {
        const fullKey = buildFullKey(entry.key);
        const serialized = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
        if (entry.ttl) {
          pipeline.setEx(fullKey, entry.ttl, serialized);
        } else {
          pipeline.set(fullKey, serialized);
        }
      }
      await pipeline.exec();
    },

    async mdel(keys: string[]): Promise<number> {
      ensureInitialized();
      if (keys.length === 0) return 0;
      const fullKeys = keys.map(buildFullKey);
      return await client!.del(fullKeys);
    },

    // ═══════════════════════════════════════════════════════════════
    // Scan Operations
    // ═══════════════════════════════════════════════════════════════

    async *scan(pattern: string, options?: { maxKeys?: number }): AsyncGenerator<string> {
      ensureInitialized();
      const fullPattern = buildFullKey(pattern);
      const maxKeys = options?.maxKeys || 10000;
      let yielded = 0;

      for await (const keysBatch of client!.scanIterator({ MATCH: fullPattern, COUNT: 100 })) {
        if (!Array.isArray(keysBatch)) continue;
        for (const key of keysBatch) {
          if (yielded >= maxKeys) return;
          // Return key without prefix for consistency
          yield key.substring(keyPrefix.length);
          yielded++;
        }
      }
    },

    async keys(pattern: string, options?: { maxKeys?: number }): Promise<string[]> {
      const result: string[] = [];
      for await (const key of this.scan(pattern, options)) {
        result.push(key);
      }
      return result;
    },

    async deletePattern(pattern: string): Promise<number> {
      const keysToDelete = await this.keys(pattern);
      if (keysToDelete.length === 0) return 0;
      return await this.mdel(keysToDelete);
    },

    // ═══════════════════════════════════════════════════════════════
    // Pub/Sub
    // ═══════════════════════════════════════════════════════════════

    async publish(channel: string, message: unknown): Promise<boolean> {
      ensureInitialized();
      const fullChannel = buildFullKey(channel);
      const serialized = typeof message === 'string' ? message : JSON.stringify(message);
      try {
        await client!.publish(fullChannel, serialized);
        return true;
      } catch (error) {
        logger.error(`Redis publish failed [${serviceName}]`, { channel, error });
        return false;
      }
    },

    async subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>> {
      ensureInitialized();
      const fullChannel = buildFullKey(channel);
      const subscriber = client!.duplicate();
      await subscriber.connect();
      await subscriber.subscribe(fullChannel, handler);

      return async () => {
        await subscriber.unsubscribe(fullChannel);
        await subscriber.quit();
      };
    },

    // ═══════════════════════════════════════════════════════════════
    // Health & Stats
    // ═══════════════════════════════════════════════════════════════

    async checkHealth(): Promise<RedisHealthResult> {
      if (!initialized || !client) {
        return { healthy: false, latencyMs: -1, strategy: currentConfig?.strategy || 'shared', brand, service: serviceName };
      }

      const start = Date.now();
      try {
        await client.ping();
        return {
          healthy: true,
          latencyMs: Date.now() - start,
          strategy: currentConfig?.strategy || 'shared',
          brand,
          service: serviceName,
        };
      } catch {
        return { healthy: false, latencyMs: -1, strategy: currentConfig?.strategy || 'shared', brand, service: serviceName };
      }
    },

    async getStats(): Promise<RedisStats> {
      ensureInitialized();
      
      try {
        // Get memory info
        const memoryInfo = await client!.info('memory');
        const usedMemoryMatch = memoryInfo.match(/used_memory_human:([^\r\n]+)/);
        
        // Get clients info
        const clientsInfo = await client!.info('clients');
        const connectedClientsMatch = clientsInfo.match(/connected_clients:(\d+)/);
        
        // Get server info (version, uptime)
        const serverInfo = await client!.info('server');
        const redisVersionMatch = serverInfo.match(/redis_version:([^\r\n]+)/);
        const uptimeMatch = serverInfo.match(/uptime_in_seconds:(\d+)/);
        
        // Get stats info (commands, ops/sec)
        const statsInfo = await client!.info('stats');
        const totalCommandsMatch = statsInfo.match(/total_commands_processed:(\d+)/);
        const opsPerSecMatch = statsInfo.match(/instantaneous_ops_per_sec:(\d+)/);

        // Count keys by prefix
        const keysByPrefix: Record<string, number> = {};
        let totalKeys = 0;
        
        for await (const keys of client!.scanIterator({ MATCH: `${keyPrefix}*`, COUNT: 1000 })) {
          if (Array.isArray(keys)) {
            totalKeys += keys.length;
            for (const key of keys) {
              const parts = key.substring(keyPrefix.length).split(':');
              const category = parts[0] || 'other';
              keysByPrefix[category] = (keysByPrefix[category] || 0) + 1;
            }
          }
        }

        return {
          connectedClients: connectedClientsMatch ? parseInt(connectedClientsMatch[1], 10) : 0,
          usedMemory: usedMemoryMatch ? usedMemoryMatch[1] : 'unknown',
          totalKeys,
          keysByPrefix,
          redisVersion: redisVersionMatch ? redisVersionMatch[1] : undefined,
          uptimeSeconds: uptimeMatch ? parseInt(uptimeMatch[1], 10) : undefined,
          totalCommandsProcessed: totalCommandsMatch ? parseInt(totalCommandsMatch[1], 10) : undefined,
          opsPerSecond: opsPerSecMatch ? parseInt(opsPerSecMatch[1], 10) : undefined,
        };
      } catch (error) {
        logger.error(`Failed to get Redis stats [${serviceName}]`, { error });
        return {
          connectedClients: 0,
          usedMemory: 'unknown',
          totalKeys: 0,
          keysByPrefix: {},
        };
      }
    },

    isInitialized(): boolean {
      return initialized;
    },
  };

  return accessor;
}

// ═══════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════

/**
 * Close all Redis connections
 */
export async function closeAllRedisConnections(): Promise<void> {
  if (sharedClient) {
    await sharedClient.quit();
    sharedClient = null;
  }

  for (const [brand, client] of brandClients) {
    await client.quit();
    logger.info(`Closed Redis connection for brand: ${brand}`);
  }
  brandClients.clear();

  currentConfig = null;
  logger.info('All Redis connections closed');
}

