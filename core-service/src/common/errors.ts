/**
 * Error Handling Utilities
 * 
 * Unified error handling for all error-related functionality:
 * - Generic error utilities (getErrorMessage, normalizeError)
 * - GraphQL error handling (GraphQLError class, formatGraphQLError)
 * - Error code registry (registerServiceErrorCodes, getAllErrorCodes)
 */

import { GraphQLError as GraphQLErrorType } from 'graphql';
import { logger, getCorrelationId } from './logger.js';

// ═══════════════════════════════════════════════════════════════════
// Generic Error Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract error message from any error type
 * 
 * @param error - Error object of any type
 * @returns String representation of the error message
 * 
 * @example
 * ```typescript
 * import { getErrorMessage } from 'core-service';
 * 
 * try {
 *   // some operation
 * } catch (error) {
 *   const message = getErrorMessage(error);
 *   logger.error('Operation failed', { error: message });
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Create a standardized error object from any error type
 * 
 * @param error - Error object of any type
 * @returns Object with message and optional stack
 * 
 * @example
 * ```typescript
 * import { normalizeError } from 'core-service';
 * 
 * try {
 *   // some operation
 * } catch (error) {
 *   const normalized = normalizeError(error);
 *   logger.error('Operation failed', normalized);
 * }
 * ```
 */
export function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: getErrorMessage(error),
  };
}

// ═══════════════════════════════════════════════════════════════════
// GraphQL Error Handling
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Error Code Registry
// ═══════════════════════════════════════════════════════════════════

/**
 * Error Code Registry
 * 
 * Service-agnostic registry that merges error codes from all microservices.
 * Core-service doesn't know which services exist - it just merges what services provide.
 * 
 * Simple and straightforward: just a flat array of error codes.
 * Client can categorize if needed using the error code prefix (e.g., "MSAuth..." -> "Auth" service).
 * 
 * Used for:
 * - GraphQL error discovery query
 * - i18n key generation
 * - Documentation
 */

// Simple flat registry - stores all error codes from all services
const errorCodeRegistry = new Set<string>();

/**
 * Register error codes from a service
 * Called by each service during initialization
 */
export function registerServiceErrorCodes(codes: readonly string[]): void {
  codes.forEach(code => errorCodeRegistry.add(code));
}

/**
 * Get all registered error codes as a flat array
 * Simple export - client can categorize if needed
 */
export function getAllErrorCodes(): string[] {
  return Array.from(errorCodeRegistry).sort();
}

/**
 * Extract service name from error code prefix (e.g., "MSAuthUserNotFound" -> "Auth")
 * Optional helper for client-side categorization
 */
export function extractServiceFromCode(code: string): string | null {
  const match = code.match(/^MS([A-Z][a-z]+)/);
  return match ? match[1] : null;
}
