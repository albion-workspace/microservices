/**
 * GraphQL Resolver Types
 */

import type { UserContext } from './auth.js';

// ═══════════════════════════════════════════════════════════════════
// Resolver Context
// ═══════════════════════════════════════════════════════════════════

export interface ResolverContext {
  user: UserContext | null;
  requestId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Resolver Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Standard resolver for Query and Mutation
 */
export type Resolver = (
  args: Record<string, unknown>, 
  ctx: ResolverContext
) => unknown;

/**
 * Subscription resolver - async generator that yields values
 */
export type SubscriptionResolver = (
  args: Record<string, unknown>,
  ctx: ResolverContext
) => AsyncGenerator<unknown, void, unknown>;

/**
 * GraphQL resolvers interface
 */
export interface Resolvers {
  Query: Record<string, Resolver>;
  Mutation: Record<string, Resolver>;
  Subscription?: Record<string, SubscriptionResolver>;
}
