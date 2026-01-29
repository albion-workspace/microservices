/**
 * Service Redis Accessor
 * 
 * Provides Redis access with:
 * - Automatic key prefixing (brand:service:category:key)
 * - Optional per-brand Redis instances
 * - Health check and stats
 * - Consistent API across services
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../../common/logger.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface RedisStrategyConfig {
  strategy: 'shared' | 'per-brand';
  defaultUrl: string;
  brandUrls?: Record<string, string>;
  keyPrefix?: string;
}

export interface ServiceRedisOptions {
  brand?: string;
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
  redisVersion?: string;
  uptimeSeconds?: number;
  totalCommandsProcessed?: number;
  opsPerSecond?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Module State
// ═══════════════════════════════════════════════════════════════════

let sharedClient: RedisClientType | null = null;
const brandClients = new Map<string, RedisClientType>();
let currentConfig: RedisStrategyConfig | null = null;

// ═══════════════════════════════════════════════════════════════════
// Connection Management
// ═══════════════════════════════════════════════════════════════════

async function connectToRedis(url: string, label: string): Promise<RedisClientType> {
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
        if (retries > 10) return new Error('Max reconnect attempts');
        return 1000;
      },
    },
  };

  if (password) clientOptions.password = password;

  const client = createClient(clientOptions);
  client.on('error', (err) => logger.error(`Redis [${label}] error`, { error: err.message }));
  await client.connect();
  logger.info(`Connected to Redis [${label}]`);
  return client as RedisClientType;
}

export async function configureRedisStrategy(config: RedisStrategyConfig): Promise<void> {
  currentConfig = config;
  if (config.strategy === 'shared' && !sharedClient) {
    sharedClient = await connectToRedis(config.defaultUrl, 'shared');
  }
}

async function getClientForBrand(brand?: string): Promise<RedisClientType> {
  if (!currentConfig) throw new Error('Redis strategy not configured');
  if (currentConfig.strategy === 'shared' || !brand) {
    if (!sharedClient) sharedClient = await connectToRedis(currentConfig.defaultUrl, 'shared');
    return sharedClient;
  }
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
  initialize(options?: ServiceRedisOptions): Promise<void>;
  getClient(): RedisClientType;
  getServiceName(): string;
  getKeyPrefix(): string;
  buildKey(key: string): string;
  buildKey(category: string, key: string): string;
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  mget<T = string>(keys: string[]): Promise<(T | null)[]>;
  mset(entries: Array<{ key: string; value: unknown; ttl?: number }>): Promise<void>;
  mdel(keys: string[]): Promise<number>;
  scan(pattern: string, options?: { maxKeys?: number }): AsyncGenerator<string>;
  keys(pattern: string, options?: { maxKeys?: number }): Promise<string[]>;
  deletePattern(pattern: string): Promise<number>;
  publish(channel: string, message: unknown): Promise<boolean>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
  checkHealth(): Promise<RedisHealthResult>;
  getStats(): Promise<RedisStats>;
  isInitialized(): boolean;
}

export function createServiceRedisAccess(serviceName: string): ServiceRedisAccessor {
  let initialized = false;
  let brand: string | undefined;
  let keyPrefix: string;
  let client: RedisClientType | null = null;

  const updateKeyPrefix = () => {
    keyPrefix = brand ? `${brand}:${serviceName}:` : `${serviceName}:`;
  };
  updateKeyPrefix();

  const ensureInitialized = () => {
    if (!initialized || !client) throw new Error(`Redis [${serviceName}] not initialized`);
  };

  const buildFullKey = (key: string): string => `${keyPrefix}${key}`;

  return {
    async initialize(options?: ServiceRedisOptions): Promise<void> {
      if (initialized) return;
      brand = options?.brand;
      keyPrefix = options?.keyPrefix || (brand ? `${brand}:${serviceName}:` : `${serviceName}:`);
      client = await getClientForBrand(brand);
      initialized = true;
    },

    getClient(): RedisClientType {
      ensureInitialized();
      return client!;
    },

    getServiceName: () => serviceName,
    getKeyPrefix: () => keyPrefix,

    buildKey(categoryOrKey: string, key?: string): string {
      return key !== undefined ? buildFullKey(`${categoryOrKey}:${key}`) : buildFullKey(categoryOrKey);
    },

    async get<T = string>(key: string): Promise<T | null> {
      ensureInitialized();
      const value = await client!.get(buildFullKey(key));
      if (value === null) return null;
      try { return JSON.parse(value) as T; } catch { return value as unknown as T; }
    },

    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      ensureInitialized();
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlSeconds) await client!.setEx(buildFullKey(key), ttlSeconds, serialized);
      else await client!.set(buildFullKey(key), serialized);
    },

    async del(key: string): Promise<boolean> {
      ensureInitialized();
      return (await client!.del(buildFullKey(key))) > 0;
    },

    async exists(key: string): Promise<boolean> {
      ensureInitialized();
      return (await client!.exists(buildFullKey(key))) > 0;
    },

    async expire(key: string, ttlSeconds: number): Promise<boolean> {
      ensureInitialized();
      return Boolean(await client!.expire(buildFullKey(key), ttlSeconds));
    },

    async ttl(key: string): Promise<number> {
      ensureInitialized();
      return await client!.ttl(buildFullKey(key));
    },

    async mget<T = string>(keys: string[]): Promise<(T | null)[]> {
      ensureInitialized();
      const values = await client!.mGet(keys.map(buildFullKey));
      return values.map(v => {
        if (v === null) return null;
        try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
      });
    },

    async mset(entries: Array<{ key: string; value: unknown; ttl?: number }>): Promise<void> {
      ensureInitialized();
      const pipeline = client!.multi();
      for (const entry of entries) {
        const serialized = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
        if (entry.ttl) pipeline.setEx(buildFullKey(entry.key), entry.ttl, serialized);
        else pipeline.set(buildFullKey(entry.key), serialized);
      }
      await pipeline.exec();
    },

    async mdel(keys: string[]): Promise<number> {
      ensureInitialized();
      if (keys.length === 0) return 0;
      return await client!.del(keys.map(buildFullKey));
    },

    async *scan(pattern: string, options?: { maxKeys?: number }): AsyncGenerator<string> {
      ensureInitialized();
      let yielded = 0;
      const maxKeys = options?.maxKeys || 10000;
      for await (const batch of client!.scanIterator({ MATCH: buildFullKey(pattern), COUNT: 100 })) {
        if (!Array.isArray(batch)) continue;
        for (const key of batch) {
          if (yielded >= maxKeys) return;
          yield key.substring(keyPrefix.length);
          yielded++;
        }
      }
    },

    async keys(pattern: string, options?: { maxKeys?: number }): Promise<string[]> {
      const result: string[] = [];
      for await (const key of this.scan(pattern, options)) result.push(key);
      return result;
    },

    async deletePattern(pattern: string): Promise<number> {
      const keys = await this.keys(pattern);
      if (keys.length === 0) return 0;
      return await this.mdel(keys);
    },

    async publish(channel: string, message: unknown): Promise<boolean> {
      ensureInitialized();
      try {
        await client!.publish(buildFullKey(channel), typeof message === 'string' ? message : JSON.stringify(message));
        return true;
      } catch { return false; }
    },

    async subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>> {
      ensureInitialized();
      const subscriber = client!.duplicate();
      await subscriber.connect();
      await subscriber.subscribe(buildFullKey(channel), handler);
      return async () => { await subscriber.unsubscribe(buildFullKey(channel)); await subscriber.quit(); };
    },

    async checkHealth(): Promise<RedisHealthResult> {
      if (!initialized || !client) return { healthy: false, latencyMs: -1, strategy: 'shared', brand, service: serviceName };
      const start = Date.now();
      try {
        await client.ping();
        return { healthy: true, latencyMs: Date.now() - start, strategy: currentConfig?.strategy || 'shared', brand, service: serviceName };
      } catch { return { healthy: false, latencyMs: -1, strategy: 'shared', brand, service: serviceName }; }
    },

    async getStats(): Promise<RedisStats> {
      ensureInitialized();
      try {
        const memInfo = await client!.info('memory');
        const usedMemoryMatch = memInfo.match(/used_memory_human:([^\r\n]+)/);
        const clientsInfo = await client!.info('clients');
        const connectedMatch = clientsInfo.match(/connected_clients:(\d+)/);
        const serverInfo = await client!.info('server');
        const versionMatch = serverInfo.match(/redis_version:([^\r\n]+)/);
        const uptimeMatch = serverInfo.match(/uptime_in_seconds:(\d+)/);
        const statsInfo = await client!.info('stats');
        const commandsMatch = statsInfo.match(/total_commands_processed:(\d+)/);
        const opsMatch = statsInfo.match(/instantaneous_ops_per_sec:(\d+)/);

        let totalKeys = 0;
        const keysByPrefix: Record<string, number> = {};
        for await (const batch of client!.scanIterator({ MATCH: `${keyPrefix}*`, COUNT: 1000 })) {
          if (Array.isArray(batch)) {
            totalKeys += batch.length;
            for (const key of batch) {
              const cat = key.substring(keyPrefix.length).split(':')[0] || 'other';
              keysByPrefix[cat] = (keysByPrefix[cat] || 0) + 1;
            }
          }
        }

        return {
          connectedClients: connectedMatch ? parseInt(connectedMatch[1], 10) : 0,
          usedMemory: usedMemoryMatch ? usedMemoryMatch[1] : 'unknown',
          totalKeys,
          keysByPrefix,
          redisVersion: versionMatch?.[1],
          uptimeSeconds: uptimeMatch ? parseInt(uptimeMatch[1], 10) : undefined,
          totalCommandsProcessed: commandsMatch ? parseInt(commandsMatch[1], 10) : undefined,
          opsPerSecond: opsMatch ? parseInt(opsMatch[1], 10) : undefined,
        };
      } catch { return { connectedClients: 0, usedMemory: 'unknown', totalKeys: 0, keysByPrefix: {} }; }
    },

    isInitialized: () => initialized,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════

export async function closeAllRedisConnections(): Promise<void> {
  if (sharedClient) { await sharedClient.quit(); sharedClient = null; }
  for (const [, client] of brandClients) await client.quit();
  brandClients.clear();
  currentConfig = null;
}
