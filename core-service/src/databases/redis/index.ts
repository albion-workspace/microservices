/**
 * Redis Module - Re-exports all Redis-related functionality
 */

// Connection
export {
  connectRedis,
  getRedis,
  getRedisForRead,
  hasReadReplica,
  closeRedis,
  checkRedisHealth,
  publish,
  subscribe,
  scanKeysArray,
  scanKeysIterator,
  scanKeysWithCallback,
  batchGetValues,
  getRedisConnectionStats,
  type RedisConfig,
  type RedisSentinelConfig,
  type RedisReplicaConfig,
  type ScanOptions,
  type RedisConnectionStats,
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
