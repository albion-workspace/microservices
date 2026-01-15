/**
 * Access Control Cache
 * 
 * Redis caching layer for compiled permissions.
 * Provides fast permission checks with automatic invalidation.
 */

import { getCache, setCache, deleteCache, deleteCachePattern } from '../common/cache.js';
import { publish, subscribe } from '../common/redis.js';
import { matchUrn, parseUrn } from 'access-engine';
import type { CompiledPermissions, ResolvedAccessConfig, URN } from './types-ext.js';

// Compile URN matcher from permissions
function compileURNMatcher(permissions: string[]): (urn: URN) => boolean {
  return (urn: URN) => {
    const urnString = `${urn.resource}:${urn.action}:${urn.target}`;
    return permissions.some(perm => matchUrn(urnString, perm));
  };
}

// ═══════════════════════════════════════════════════════════════════
// Cache Events (for cross-instance invalidation)
// ═══════════════════════════════════════════════════════════════════

export type CacheInvalidationEvent = 
  | { type: 'user'; userId: string; tenantId: string }
  | { type: 'tenant'; tenantId: string }
  | { type: 'role'; roleName: string; tenantId: string }
  | { type: 'all' };

const INVALIDATION_CHANNEL = 'access:invalidate';

// ═══════════════════════════════════════════════════════════════════
// Access Cache
// ═══════════════════════════════════════════════════════════════════

export class AccessCache {
  private config: ResolvedAccessConfig;
  
  // In-memory LRU cache for hot paths
  private memoryCache = new Map<string, { data: CompiledPermissions; expiresAt: number }>();
  private maxMemoryCacheSize = 1000;
  
