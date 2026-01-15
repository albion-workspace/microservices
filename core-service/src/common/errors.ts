/**
 * Error Utilities
 * 
 * Common error handling helpers used across services
 */

/**
 * Extract error message from any error type
 * 
 * @param error - Error object of any type
 * @returns String representation of the error message
 * 
 * @example
 * ```typescript
 * import { getErrorMessage } from 'core-service/common/errors';
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
 * import { normalizeError } from 'core-service/common/errors';
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
