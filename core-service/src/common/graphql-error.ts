import { GraphQLError as GraphQLErrorType } from 'graphql';

import { logger, getCorrelationId } from './logger.js';

/**
 * Format string to CapitalCamelCase
 * Examples:
 * - "user not found" -> "UserNotFound"
 * - "invalid token" -> "InvalidToken"
 * - "MSAuthUserNotFound" -> "MSAuthUserNotFound" (already formatted)
 * - "user_not_found" -> "UserNotFound"
 */
function formatToCapitalCamelCase(str: string): string {
  if (!str) return 'RuntimeError';
  
  // If already CapitalCamelCase (starts with capital), return as-is
  if (/^[A-Z]/.test(str)) {
    return str;
  }
  
  // Convert to CapitalCamelCase
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // Replace non-alphanumeric with space
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * GraphQL Error Class
 * 
 * Simple error class for GraphQL resolvers with extensions support.
 * Messages are automatically formatted to CapitalCamelCase for consistency.
 * Errors are automatically logged (since prefix tells us where it came from).
 * 
 * @example
 * ```typescript
 * if (!user) {
 *   throw new GraphQLError('UserNotFound', { userId: _id });
 *   // Automatically logged with correlation ID and context
 * }
 * 
 * // With service prefix
 * throw new GraphQLError('MSAuthUserNotFound', { userId: _id });
 * // Automatically logged - we know it's from auth-service
 * ```
 */
export class GraphQLError extends Error {
  public extensions: Record<string, unknown>;
  
  constructor(type: string, details?: Record<string, unknown>) {
    // Format message to CapitalCamelCase (e.g., "user not found" -> "UserNotFound")
    const formattedMessage = formatToCapitalCamelCase(type);
    super(formattedMessage);
    
    this.name = 'GraphQLError';
    this.extensions = details || {};
    
    // Add error type to extensions for client-side handling
    this.extensions.code = formattedMessage;
    
    // Capture stack trace if available
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GraphQLError);
    }
    
    // Auto-log error (formatted message already contains service prefix if present)
    logger.error('GraphQL Error', {
      code: formattedMessage, // Already contains service prefix (e.g., "MSAuthUserNotFound")
      details: this.extensions,
      correlationId: getCorrelationId(),
    });
  }
  
  /**
   * Format any error to GraphQLError format
   * Useful for catching and reformatting existing errors
   * Automatically logs the error
   */
  static format(error: Error | unknown): GraphQLError {
    const message = error instanceof Error ? error.message : String(error);
    const formattedMessage = formatToCapitalCamelCase(message);
    
    if (error instanceof GraphQLError) {
      return error; // Already formatted and logged
    }
    
    // Create const instance and return (constructor will auto-log)
    const graphQLError = new GraphQLError(formattedMessage, {
      originalError: error instanceof Error ? error.message : String(error),
    });
    return graphQLError;
  }
}

/**
 * Helper to create service-prefixed errors
 * 
 * @example
 * ```typescript
 * throw createServiceError('auth', 'UserNotFound', { userId: _id });
 * // Results in: "MSAuthUserNotFound"
 * ```
 */
export function createServiceError(
  service: string,
  errorType: string,
  details?: Record<string, unknown>
): GraphQLError {
  const prefix = `MS${service.charAt(0).toUpperCase() + service.slice(1)}`;
  const errorCode = `${prefix}${formatToCapitalCamelCase(errorType)}`;
  return new GraphQLError(errorCode, details);
}

/**
 * Format error for GraphQL response
 * Automatically handles GraphQLError instances and formats others
 * Note: GraphQLError constructor already logs the error, so no need to log again here
 * 
 * @example
 * ```typescript
 * try {
 *   return await resolver(args, ctx);
 * } catch (error) {
 *   throw formatGraphQLError(error, {
 *     correlationId: getCorrelationId(),
 *     userId: ctx.user?.userId,
 *   });
 * }
 * ```
 */
export function formatGraphQLError(
  error: unknown,
  context?: { correlationId?: string; userId?: string }
): GraphQLErrorType {
  // If already a GraphQLError, format it (already logged in constructor)
  if (error instanceof GraphQLError) {
    return new GraphQLErrorType(error.message, {
      extensions: {
        code: error.extensions.code || error.message,
        ...error.extensions,
        correlationId: context?.correlationId || getCorrelationId(),
        userId: context?.userId,
      },
      originalError: error,
    });
  }
  
  // Format other errors (GraphQLError.format() will auto-log)
  const formatted = GraphQLError.format(error);
  return new GraphQLErrorType(formatted.message, {
    extensions: {
      code: formatted.extensions.code || formatted.message,
      ...formatted.extensions,
      correlationId: context?.correlationId || getCorrelationId(),
      userId: context?.userId,
    },
    originalError: formatted,
  });
}
