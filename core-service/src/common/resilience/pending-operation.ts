/**
 * Pending Operation Store - Generic temporary data storage
 * 
 * Use cases:
 * - User registration (store registration data until email/phone verification)
 * - Campaign creation (store sensitive campaign data until all steps complete)
 * - Multi-step forms (store form data between steps)
 * - Any scenario where data should be stored temporarily before committing to DB
 * 
 * Supports two backends:
 * 1. JWT (stateless) - Data stored in token, expires automatically
 * 2. Redis (stateful) - Data stored in Redis with TTL, can be shared across instances
 * 
 * Benefits:
 * - No DB records for incomplete operations
 * - Automatic expiration (no cleanup needed)
 * - Can re-start operation if token/entry expires
 * - Reduces spam/incomplete data in DB
 */

import crypto from 'crypto';
import { getRedis, scanKeysIterator } from '../../databases/redis/connection.js';
import { logger } from '../logger.js';
import { signGenericJWT, verifyGenericJWT } from '../auth/jwt.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type PendingOperationBackend = 'jwt' | 'redis' | 'auto';

export interface PendingOperationConfig {
  /** Backend to use: 'jwt' (stateless), 'redis' (stateful), or 'auto' (prefer Redis, fallback to JWT) */
  backend?: PendingOperationBackend;
  /** JWT secret (required for JWT backend) */
  jwtSecret?: string;
  /** Redis key prefix (default: 'pending:') */
  redisKeyPrefix?: string;
  /** Default expiration time (default: '24h' for JWT, 86400 seconds for Redis) */
  defaultExpiration?: string | number;
}

