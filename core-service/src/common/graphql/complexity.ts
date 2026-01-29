/**
 * GraphQL Query Complexity Analysis
 * 
 * Protects against:
 * - DoS attacks via deeply nested queries
 * - Resource exhaustion from expensive queries
 * - Abuse of list/connection fields
 * 
 * Usage:
 * ```typescript
 * import { createComplexityConfig, validateQueryComplexity } from 'core-service';
 * 
 * // Configure complexity limits
 * const complexityConfig = createComplexityConfig({
 *   maxComplexity: 1000,
 *   maxDepth: 10,
 * });
 * 
 * // Validate before execution
 * const error = validateQueryComplexity(schema, query, variables, complexityConfig);
 * if (error) throw error;
 * ```
 */

import {
  getComplexity,
  simpleEstimator,
  fieldExtensionsEstimator,
  directiveEstimator,
} from 'graphql-query-complexity';
import { GraphQLSchema, DocumentNode, GraphQLError, parse } from 'graphql';
import { logger } from '../logger.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ComplexityConfig {
  /** Maximum allowed query complexity (default: 1000) */
  maxComplexity: number;
  /** Default complexity per field (default: 1) */
  defaultFieldComplexity: number;
  /** Multiplier for list fields (default: 10) */
  listMultiplier: number;
  /** Maximum query depth (default: 10) */
  maxDepth: number;
  /** Log complexity for all queries (default: false) */
  logComplexity: boolean;
  /** Custom field complexities by type.field */
  fieldComplexities?: Record<string, number>;
  /** Callback when complexity is calculated */
  onComplexity?: (complexity: number, operationName?: string) => void;
}

export interface ComplexityResult {
  complexity: number;
  allowed: boolean;
  maxComplexity: number;
  depth?: number;
  error?: GraphQLError;
}

// ═══════════════════════════════════════════════════════════════════
// Default Configuration
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: ComplexityConfig = {
  maxComplexity: 1000,
  defaultFieldComplexity: 1,
  listMultiplier: 10,
  maxDepth: 10,
  logComplexity: false,
};

// Common expensive operations with higher complexity
const DEFAULT_FIELD_COMPLEXITIES: Record<string, number> = {
  // Pagination fields are more expensive
  'Query.users': 20,
  'Query.transactions': 20,
  'Query.transfers': 20,
  'Query.wallets': 15,
  'Query.roles': 10,
  'Query.permissions': 10,
  // Mutations that trigger side effects
  'Mutation.createTransfer': 50,
  'Mutation.deposit': 50,
  'Mutation.withdraw': 50,
  // Nested connections
  'User.transactions': 15,
  'User.wallets': 10,
  'Wallet.transactions': 15,
};

// ═══════════════════════════════════════════════════════════════════
// Complexity Configuration Factory
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a complexity configuration with sensible defaults
 * 
 * @example
 * // Use defaults
 * const config = createComplexityConfig();
 * 
 * // Custom limits
 * const config = createComplexityConfig({
 *   maxComplexity: 500,
 *   maxDepth: 5,
 *   logComplexity: true,
 * });
 * 
 * // With custom field complexities
 * const config = createComplexityConfig({
 *   fieldComplexities: {
 *     'Query.expensiveOperation': 100,
 *   },
 * });
 */
