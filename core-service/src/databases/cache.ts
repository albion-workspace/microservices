/**
 * Caching Layer - Multi-Level Cache for 100K+ scale
 * 
 * Features:
 * - Multi-level caching: L1 Memory → L2 Redis → Database
 * - Memory checked FIRST (fastest), then Redis
 * - Write-through: writes to both Memory and Redis
 * - Batch operations (getCacheMany/setCacheMany)
 * - TTL support with configurable defaults
 * - Cache invalidation with pattern support
 * - Stats and monitoring
 * 
 * Performance:
 * - Memory hit: ~0.001ms
 * - Redis hit: ~0.5-2ms
 * - Database: ~5-50ms
 */

import { getRedis } from './redis/connection.js';
import { logger } from '../common/logger.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

export interface CacheConfig {
  /** Max entries in memory cache (default: 10000) */
  maxMemorySize?: number;
  /** Enable memory cache (default: true) */
  memoryEnabled?: boolean;
  /** Enable Redis cache (default: true) */
  redisEnabled?: boolean;
  /** Default TTL in seconds (default: 300) */
  defaultTtl?: number;
  /** Memory cleanup interval in ms (default: 60000) */
  cleanupInterval?: number;
}

const DEFAULT_CONFIG: Required<CacheConfig> = {
  maxMemorySize: 10000,
  memoryEnabled: true,
  redisEnabled: true,
  defaultTtl: 300,
  cleanupInterval: 60000,
};

let config = { ...DEFAULT_CONFIG };

/**
 * Configure cache settings (call before using cache)
 */
export function configureCacheSettings(newConfig: Partial<CacheConfig>): void {
  config = { ...config, ...newConfig };
}

// ═══════════════════════════════════════════════════════════════════
// L1 Memory Cache (fastest layer)
// ═══════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

// Stats tracking
let cacheStats = {
  memoryHits: 0,
  memoryMisses: 0,
  redisHits: 0,
  redisMisses: 0,
  writes: 0,
  deletes: 0,
};

// Cleanup expired entries periodically
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of memoryCache) {
      if (entry.expiresAt < now) {
        memoryCache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug('Cache cleanup completed', { cleaned, remaining: memoryCache.size });
    }
  }, config.cleanupInterval);
}

// Start cleanup on module load
startCleanupTimer();

// ═══════════════════════════════════════════════════════════════════
// Main Cache Functions (Multi-Level: Memory → Redis)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get or set cache with automatic TTL (cache-aside pattern)
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // Try to get from cache first
  const cachedValue = await getCache<T>(key);
  if (cachedValue !== null) {
    return cachedValue;
  }

  // Fetch fresh data
  const freshValue = await fetchFn();
  
  // Store in cache (write-through to both layers)
  await setCache(key, freshValue, ttlSeconds);
  
  return freshValue;
}

/**
 * Get value from cache
 * Order: L1 Memory (fastest) → L2 Redis → null
 * Promotes Redis hits to Memory for faster subsequent access
 */
export async function getCache<T>(key: string): Promise<T | null> {
  // L1: Check memory cache FIRST (fastest ~0.001ms)
  if (config.memoryEnabled) {
    const entry = memoryCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      cacheStats.memoryHits++;
      return entry.value as T;
    }
    cacheStats.memoryMisses++;
  }
  
  // L2: Check Redis cache (~0.5-2ms)
  if (config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        const value = await redis.get(key);
        if (value) {
          cacheStats.redisHits++;
          const parsed = JSON.parse(value) as T;
          
          // Promote to L1 memory cache for faster subsequent access
          if (config.memoryEnabled) {
            const ttl = await redis.ttl(key);
            if (ttl > 0) {
              setMemoryCache(key, parsed, ttl);
            }
          }
          
          return parsed;
        }
        cacheStats.redisMisses++;
      } catch (error) {
        logger.warn('Redis get failed', { key, error });
      }
    }
  }
  
  return null;
}

/**
 * Set value in cache (write-through to both Memory and Redis)
 */
