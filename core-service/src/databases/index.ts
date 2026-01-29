/**
 * Databases Module - Main Entry Point
 * 
 * Re-exports all database-related functionality from submodules.
 * 
 * Structure:
 * - mongodb/  - MongoDB connection, utils, repository, strategy
 * - redis/    - Redis connection, service accessor
 * - cache.ts  - Hybrid caching layer (memory + Redis)
 */

// MongoDB
export * from './mongodb/index.js';

// Redis
export * from './redis/index.js';

// Cache (uses both memory and Redis)
export {
  cached,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  clearCache,
  getCacheStats,
  clearMemoryCache,
  createCacheKeys,
  CacheKeys,
} from './cache.js';