export function createComplexityConfig(
  overrides: Partial<ComplexityConfig> = {}
): ComplexityConfig {
  return {
    ...DEFAULT_CONFIG,
    fieldComplexities: {
      ...DEFAULT_FIELD_COMPLEXITIES,
      ...overrides.fieldComplexities,
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Complexity Calculation
// ═══════════════════════════════════════════════════════════════════

/**
 * Calculate query complexity without validation
 * Useful for logging/monitoring
 */
export function calculateComplexity(
  schema: GraphQLSchema,
  query: string | DocumentNode,
  variables: Record<string, unknown> = {},
  config: ComplexityConfig = DEFAULT_CONFIG,
  operationName?: string
): number {
  const document = typeof query === 'string' ? parse(query) : query;
  
  try {
    const complexity = getComplexity({
      schema,
      query: document,
      variables,
      operationName,
      estimators: createEstimators(config),
    });
    
    return complexity;
  } catch (error) {
    logger.warn('Failed to calculate query complexity', { 
      error: error instanceof Error ? error.message : String(error),
      operationName,
    });
    return 0;
  }
}

/**
 * Validate query complexity and return result
 * 
 * @returns ComplexityResult with details
 */
export function analyzeQueryComplexity(
  schema: GraphQLSchema,
  query: string | DocumentNode,
  variables: Record<string, unknown> = {},
  config: ComplexityConfig = DEFAULT_CONFIG,
  operationName?: string
): ComplexityResult {
  const document = typeof query === 'string' ? parse(query) : query;
  
  try {
    const complexity = getComplexity({
      schema,
      query: document,
      variables,
      operationName,
      estimators: createEstimators(config),
    });
    
    const allowed = complexity <= config.maxComplexity;
    
    // Log if configured
    if (config.logComplexity) {
      logger.debug('Query complexity calculated', {
        complexity,
        maxComplexity: config.maxComplexity,
        allowed,
        operationName,
      });
    }
    
    // Call callback if provided
    if (config.onComplexity) {
      config.onComplexity(complexity, operationName);
    }
    
    if (!allowed) {
      return {
        complexity,
        allowed: false,
        maxComplexity: config.maxComplexity,
        error: new GraphQLError(
          `Query complexity ${complexity} exceeds maximum allowed ${config.maxComplexity}`,
          {
            extensions: {
              code: 'QUERY_TOO_COMPLEX',
              complexity,
              maxComplexity: config.maxComplexity,
            },
          }
        ),
      };
    }
    
    return {
      complexity,
      allowed: true,
      maxComplexity: config.maxComplexity,
    };
  } catch (error) {
    logger.error('Query complexity analysis failed', { 
      error: error instanceof Error ? error.message : String(error),
      operationName,
    });
    
    // On error, allow the query but log it
    return {
      complexity: 0,
      allowed: true,
      maxComplexity: config.maxComplexity,
    };
  }
}

/**
 * Validate query complexity and throw if exceeded
 * 
 * @throws GraphQLError if complexity exceeds limit
 * 
 * @example
 * try {
 *   validateQueryComplexity(schema, query, variables, config);
 *   // Execute query
 * } catch (error) {
 *   // Handle complexity error
 * }
 */
export function validateQueryComplexity(
  schema: GraphQLSchema,
  query: string | DocumentNode,
  variables: Record<string, unknown> = {},
  config: ComplexityConfig = DEFAULT_CONFIG,
  operationName?: string
): void {
  const result = analyzeQueryComplexity(schema, query, variables, config, operationName);
  
  if (!result.allowed && result.error) {
    throw result.error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Estimators
// ═══════════════════════════════════════════════════════════════════

function createEstimators(config: ComplexityConfig) {
  return [
    // First: Check for @complexity directive on fields
    directiveEstimator({ name: 'complexity' }),
    
    // Second: Check for field extensions (from resolvers)
    fieldExtensionsEstimator(),
    
    // Third: Custom field complexities from config
    createFieldComplexityEstimator(config),
    
    // Finally: Default complexity
    simpleEstimator({ defaultComplexity: config.defaultFieldComplexity }),
  ];
}

/**
 * Custom estimator for field-specific complexities
 */
function createFieldComplexityEstimator(config: ComplexityConfig) {
  return (options: {
    type: { name: string };
    field: { name: string };
    args: Record<string, unknown>;
    childComplexity: number;
  }) => {
    const { type, field, args, childComplexity } = options;
    const fieldKey = `${type.name}.${field.name}`;
    
    // Check for custom complexity
    const customComplexity = config.fieldComplexities?.[fieldKey];
    if (customComplexity !== undefined) {
      return customComplexity + childComplexity;
    }
    
    // Check if this is a list field with pagination
    const first = args.first as number | undefined;
    const limit = args.limit as number | undefined;
    const count = first ?? limit;
    
    if (count && count > 0) {
      // List fields with explicit count
      return config.defaultFieldComplexity + (childComplexity * Math.min(count, config.listMultiplier));
    }
    
    // Not handled by this estimator
    return undefined;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Middleware Helper
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a complexity validation middleware for graphql-http
 * 
 * @example
 * const complexityMiddleware = createComplexityMiddleware(schema, config);
 * 
 * // In request handler
 * const error = await complexityMiddleware(query, variables, operationName);
 * if (error) return { errors: [error] };
 */
export function createComplexityMiddleware(
  schema: GraphQLSchema,
  config: ComplexityConfig = DEFAULT_CONFIG
) {
  return (
    query: string | DocumentNode,
    variables: Record<string, unknown> = {},
    operationName?: string
  ): GraphQLError | null => {
    const result = analyzeQueryComplexity(schema, query, variables, config, operationName);
    return result.error ?? null;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Presets
// ═══════════════════════════════════════════════════════════════════

/** Strict config for public APIs */
export const STRICT_COMPLEXITY_CONFIG = createComplexityConfig({
  maxComplexity: 500,
  maxDepth: 5,
  listMultiplier: 5,
  logComplexity: true,
});

/** Standard config for authenticated APIs */
export const STANDARD_COMPLEXITY_CONFIG = createComplexityConfig({
  maxComplexity: 1000,
  maxDepth: 10,
  listMultiplier: 10,
  logComplexity: false,
});

/** Relaxed config for admin/internal APIs */
export const RELAXED_COMPLEXITY_CONFIG = createComplexityConfig({
  maxComplexity: 5000,
  maxDepth: 15,
  listMultiplier: 20,
  logComplexity: false,
});
