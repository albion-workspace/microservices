/**
 * Redis Module - Re-exports all Redis-related functionality
 */

// Connection
export {
  connectRedis,
  getRedis,
  closeRedis,
  checkRedisHealth,
  publish,
  subscribe,
  scanKeysArray,
  scanKeysIterator,
  scanKeysWithCallback,
  batchGetValues,
  type RedisConfig,
  type ScanOptions,
} from './connection.js';

// Service Accessor
export {
  createServiceRedisAccess,
  configureRedisStrategy,
  closeAllRedisConnections,
  type ServiceRedisAccessor,
  type RedisStrategyConfig,
  type ServiceRedisOptions,
  type RedisHealthResult,
  type RedisStats,
} from './service-accessor.js';
