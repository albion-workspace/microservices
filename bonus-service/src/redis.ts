/**
 * Bonus Service Redis Accessor
 * 
 * Provides Redis access with automatic key prefixing.
 * Keys are prefixed as: {brand}:bonus-service:{key}
 * 
 * Usage:
 * ```typescript
 * import { redis } from './redis.js';
 * 
 * // At startup (after configureRedisStrategy)
 * await redis.initialize({ brand });
 * 
 * // Usage
 * await redis.set('pending:123', data, 300);
 * const value = await redis.get('pending:123');
 * ```
 */

import { createServiceRedisAccess } from 'core-service';

export const redis = createServiceRedisAccess('bonus-service');
