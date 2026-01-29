/**
 * GraphQL Resolver Builder - Builder Pattern
 * 
 * Simplifies resolver construction and merging for GraphQL gateways.
 * Provides a fluent API for building resolver objects.
 * 
 * Usage:
 * ```typescript
 * const builder = new ResolverBuilder()
 *   .addQuery('health', async () => ({ status: 'ok' }))
 *   .addMutation('createUser', async (args, ctx) => { return user; })
 *   .addService(authService)
 *   .addService(bonusService);
 * 
 * const resolvers = builder.build();
 * ```
 */

import type { ResolverContext } from '../../types/index.js';
import { logger } from '../logger.js';

/**
 * Resolver function type
 */
export type ResolverFunction = (
  args: Record<string, unknown>,
  ctx: ResolverContext
) => Promise<unknown> | unknown;

/**
 * Service module with resolvers
 */
export interface ServiceResolvers {
  Query?: Record<string, ResolverFunction>;
  Mutation?: Record<string, ResolverFunction>;
  Subscription?: Record<string, ResolverFunction>;
}

/**
 * GraphQL Resolver Builder
 * 
 * Uses Builder pattern to construct resolver objects in a fluent, readable way.
 */
export class ResolverBuilder {
  private queryResolvers: Record<string, ResolverFunction> = {};
  private mutationResolvers: Record<string, ResolverFunction> = {};
  private subscriptionResolvers: Record<string, ResolverFunction> = {};
  
  /**
   * Add a query resolver
   */
  addQuery(name: string, resolver: ResolverFunction): this {
    if (this.queryResolvers[name]) {
      logger.warn('Overwriting existing query resolver', { name });
    }
    this.queryResolvers[name] = resolver;
    return this;
  }
  
  /**
   * Add a mutation resolver
   */
  addMutation(name: string, resolver: ResolverFunction): this {
    if (this.mutationResolvers[name]) {
      logger.warn('Overwriting existing mutation resolver', { name });
    }
    this.mutationResolvers[name] = resolver;
    return this;
  }
  
  /**
   * Add a subscription resolver
   */
  addSubscription(name: string, resolver: ResolverFunction): this {
    if (this.subscriptionResolvers[name]) {
      logger.warn('Overwriting existing subscription resolver', { name });
    }
    this.subscriptionResolvers[name] = resolver;
    return this;
  }
  
  /**
   * Add resolvers from a service module
   */
  addService(service: ServiceResolvers): this {
    if (service.Query) {
      Object.assign(this.queryResolvers, service.Query);
    }
    if (service.Mutation) {
      Object.assign(this.mutationResolvers, service.Mutation);
    }
    if (service.Subscription) {
      Object.assign(this.subscriptionResolvers, service.Subscription);
    }
    return this;
  }
  
  /**
   * Add multiple query resolvers at once
   */
  addQueries(queries: Record<string, ResolverFunction>): this {
    Object.assign(this.queryResolvers, queries);
    return this;
  }
  
  /**
   * Add multiple mutation resolvers at once
   */
  addMutations(mutations: Record<string, ResolverFunction>): this {
    Object.assign(this.mutationResolvers, mutations);
    return this;
  }
  
  /**
   * Add multiple subscription resolvers at once
   */
  addSubscriptions(subscriptions: Record<string, ResolverFunction>): this {
    Object.assign(this.subscriptionResolvers, subscriptions);
    return this;
  }
  
  /**
   * Build the resolver object
   */
  build(): {
    Query: Record<string, ResolverFunction>;
    Mutation: Record<string, ResolverFunction>;
    Subscription: Record<string, ResolverFunction>;
  } {
    return {
      Query: this.queryResolvers,
      Mutation: this.mutationResolvers,
      Subscription: this.subscriptionResolvers,
    };
  }
  
  /**
   * Get current query resolvers (for inspection)
   */
  getQueries(): Record<string, ResolverFunction> {
    return { ...this.queryResolvers };
  }
  
  /**
   * Get current mutation resolvers (for inspection)
   */
  getMutations(): Record<string, ResolverFunction> {
    return { ...this.mutationResolvers };
  }
  
  /**
   * Get current subscription resolvers (for inspection)
   */
  getSubscriptions(): Record<string, ResolverFunction> {
    return { ...this.subscriptionResolvers };
  }
  
  /**
   * Clear all resolvers
   */
  clear(): this {
    this.queryResolvers = {};
    this.mutationResolvers = {};
    this.subscriptionResolvers = {};
    return this;
  }
}

/**
 * Convenience function to create a new resolver builder
 */
export function createResolverBuilder(): ResolverBuilder {
  return new ResolverBuilder();
}
