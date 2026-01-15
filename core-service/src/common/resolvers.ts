/**
 * GraphQL Resolver Utilities
 * 
 * Common helpers for GraphQL resolvers
 */

import type { ResolverContext } from '../types/index.js';

/**
 * Require authentication in a GraphQL resolver
 * Throws an error if user is not authenticated
 * 
 * @param ctx - Resolver context
 * @param message - Optional custom error message
 * @throws Error if user is not authenticated
 * 
 * @example
 * ```typescript
 * import { requireAuth } from 'core-service/common/resolvers';
 * 
 * Query: {
 *   myQuery: async (args, ctx) => {
 *     requireAuth(ctx);
 *     // User is guaranteed to be authenticated here
 *     return someData;
 *   }
 * }
 * ```
 */
export function requireAuth(ctx: ResolverContext, message = 'Authentication required'): void {
  if (!ctx.user) {
    throw new Error(message);
  }
}

/**
 * Get tenant ID from context with fallback
 * 
 * @param ctx - Resolver context
 * @param argTenantId - Optional tenant ID from arguments
 * @param defaultTenantId - Default tenant ID if none provided
 * @returns Tenant ID
 * 
 * @example
 * ```typescript
 * import { getTenantId } from 'core-service/common/resolvers';
 * 
 * Query: {
 *   myQuery: async (args, ctx) => {
 *     const tenantId = getTenantId(ctx, args.tenantId);
 *     // Use tenantId for query
 *   }
 * }
 * ```
 */
export function getTenantId(
  ctx: ResolverContext,
  argTenantId?: string,
  defaultTenantId = 'default'
): string {
  return argTenantId || ctx.user?.tenantId || defaultTenantId;
}

/**
 * Get user ID from context
 * Throws an error if user is not authenticated
 * 
 * @param ctx - Resolver context
 * @returns User ID
 * @throws Error if user is not authenticated
 * 
 * @example
 * ```typescript
 * import { getUserId } from 'core-service/common/resolvers';
 * 
 * Mutation: {
 *   myMutation: async (args, ctx) => {
 *     const userId = getUserId(ctx);
 *     // Use userId for mutation
 *   }
 * }
 * ```
 */
export function getUserId(ctx: ResolverContext): string {
  requireAuth(ctx);
  return ctx.user!.userId;
}
