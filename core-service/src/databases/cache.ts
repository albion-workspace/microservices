/**
 * Caching Layer - For 100K+ scale
 * 
 * Features:
 * - Redis-backed caching
 * - In-memory fallback (for single instance)
 * - TTL support
 * - Cache invalidation
 * - Stale-while-revalidate pattern
 */

import { getRedis } from './redis.js';
import { logger } from '../common/logger.js';

// ═══════════════════════════════════════════════════════════════════
// In-memory fallback cache (for when Redis is not available)
// ═══════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const MAX_MEMORY_CACHE_SIZE = 10000;

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt < now) {
      memoryCache.delete(key);
    }
  }
}, 60000); // Every minute

// ═══════════════════════════════════════════════════════════════════
// Main Cache Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Get or set cache with automatic TTL
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
  
  // Store in cache
  await setCache(key, freshValue, ttlSeconds);
  
  return freshValue;
}

/**
 * Get value from cache
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  
  if (redis) {
    try {
      const value = await redis.get(key);
      if (value) {
        return JSON.parse(value) as T;
      }
    } catch (error) {
      logger.warn('Redis get failed, using memory cache', { key, error });
    }
  }
  
  // Fallback to memory cache
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value as T;
  }
  
  return null;
}

/**
 * Set value in cache
 */
export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  
  if (redis) {
    try {
      await redis.setEx(key, ttlSeconds, JSON.stringify(value));
      return;
    } catch (error) {
      logger.warn('Redis set failed, using memory cache', { key, error });
    }
  }
  
  // Fallback to memory cache
  if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE) {
    // Evict oldest entries
    const keysToDelete = Array.from(memoryCache.keys()).slice(0, 1000);
    keysToDelete.forEach(k => memoryCache.delete(k));
  }
  
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + (ttlSeconds * 1000),
  });
}

/**
 * Delete from cache
 */
export async function deleteCache(key: string): Promise<void> {
  const redis = getRedis();
  
  if (redis) {
    try {
      await redis.del(key);
    } catch (error) {
      logger.warn('Redis delete failed', { key, error });
    }
  }
  
  memoryCache.delete(key);
}

/**
 * Delete by pattern (use carefully - expensive operation)
 */
export async function deleteCachePattern(pattern: string): Promise<number> {
  const redis = getRedis();
  let deleted = 0;
  
  if (redis) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        deleted = await redis.del(keys);
      }
    } catch (error) {
      logger.warn('Redis pattern delete failed', { pattern, error });
    }
  }
  
  // Also clear from memory cache
  for (const key of memoryCache.keys()) {
    if (matchPattern(key, pattern)) {
      memoryCache.delete(key);
      deleted++;
    }
  }
  
  return deleted;
}

/**
 * Clear all cache
 */
export async function clearCache(): Promise<void> {
  const redis = getRedis();
  
  if (redis) {
    try {
      await redis.flushDb();
    } catch (error) {
      logger.warn('Redis flush failed', { error });
    }
  }
  
  memoryCache.clear();
}

/**
 * Get cache stats
 */
export function getCacheStats(): { memorySize: number; memoryKeys: string[] } {
  return {
    memorySize: memoryCache.size,
    memoryKeys: Array.from(memoryCache.keys()).slice(0, 100), // First 100 keys
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