export async function setCache<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const ttl = ttlSeconds ?? config.defaultTtl;
  cacheStats.writes++;
  
  // L1: Write to memory cache
  if (config.memoryEnabled) {
    setMemoryCache(key, value, ttl);
  }
  
  // L2: Write to Redis cache
  if (config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.setEx(key, ttl, JSON.stringify(value));
      } catch (error) {
        logger.warn('Redis set failed', { key, error });
      }
    }
  }
}

/**
 * Set value in memory cache only (internal helper)
 */
function setMemoryCache<T>(key: string, value: T, ttlSeconds: number): void {
  // Evict oldest entries if full (simple LRU approximation)
  if (memoryCache.size >= config.maxMemorySize) {
    const keysToDelete = Array.from(memoryCache.keys()).slice(0, Math.floor(config.maxMemorySize * 0.1));
    keysToDelete.forEach(k => memoryCache.delete(k));
    logger.debug('Memory cache eviction', { evicted: keysToDelete.length, maxSize: config.maxMemorySize });
  }
  
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + (ttlSeconds * 1000),
  });
}

// ═══════════════════════════════════════════════════════════════════
// Batch Cache Operations (optimized for multiple keys)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get multiple values from cache in a single operation
 * Returns Map with key -> value (null if not found)
 */
export async function getCacheMany<T>(keys: string[]): Promise<Map<string, T | null>> {
  const result = new Map<string, T | null>();
  if (keys.length === 0) return result;
  
  const missingFromMemory: string[] = [];
  
  // L1: Check memory cache first
  if (config.memoryEnabled) {
    const now = Date.now();
    for (const key of keys) {
      const entry = memoryCache.get(key);
      if (entry && entry.expiresAt > now) {
        result.set(key, entry.value as T);
        cacheStats.memoryHits++;
      } else {
        missingFromMemory.push(key);
        cacheStats.memoryMisses++;
      }
    }
  } else {
    missingFromMemory.push(...keys);
  }
  
  // L2: Check Redis for keys not in memory (batch MGET)
  if (missingFromMemory.length > 0 && config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        const values = await redis.mGet(missingFromMemory);
        for (let i = 0; i < missingFromMemory.length; i++) {
          const key = missingFromMemory[i];
          const value = values[i];
          if (value) {
            cacheStats.redisHits++;
            const parsed = JSON.parse(value) as T;
            result.set(key, parsed);
            
            // Promote to memory cache
            if (config.memoryEnabled) {
              const ttl = await redis.ttl(key);
              if (ttl > 0) {
                setMemoryCache(key, parsed, ttl);
              }
            }
          } else {
            result.set(key, null);
            cacheStats.redisMisses++;
          }
        }
      } catch (error) {
        logger.warn('Redis mGet failed', { count: missingFromMemory.length, error });
        // Set null for all missing keys
        for (const key of missingFromMemory) {
          if (!result.has(key)) result.set(key, null);
        }
      }
    }
  }
  
  // Set null for any remaining keys
  for (const key of keys) {
    if (!result.has(key)) result.set(key, null);
  }
  
  return result;
}

/**
 * Set multiple values in cache in a single operation
 * Uses Redis pipeline for efficiency
 */
export async function setCacheMany<T>(
  entries: Array<{ key: string; value: T; ttl?: number }>
): Promise<void> {
  if (entries.length === 0) return;
  
  cacheStats.writes += entries.length;
  
  // L1: Write to memory cache
  if (config.memoryEnabled) {
    for (const { key, value, ttl } of entries) {
      setMemoryCache(key, value, ttl ?? config.defaultTtl);
    }
  }
  
  // L2: Write to Redis using pipeline (batch operation)
  if (config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        const pipeline = redis.multi();
        for (const { key, value, ttl } of entries) {
          pipeline.setEx(key, ttl ?? config.defaultTtl, JSON.stringify(value));
        }
        await pipeline.exec();
      } catch (error) {
        logger.warn('Redis pipeline set failed', { count: entries.length, error });
      }
    }
  }
}

