/**
 * KYC Service Redis Accessor
 * 
 * Provides Redis access with automatic key prefixing.
 * Keys are prefixed as: {brand}:kyc-service:{key}
 * 
 * Usage:
 * ```typescript
 * import { redis } from './redis.js';
 * 
 * // At startup (after configureRedisStrategy)
 * await redis.initialize({ brand });
 * 
 * // Usage
 * await redis.set('session:123', data, 300);
 * const value = await redis.get('session:123');
 * ```
 */

import { createServiceRedisAccess } from 'core-service';

export const redis = createServiceRedisAccess('kyc-service');
