/**
 * GraphQL Resolver Utilities
 * 
 * Common helpers for GraphQL resolvers
 */

import type { ResolverContext } from '../../types/index.js';

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

/**
 * Creates a cursor-paginated query resolver that filters by objectModel
 * 
 * This utility is useful for services that query a shared collection (like transactions)
 * but need to filter by objectModel (e.g., 'deposit', 'withdrawal', 'bet', 'win').
 * 
 * @param repository - The repository to query (must have paginate method)
 * @param objectModel - The objectModel value to filter by (e.g., 'deposit', 'withdrawal')
 * @returns A GraphQL query resolver function
 * 
 * @example
 * ```typescript
 * import { createObjectModelQueryResolver } from 'core-service/common/resolvers';
 * 
 * Query: {
 *   deposits: createObjectModelQueryResolver(depositService.repository, 'deposit'),
 *   withdrawals: createObjectModelQueryResolver(withdrawalService.repository, 'withdrawal'),
 * }
 * ```
 */
export function createObjectModelQueryResolver(
  repository: { 
    paginate: (opts: {
      first?: number;
      after?: string;
      last?: number;
      before?: string;
      filter: Record<string, unknown>;
      sortField: string;
      sortDirection: 'asc' | 'desc';
    }) => Promise<{
      edges: Array<{ node: unknown; cursor: string }>;
      totalCount: number;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
      };
    }> 
  },
  objectModel: string
) {
  return async (args: Record<string, unknown>, ctx: ResolverContext) => {
    const { 
      first = 20, 
      after, 
      last, 
      before, 
      filter = {} 
    } = args as { 
      first?: number; 
      after?: string; 
      last?: number; 
      before?: string; 
      filter?: Record<string, unknown> 
    };
    
    // Always filter by the specified objectModel
    const enhancedFilter = {
      ...filter,
      objectModel,
    };
    
    // Use cursor-based pagination (O(1) performance)
    const result = await repository.paginate({
      first: first ? Math.min(Math.max(1, first), 100) : undefined, // Max 100 per page
      after,
      last: last ? Math.min(Math.max(1, last), 100) : undefined,
      before,
      filter: enhancedFilter,
      sortField: 'createdAt',
      sortDirection: 'desc',
    });
    
    return {
      nodes: result.edges.map(edge => edge.node),
      totalCount: result.totalCount,
      pageInfo: result.pageInfo,
    };
  };
}