/**
 * Delete from cache (both Memory and Redis)
 */
export async function deleteCache(key: string): Promise<void> {
  cacheStats.deletes++;
  
  // L1: Delete from memory
  memoryCache.delete(key);
  
  // L2: Delete from Redis
  if (config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.del(key);
      } catch (error) {
        logger.warn('Redis delete failed', { key, error });
      }
    }
  }
}

/**
 * Delete multiple keys from cache
 */
export async function deleteCacheMany(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  
  cacheStats.deletes += keys.length;
  
  // L1: Delete from memory
  for (const key of keys) {
    memoryCache.delete(key);
  }
  
  // L2: Delete from Redis (batch operation)
  if (config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        return await redis.del(keys);
      } catch (error) {
        logger.warn('Redis batch delete failed', { count: keys.length, error });
      }
    }
  }
  
  return keys.length;
}

/**
 * Delete by pattern using SCAN (more efficient than KEYS for large datasets)
 * Note: Use sparingly - still expensive for very large datasets
 */
export async function deleteCachePattern(pattern: string): Promise<number> {
  let deleted = 0;
  
  // L2: Delete from Redis using SCAN (O(1) per iteration, safer than KEYS)
  if (config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        // Use SCAN iterator instead of KEYS (non-blocking)
        const keysToDelete: string[] = [];
        for await (const keyOrBatch of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
          // scanIterator may return single string or array depending on redis version
          const keys = Array.isArray(keyOrBatch) ? keyOrBatch : [keyOrBatch];
          keysToDelete.push(...keys);
          // Delete in batches of 100 to avoid memory issues
          if (keysToDelete.length >= 100) {
            await redis.del(keysToDelete);
            deleted += keysToDelete.length;
            keysToDelete.length = 0;
          }
        }
        // Delete remaining keys
        if (keysToDelete.length > 0) {
          await redis.del(keysToDelete);
          deleted += keysToDelete.length;
        }
      } catch (error) {
        logger.warn('Redis pattern delete failed', { pattern, error });
      }
    }
  }
  
  // L1: Clear matching keys from memory cache
  for (const key of memoryCache.keys()) {
    if (matchPattern(key, pattern)) {
      memoryCache.delete(key);
      deleted++;
    }
  }
  
  cacheStats.deletes += deleted;
  return deleted;
}

/**
 * Clear all cache (both Memory and Redis)
 */
export async function clearCache(): Promise<void> {
  // L1: Clear memory
  memoryCache.clear();
  
  // L2: Clear Redis
  if (config.redisEnabled) {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.flushDb();
      } catch (error) {
        logger.warn('Redis flush failed', { error });
      }
    }
  }
  
  // Reset stats
  cacheStats = {
    memoryHits: 0,
    memoryMisses: 0,
    redisHits: 0,
    redisMisses: 0,
    writes: 0,
    deletes: 0,
  };
}

/**
 * Clear only memory cache (does not affect Redis)
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

// ═══════════════════════════════════════════════════════════════════
// Cache Stats & Monitoring
// ═══════════════════════════════════════════════════════════════════

export interface CacheStatistics {
  memory: {
    size: number;
    maxSize: number;
    utilizationPercent: number;
    validEntries: number;
    expiredEntries: number;
  };
  hits: {
    memory: number;
    redis: number;
    total: number;
  };
  misses: {
    memory: number;
    redis: number;
    total: number;
  };
  hitRate: {
    memory: number;
    redis: number;
    overall: number;
  };
  operations: {
    writes: number;
    deletes: number;
  };
}

/**
 * Get comprehensive cache statistics
 */