export interface PendingOperationOptions {
  /** Operation type/name (e.g., 'registration', 'campaign', 'form') */
  operationType: string;
  /** Expiration time (overrides default) */
  expiresIn?: string | number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Pending Operation Store
// ═══════════════════════════════════════════════════════════════════

/**
 * Generic store for pending operations (temporary data before DB commit)
 * 
 * @example
 * ```typescript
 * // Registration example
 * const store = createPendingOperationStore({ jwtSecret: 'secret' });
 * 
 * // Store registration data
 * const token = await store.create('registration', {
 *   email: 'user@example.com',
 *   passwordHash: '...',
 *   metadata: { ... }
 * }, { operationType: 'registration', expiresIn: '24h' });
 * 
 * // Retrieve and verify
 * const data = await store.verify(token, 'registration');
 * if (data) {
 *   // Create user in DB
 *   await createUser(data);
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Campaign example
 * const store = createPendingOperationStore({ backend: 'redis' });
 * 
 * // Store campaign data
 * const token = await store.create('campaign', {
 *   name: 'Summer Sale',
 *   budget: 10000,
 *   steps: ['setup', 'targeting', 'creative'],
 *   currentStep: 'targeting',
 * }, { operationType: 'campaign', expiresIn: 3600 });
 * 
 * // Update campaign data
 * await store.update(token, 'campaign', { currentStep: 'creative' });
 * 
 * // Complete campaign
 * const data = await store.verify(token, 'campaign');
 * await createCampaign(data);
 * ```
 */
export function createPendingOperationStore(config: PendingOperationConfig = {}) {
  const {
    backend = 'auto',
    jwtSecret: configJwtSecret,
    redisKeyPrefix = 'pending:',
    defaultExpiration = '24h',
  } = config;

  // Ensure jwtSecret is always a string (required for JWT backend)
  // TypeScript needs explicit type narrowing here
  const jwtSecret: string = (configJwtSecret || process.env.JWT_SECRET || 'shared-jwt-secret-change-in-production') as string;
  
  // Validate jwtSecret is not empty (runtime check)
  if (!jwtSecret || typeof jwtSecret !== 'string') {
    throw new Error('JWT secret is required for JWT backend');
  }

  // Determine actual backend
  const actualBackend: 'jwt' | 'redis' = (() => {
    if (backend === 'jwt') return 'jwt';
    if (backend === 'redis') {
      const redis = getRedis();
      if (!redis) {
        logger.warn('Redis requested but not available, falling back to JWT');
        return 'jwt';
      }
      return 'redis';
    }
    // 'auto' - prefer Redis, fallback to JWT
    const redis = getRedis();
    return redis ? 'redis' : 'jwt';
  })();

  // Parse expiration
  const parseExpiration = (exp: string | number): { jwt: string; redis: number } => {
    if (typeof exp === 'number') {
      return { jwt: `${exp}s`, redis: exp };
    }
    
    // Parse JWT format (e.g., '24h', '1d', '3600s')
    const match = exp.match(/^(\d+)([smhd])$/);
    if (match) {
      const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
      const seconds = parseInt(match[1]) * (mult[match[2]] || 3600);
      return { jwt: exp, redis: seconds };
    }
    
    // Default
    return { jwt: '24h', redis: 86400 };
  };

  /**
   * Create a pending operation
   * Returns a token that can be used to retrieve/verify the data later
   */
  async function create<T extends Record<string, unknown>>(
    operationType: string,
    data: T,
    options: PendingOperationOptions = { operationType }
  ): Promise<string> {
    const expiration = parseExpiration(options.expiresIn || defaultExpiration);
    const now = Date.now();

    const payload = {
      type: 'pending_operation',
      operationType: options.operationType || operationType,
      data,
      metadata: options.metadata || {},
      createdAt: now,
    };

    if (actualBackend === 'jwt') {
      // JWT backend - stateless, data in token
      // jwtSecret is guaranteed to be a string (validated above)
      return signGenericJWT(payload, jwtSecret, expiration.jwt);
    } else {
      // Redis backend - stateful, data in Redis
      const redis = getRedis();
      if (!redis) {
        throw new Error('Redis not available');
      }

      const token = generateToken();
      const key = `${redisKeyPrefix}${operationType}:${token}`;

      await redis.setEx(
        key,
        expiration.redis,
        JSON.stringify(payload)
      );

      logger.debug('Pending operation created (Redis)', {
        operationType,
        key,
        expiresIn: expiration.redis,
      });

      return token;
    }
  }

  /**
   * Verify and retrieve pending operation data
   * Returns null if token is invalid/expired
   */
  async function verify<T extends Record<string, unknown>>(
    token: string,
    expectedOperationType?: string
  ): Promise<{
    operationType: string;
    data: T;
    metadata: Record<string, unknown>;
    createdAt: number;
  } | null> {
    if (actualBackend === 'jwt') {
      // JWT backend - verify token
      // jwtSecret is guaranteed to be a string (validated above)
      const payload = verifyGenericJWT<any>(token, jwtSecret);
      
      if (!payload) {
        return null;
      }

      if (payload.type !== 'pending_operation') {
        return null;
      }

      if (expectedOperationType && payload.operationType !== expectedOperationType) {
        logger.warn('Operation type mismatch', {
          expected: expectedOperationType,
          actual: payload.operationType,
        });
        return null;
      }

      return {
        operationType: payload.operationType,
        data: payload.data as T,
        metadata: payload.metadata || {},
        createdAt: payload.createdAt || Date.now(),
      };
    } else {
      // Redis backend - retrieve from Redis
      const redis = getRedis();
      if (!redis) {
        logger.warn('Redis not available for pending operation verification');
        return null;
      }

      // Try to find token in Redis (scan all operation types if operationType not specified)
      if (expectedOperationType) {
        const key = `${redisKeyPrefix}${expectedOperationType}:${token}`;
        const value = await redis.get(key);
        
        if (!value) {
          return null;
        }

        const payload = JSON.parse(value);
        
        // Delete after retrieval (one-time use)
        await redis.del(key);

        return {
          operationType: payload.operationType,
          data: payload.data as T,
          metadata: payload.metadata || {},
          createdAt: payload.createdAt || Date.now(),
        };
      } else {
        // Scan for token across all operation types
        const pattern = `${redisKeyPrefix}*:${token}`;
        const keys = await redis.keys(pattern);
        
        if (keys.length === 0) {
          return null;
        }

        const value = await redis.get(keys[0]);
        if (!value) {
          return null;
        }

        const payload = JSON.parse(value);
        
        // Delete after retrieval
        await redis.del(keys[0]);

        return {
          operationType: payload.operationType,
          data: payload.data as T,
          metadata: payload.metadata || {},
          createdAt: payload.createdAt || Date.now(),
        };
      }
    }
  }

  /**
   * Update pending operation data (Redis only - JWT is immutable)
   */
  async function update<T extends Record<string, unknown>>(
    token: string,
    operationType: string,
    updates: Partial<T> | ((current: T) => T)
  ): Promise<boolean> {
    if (actualBackend === 'jwt') {
      logger.warn('Cannot update JWT-based pending operation (JWT is immutable)');
      return false;
    }

    const redis = getRedis();
    if (!redis) {
      logger.warn('Redis not available for pending operation update');
      return false;
    }

    const key = `${redisKeyPrefix}${operationType}:${token}`;
    const value = await redis.get(key);
    
    if (!value) {
      return false;
    }

    const payload = JSON.parse(value);
    const currentData = payload.data as T;
    
    // Apply updates
    const updatedData = typeof updates === 'function' 
      ? updates(currentData)
      : { ...currentData, ...updates };

    // Get remaining TTL
    const ttl = await redis.ttl(key);
    if (ttl <= 0) {
      return false;
    }

    // Update with same TTL
    await redis.setEx(
      key,
      ttl,
      JSON.stringify({
        ...payload,
        data: updatedData,
        updatedAt: Date.now(),
      })
    );

    logger.debug('Pending operation updated', { operationType, key });

    return true;
  }

  /**
   * Delete pending operation (useful for cleanup)
   */
  async function deleteOperation(token: string, operationType: string): Promise<boolean> {
    if (actualBackend === 'jwt') {
      // JWT is stateless - nothing to delete
      return true;
    }

    const redis = getRedis();
    if (!redis) {
      return false;
    }

    const key = `${redisKeyPrefix}${operationType}:${token}`;
    const deleted = await redis.del(key);
    
    return deleted > 0;
  }

  /**
   * Check if operation exists and is valid
   */
  async function exists(token: string, operationType: string): Promise<boolean> {
    if (actualBackend === 'jwt') {
      // jwtSecret is guaranteed to be a string (validated above)
      const payload = verifyGenericJWT<any>(token, jwtSecret);
      return payload !== null &&
             payload.type === 'pending_operation' && 
             payload.operationType === operationType;
    }

    const redis = getRedis();
    if (!redis) {
      return false;
    }

    const key = `${redisKeyPrefix}${operationType}:${token}`;
    const exists = await redis.exists(key);
    return exists === 1;
  }

  /**
   * Cleanup expired operations (Redis only - JWT auto-expires)
   * Note: Redis TTL handles expiration automatically, but this can clean up any stale entries
   * Returns number of operations cleaned up
   */
  async function cleanupExpired(operationType?: string): Promise<number> {
    if (actualBackend === 'jwt') {
      // JWT operations auto-expire, nothing to clean up
      return 0;
    }

    const redis = getRedis();
    if (!redis) {
      return 0;
    }

    try {
      const pattern = operationType 
        ? `${redisKeyPrefix}${operationType}:*`
        : `${redisKeyPrefix}*`;
      
      let cleaned = 0;
      
      // Scan for keys and check TTL
      for await (const key of scanKeysIterator({ pattern, maxKeys: 10000 })) {
        const ttl = await redis.ttl(key);
        // TTL of -2 means key doesn't exist, -1 means no expiration set
        // 0 or positive means it exists and has expiration
        // If TTL is 0 or negative (but not -1), the key is expired or doesn't exist
        if (ttl <= 0 && ttl !== -1) {
          // Key is expired or doesn't exist, try to delete it
          const deleted = await redis.del(key);
          if (deleted > 0) {
            cleaned++;
          }
        }
      }
      
      if (cleaned > 0) {
        logger.debug('Cleaned up expired pending operations', {
          operationType: operationType || 'all',
          cleaned,
          backend: actualBackend,
        });
      }
      
      return cleaned;
    } catch (error) {
      logger.error('Failed to cleanup expired pending operations', { error });
      return 0;
    }
  }

  return {
    create,
    verify,
    update,
    delete: deleteOperation,
    exists,
    cleanupExpired,
    backend: actualBackend,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a random token for Redis-based operations
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ═══════════════════════════════════════════════════════════════════
// Convenience Functions (for common use cases)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a registration store (JWT-based, 24h expiration)
 */
export function createRegistrationStore(jwtSecret?: string) {
  return createPendingOperationStore({
    backend: 'jwt',
    jwtSecret,
    defaultExpiration: '24h',
  });
}

/**
 * Create a campaign store (Redis-based, 1h expiration)
 */
export function createCampaignStore() {
  return createPendingOperationStore({
    backend: 'redis',
    redisKeyPrefix: 'campaign:',
    defaultExpiration: 3600, // 1 hour
  });
}

/**
 * Create a multi-step form store (Redis-based, 30min expiration)
 */
export function createFormStore() {
  return createPendingOperationStore({
    backend: 'redis',
    redisKeyPrefix: 'form:',
    defaultExpiration: 1800, // 30 minutes
  });
}
