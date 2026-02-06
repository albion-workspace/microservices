/**
 * Event handler wrapper - consistent error handling for integration event handlers
 *
 * Wraps an async handler in try/catch and maps failures to GraphQLError with eventId and error message.
 * Use for event handlers that should fail with a specific error code (e.g. payment bonus handlers).
 */

import { GraphQLError, getErrorMessage } from '../errors.js';

/** Minimal event shape for error context (eventId) */
export interface EventWithId {
  eventId?: string;
}

/**
 * Wrap an async event handler with try/catch; on error, throw GraphQLError with errorCode and context.
 *
 * @param errorCode - GraphQL error code (e.g. PAYMENT_ERRORS.FailedToCreditBonusToWallet)
 * @param handler - Async handler(event) => Promise<void>
 * @returns Wrapped handler that throws GraphQLError on failure
 */
export function withEventHandlerError<T extends EventWithId>(
  errorCode: string,
  handler: (event: T) => Promise<void>
): (event: T) => Promise<void> {
  return async (event: T) => {
    try {
      await handler(event);
    } catch (err) {
      throw new GraphQLError(errorCode, {
        error: getErrorMessage(err),
        eventId: event.eventId,
      });
    }
  };
}