export function getCacheStats(): CacheStatistics {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;
  
  for (const entry of memoryCache.values()) {
    if (entry.expiresAt > now) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }
  
  const totalMemoryLookups = cacheStats.memoryHits + cacheStats.memoryMisses;
  const totalRedisLookups = cacheStats.redisHits + cacheStats.redisMisses;
  const totalHits = cacheStats.memoryHits + cacheStats.redisHits;
  const totalMisses = cacheStats.redisMisses; // Only count final misses
  
  return {
    memory: {
      size: memoryCache.size,
      maxSize: config.maxMemorySize,
      utilizationPercent: Math.round((memoryCache.size / config.maxMemorySize) * 100),
      validEntries,
      expiredEntries,
    },
    hits: {
      memory: cacheStats.memoryHits,
      redis: cacheStats.redisHits,
      total: totalHits,
    },
    misses: {
      memory: cacheStats.memoryMisses,
      redis: cacheStats.redisMisses,
      total: totalMisses,
    },
    hitRate: {
      memory: totalMemoryLookups > 0 ? Math.round((cacheStats.memoryHits / totalMemoryLookups) * 100) : 0,
      redis: totalRedisLookups > 0 ? Math.round((cacheStats.redisHits / totalRedisLookups) * 100) : 0,
      overall: (totalHits + totalMisses) > 0 ? Math.round((totalHits / (totalHits + totalMisses)) * 100) : 0,
    },
    operations: {
      writes: cacheStats.writes,
      deletes: cacheStats.deletes,
    },
  };
}

/**
 * Reset cache statistics (useful for monitoring windows)
 */
export function resetCacheStats(): void {
  cacheStats = {
    memoryHits: 0,
    memoryMisses: 0,
    redisHits: 0,
    redisMisses: 0,
    writes: 0,
    deletes: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function matchPattern(key: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(key);
}

// ═══════════════════════════════════════════════════════════════════
// Cache Warming
// ═══════════════════════════════════════════════════════════════════

/**
 * Warm cache with multiple entries (useful for preloading frequently accessed data)
 * 
 * @example
 * // Warm cache with user profiles on startup
 * await warmCache([
 *   { key: 'user:123', fetchFn: () => getUserProfile('123'), ttl: 600 },
 *   { key: 'user:456', fetchFn: () => getUserProfile('456'), ttl: 600 },
 * ]);
 */
export async function warmCache<T>(
  entries: Array<{ key: string; fetchFn: () => Promise<T>; ttl?: number }>
): Promise<{ warmed: number; failed: number }> {
  let warmed = 0;
  let failed = 0;
  
  // Process in parallel batches of 10
  const batchSize = 10;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async ({ key, fetchFn, ttl }) => {
        const value = await fetchFn();
        await setCache(key, value, ttl);
        return key;
      })
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        warmed++;
      } else {
        failed++;
        logger.warn('Cache warming failed', { error: result.reason });
      }
    }
  }
  
  logger.info('Cache warming completed', { warmed, failed, total: entries.length });
  return { warmed, failed };
}

// ═══════════════════════════════════════════════════════════════════
// Cache Keys Factory - Generic helper for creating cache keys
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a cache key factory for an entity type
 * 
 * @example
 * const ProductCache = createCacheKeys('product');
 * ProductCache.one('123')     // 'product:123'
 * ProductCache.list('active') // 'products:active'
 * ProductCache.pattern()      // 'product*'
 */
export function createCacheKeys(entity: string) {
  return {
    /** Single entity key: `entity:id` */
    one: (id: string) => `${entity}:${id}`,
    
    /** List key with filter: `entities:filter` */
    list: (filter: string = 'all') => `${entity}s:${filter}`,
    
    /** Pattern for invalidating all keys of this entity */
    pattern: () => `${entity}*`,
    
    /** Pattern for invalidating all list keys */
    listPattern: () => `${entity}s:*`,
  };
}

/**
 * Pre-built cache keys helper (for common patterns)
 * Apps should create their own using createCacheKeys()
 */
export const CacheKeys = {
  /** Create key for single entity */
  entity: (type: string, id: string) => `${type}:${id}`,
  
  /** Create key for entity list */
  list: (type: string, filter: string = 'all') => `${type}s:${filter}`,
  
  /** Create invalidation pattern */
  pattern: (type: string) => `${type}*`,
};