  constructor(config: ResolvedAccessConfig) {
    this.config = config;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Cache Keys
  // ─────────────────────────────────────────────────────────────────
  
  private cacheKey(userId: string, tenantId: string): string {
    return `${this.config.cache.prefix}:${tenantId}:${userId}`;
  }
  
  private tenantPattern(tenantId: string): string {
    return `${this.config.cache.prefix}:${tenantId}:*`;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Get / Set
  // ─────────────────────────────────────────────────────────────────
  
  async get(userId: string, tenantId: string): Promise<CompiledPermissions | null> {
    if (!this.config.cache.enabled) return null;
    
    const key = this.cacheKey(userId, tenantId);
    
    // Check memory cache first (fastest)
    const memEntry = this.memoryCache.get(key);
    if (memEntry && memEntry.expiresAt > Date.now()) {
      return memEntry.data;
    }
    
    // Check Redis cache
    const cached = await getCache<SerializedPermissions>(key);
    if (cached) {
      const permissions = this.deserialize(cached);
      
      // Store in memory cache
      this.setMemoryCache(key, permissions);
      
      return permissions;
    }
    
    return null;
  }
  
  async set(permissions: CompiledPermissions): Promise<void> {
    if (!this.config.cache.enabled) return;
    
    const key = this.cacheKey(permissions.userId, permissions.tenantId);
    const serialized = this.serialize(permissions);
    
    // Store in Redis
    await setCache(key, serialized, this.config.cache.ttl);
    
    // Store in memory cache
    this.setMemoryCache(key, permissions);
  }
  
  private setMemoryCache(key: string, permissions: CompiledPermissions): void {
    // Simple LRU: if full, remove oldest entry
    if (this.memoryCache.size >= this.maxMemoryCacheSize) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) this.memoryCache.delete(firstKey);
    }
    
    this.memoryCache.set(key, {
      data: permissions,
      expiresAt: Date.now() + (this.config.cache.ttl * 1000),
    });
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Serialization (handle non-serializable fields)
  // ─────────────────────────────────────────────────────────────────
  
  private serialize(permissions: CompiledPermissions): SerializedPermissions {
    return {
      userId: permissions.userId,
      tenantId: permissions.tenantId,
      roles: permissions.roles,
      urns: permissions.urns,
      grants: permissions.grants,
      denies: permissions.denies,
      computedAt: permissions.computedAt,
      expiresAt: permissions.expiresAt,
    };
  }
  
  private deserialize(serialized: SerializedPermissions): CompiledPermissions {
    return {
      ...serialized,
      permissions: [],  // Would need to reconstruct from urns
      matcher: compileURNMatcher(serialized.urns),
      compiledAt: new Date(serialized.computedAt),
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Invalidation
  // ─────────────────────────────────────────────────────────────────
  
  async invalidateUser(userId: string, tenantId: string): Promise<void> {
    const key = this.cacheKey(userId, tenantId);
    
    // Clear local memory cache
    this.memoryCache.delete(key);
    
    // Clear Redis cache
    await deleteCache(key);
    
    // Notify other instances
    await this.publishInvalidation({ type: 'user', userId, tenantId });
  }
  
  async invalidateTenant(tenantId: string): Promise<void> {
    // Clear local memory cache for tenant
    for (const key of this.memoryCache.keys()) {
      if (key.includes(`:${tenantId}:`)) {
        this.memoryCache.delete(key);
      }
    }
    
    // Clear Redis cache for tenant
    await deleteCachePattern(this.tenantPattern(tenantId));
    
    // Notify other instances
    await this.publishInvalidation({ type: 'tenant', tenantId });
  }
  
  async invalidateRole(roleName: string, tenantId: string): Promise<void> {
    // When a role changes, we need to invalidate all users with that role
    // This is expensive, so we just invalidate the whole tenant
    await this.invalidateTenant(tenantId);
    
    // Notify other instances
    await this.publishInvalidation({ type: 'role', roleName, tenantId });
  }
  
  async invalidateAll(): Promise<void> {
    // Clear all memory cache
    this.memoryCache.clear();
    
    // Clear all Redis cache for this prefix
    await deleteCachePattern(`${this.config.cache.prefix}:*`);
    
    // Notify other instances
    await this.publishInvalidation({ type: 'all' });
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Cross-Instance Invalidation
  // ─────────────────────────────────────────────────────────────────
  
  private async publishInvalidation(event: CacheInvalidationEvent): Promise<void> {
    try {
      await publish(INVALIDATION_CHANNEL, event);
    } catch {
      // Redis not available, skip
    }
  }
  
  async startInvalidationListener(): Promise<void> {
    try {
      await subscribe(INVALIDATION_CHANNEL, (message: string) => {
        try {
          const event = JSON.parse(message) as CacheInvalidationEvent;
          this.handleInvalidationEvent(event);
        } catch {
          // Invalid message format, skip
        }
      });
    } catch {
      // Redis not available, skip
    }
  }
  
  private handleInvalidationEvent(event: CacheInvalidationEvent): void {
    switch (event.type) {
      case 'user':
        this.memoryCache.delete(this.cacheKey(event.userId, event.tenantId));
        break;
        
      case 'tenant':
      case 'role':
        for (const key of this.memoryCache.keys()) {
          if (key.includes(`:${event.tenantId}:`)) {
            this.memoryCache.delete(key);
          }
        }
        break;
        
      case 'all':
        this.memoryCache.clear();
        break;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────────────────────────
  
  getStats(): CacheStats {
    let validEntries = 0;
    let expiredEntries = 0;
    const now = Date.now();
    
    for (const entry of this.memoryCache.values()) {
      if (entry.expiresAt > now) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }
    
    return {
      memoryCacheSize: this.memoryCache.size,
      validEntries,
      expiredEntries,
      maxSize: this.maxMemoryCacheSize,
      ttlSeconds: this.config.cache.ttl,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────
  
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expiresAt <= now) {
        this.memoryCache.delete(key);
        cleaned++;
      }
    }
    
    return cleaned;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Serialized permissions (no functions)
 */
interface SerializedPermissions {
  userId: string;
  tenantId: string;
  roles: string[];
  urns: string[];
  grants: Record<string, string[]>;
  denies: string[];
  computedAt: number;
  expiresAt: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  memoryCacheSize: number;
  validEntries: number;
  expiredEntries: number;
  maxSize: number;
  ttlSeconds: number;
}

