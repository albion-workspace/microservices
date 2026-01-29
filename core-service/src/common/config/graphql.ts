/**
 * GraphQL API for Dynamic Configuration Management
 * 
 * Provides GraphQL schema and resolvers for managing service configurations.
 * Permission-aware: filters sensitive paths based on user roles.
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Uses hasRole/hasAnyRole from core-service/access
 * - Static imports
 */

import { GraphQLError } from '../errors.js';
import { hasAnyRole } from '../auth/permissions.js';
import { createConfigStore, type ConfigStore } from './store.js';
import type { ResolverContext } from '../../types/index.js';

// ═══════════════════════════════════════════════════════════════════
// GraphQL Type Definitions
// ═══════════════════════════════════════════════════════════════════

export const configGraphQLTypes = `
  # ═══════════════════════════════════════════════════════════════
  # Configuration Types
  # ═══════════════════════════════════════════════════════════════
  
  type ConfigMetadata {
    description: String
    updatedBy: String
    sensitivePaths: [String!]
  }
  
  type ConfigEntry {
    id: ID!
    service: String!
    brand: String
    tenantId: String
    key: String!
    value: JSON!
    metadata: ConfigMetadata
    createdAt: String!
    updatedAt: String!
    version: Int
  }
  
  input ConfigInput {
    service: String!
    key: String!
    value: JSON!
    brand: String
    tenantId: String
    sensitivePaths: [String!]
    description: String
  }
  
  # ═══════════════════════════════════════════════════════════════
  # Queries
  # ═══════════════════════════════════════════════════════════════
  
  extend type Query {
    """
    Get a single configuration entry
    Returns filtered value (sensitive paths removed) unless user is admin/system
    """
    config(
      service: String!
      key: String!
      brand: String
      tenantId: String
    ): ConfigEntry
    
    """
    Get all configurations for a service
    Returns filtered values (sensitive paths removed) unless includeSensitive=true and user is admin/system
    """
    configs(
      service: String!
      brand: String
      tenantId: String
      includeSensitive: Boolean
    ): [ConfigEntry!]!
  }
  
  # ═══════════════════════════════════════════════════════════════
  # Mutations
  # ═══════════════════════════════════════════════════════════════
  
  extend type Mutation {
    """
    Set a configuration value (admin/system only)
    Automatically increments version for versioning
    """
    setConfig(input: ConfigInput!): ConfigEntry!
    
    """
    Delete a configuration entry (admin/system only)
    """
    deleteConfig(
      service: String!
      key: String!
      brand: String
      tenantId: String
    ): Boolean!
    
    """
    Reload configuration cache for a service (admin/system only)
    """
    reloadConfig(
      service: String!
      brand: String
      tenantId: String
    ): Boolean!
  }
`;

// ═══════════════════════════════════════════════════════════════════
// Resolvers
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if user has admin/system role
 */
async function requireAdmin(user: ResolverContext['user']): Promise<void> {
  if (!user) {
    throw new GraphQLError('Unauthorized', { reason: 'Authentication required' });
  }
  
  const hasRole = await Promise.resolve(hasAnyRole('system', 'admin')(user));
  if (!hasRole) {
    throw new GraphQLError('Forbidden', { reason: 'Admin or system role required' });
  }
}

/**
 * Get config store instance (singleton pattern)
 */
let configStoreInstance: ConfigStore | null = null;

function getConfigStore(): ConfigStore {
  if (!configStoreInstance) {
    configStoreInstance = createConfigStore({
      collectionName: 'service_configs',
      cacheEnabled: true,
      cacheTtl: 300, // 5 minutes
    });
  }
  return configStoreInstance;
}

/**
 * GraphQL Resolvers for Configuration Management
 */
