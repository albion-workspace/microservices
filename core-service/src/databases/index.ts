/**
 * Databases Module - Main Entry Point
 *
 * Re-exports all database-related functionality from submodules.
 *
 * Structure:
 * - mongodb/  - MongoDB connection, utils, repository, strategy
 * - redis/    - Redis connection, service accessor
 * - accessors - createServiceAccessors() for db + redis in one call
 * - cache.ts  - Hybrid caching layer (memory + Redis)
 */

// MongoDB
export * from './mongodb/index.js';

// Redis
export * from './redis/index.js';

// Service accessors (db + redis in one call)
export { createServiceAccessors } from './accessors.js';
export type { CreateServiceAccessorsOptions, ServiceAccessors } from './accessors.js';

// Cache (uses both memory and Redis)
export {
  // Core functions
  cached,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  clearCache,
  clearMemoryCache,
  // Batch operations
  getCacheMany,
  setCacheMany,
  deleteCacheMany,
  // Configuration
  configureCacheSettings,
  // Stats & monitoring
  getCacheStats,
  resetCacheStats,
  // Cache warming
  warmCache,
  // Key helpers
  createCacheKeys,
  CacheKeys,
  // Types
  type CacheConfig,
  type CacheStatistics,
} from './cache.js';