export const configResolvers = {
  Query: {
    /**
     * Get a single configuration entry
     * Filters sensitive paths based on user permissions
     */
    async config(
      _root: unknown,
      args: {
        service: string;
        key: string;
        brand?: string;
        tenantId?: string;
      },
      ctx: ResolverContext
    ) {
      const { service, key, brand, tenantId } = args;
      const configStore = getConfigStore();
      
      const entry = await configStore.getEntry(service, key, {
        brand,
        tenantId,
        user: ctx.user,
      });
      
      if (!entry) {
        return null;
      }
      
      // Convert to GraphQL format (map __v to version, exclude __v from response)
      const { __v, ...entryWithoutV } = entry;
      return {
        ...entryWithoutV,
        version: __v, // Map MongoDB __v to GraphQL version field
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      };
    },
    
    /**
     * Get all configurations for a service
     * Filters sensitive paths based on user permissions
     */
    async configs(
      _root: unknown,
      args: {
        service: string;
        brand?: string;
        tenantId?: string;
        includeSensitive?: boolean;
      },
      ctx: ResolverContext
    ) {
      const { service, brand, tenantId, includeSensitive } = args;
      const configStore = getConfigStore();
      
      // Only allow includeSensitive if user is admin/system
      const hasAdminRole = ctx.user 
        ? (await Promise.resolve(hasAnyRole('system', 'admin')(ctx.user))) === true
        : false;
      const canIncludeSensitive = includeSensitive && hasAdminRole;
      
      const entries = await configStore.getAllEntries(service, {
        brand,
        tenantId,
        user: ctx.user,
        includeSensitive: canIncludeSensitive,
      });
      
      // Convert to GraphQL format (map __v to version, exclude __v from response)
      return entries.map(entry => {
        const { __v, ...entryWithoutV } = entry;
        return {
          ...entryWithoutV,
          version: __v, // Map MongoDB __v to GraphQL version field
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
        };
      });
    },
  },
  
  Mutation: {
    /**
     * Set a configuration value
     * Requires admin/system role
     */
    async setConfig(
      _root: unknown,
      args: {
        input: {
          service: string;
          key: string;
          value: unknown;
          brand?: string;
          tenantId?: string;
          sensitivePaths?: string[];
          description?: string;
        };
      },
      ctx: ResolverContext
    ) {
      await requireAdmin(ctx.user);
      
      const { input } = args;
      const configStore = getConfigStore();
      
      await configStore.set(input.service, input.key, input.value, {
        brand: input.brand,
        tenantId: input.tenantId,
        sensitivePaths: input.sensitivePaths,
        metadata: {
          description: input.description,
          updatedBy: ctx.user?.userId || 'system',
        },
        user: ctx.user,
      });
      
      // Return the updated entry
      const entry = await configStore.getEntry(input.service, input.key, {
        brand: input.brand,
        tenantId: input.tenantId,
        user: ctx.user, // Admin can see all (includeSensitive handled internally)
      });
      
      if (!entry) {
        throw new GraphQLError('ConfigNotFound', { 
          service: input.service, 
          key: input.key 
        });
      }
      
      // Convert to GraphQL format (map __v to version, exclude __v from response)
      const { __v, ...entryWithoutV } = entry;
      return {
        ...entryWithoutV,
        version: __v, // Map MongoDB __v to GraphQL version field
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      };
    },
    
    /**
     * Delete a configuration entry
     * Requires admin/system role
     */
    async deleteConfig(
      _root: unknown,
      args: {
        service: string;
        key: string;
        brand?: string;
        tenantId?: string;
      },
      ctx: ResolverContext
    ) {
      await requireAdmin(ctx.user);
      
      const { service, key, brand, tenantId } = args;
      const configStore = getConfigStore();
      
      await configStore.delete(service, key, { brand, tenantId });
      
      return true;
    },
    
    /**
     * Reload configuration cache for a service
     * Requires admin/system role
     */
    async reloadConfig(
      _root: unknown,
      args: {
        service: string;
        brand?: string;
        tenantId?: string;
      },
      ctx: ResolverContext
    ) {
      await requireAdmin(ctx.user);
      
      const { service, brand, tenantId } = args;
      const configStore = getConfigStore();
      
      await configStore.reload(service, brand, tenantId);
      
      return true;
    },
  },
};
