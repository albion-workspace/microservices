/**
 * Enhanced Retry Logic with Configurable Strategies
 * 
 * Provides retry functionality with:
 * - Multiple retry strategies (exponential, linear, fixed)
 * - Jitter to prevent thundering herd problem
 * - Retry budgets to limit retries per time window
 * - Metrics and monitoring
 * 
 * @example
 * ```typescript
 * const result = await retry(
 *   () => fetch('https://api.example.com'),
 *   {
 *     maxRetries: 3,
 *     strategy: 'exponential',
 *     baseDelay: 100,
 *     maxDelay: 5000,
 *     jitter: true,
 *     retryBudget: { maxRetries: 10, windowMs: 60000 }
 *   }
 * );
 * ```
 */

import { logger } from '../logger.js';
import { getErrorMessage } from '../errors.js';

export type RetryStrategy = 'exponential' | 'linear' | 'fixed';

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Retry strategy (default: 'exponential') */
  strategy?: RetryStrategy;
  /** Base delay in milliseconds (default: 100) */
  baseDelay?: number;
  /** Maximum delay in milliseconds (default: 5000) */
  maxDelay?: number;
  /** Add jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
  /** Retry budget: limit retries per time window */
  retryBudget?: {
    /** Maximum retries allowed in the window */
    maxRetries: number;
    /** Time window in milliseconds */
    windowMs: number;
  };
  /** Name for logging (default: 'Retry') */
  name?: string;
  /** Function to determine if error is retryable (default: all errors are retryable) */
  isRetryable?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalDelay: number;
}

export interface RetryBudget {
  retries: number[]; // Timestamps of retries
  maxRetries: number;
  windowMs: number;
}

/**
 * Check if retry budget allows another retry
 */
function checkRetryBudget(budget: RetryBudget): boolean {
  const now = Date.now();
  const cutoff = now - budget.windowMs;
  
  // Remove old retries outside the window
  budget.retries = budget.retries.filter(timestamp => timestamp >= cutoff);
  
  // Check if we've exceeded the budget
  return budget.retries.length < budget.maxRetries;
}

/**
 * Record a retry attempt in the budget
 */
function recordRetry(budget: RetryBudget): void {
  budget.retries.push(Date.now());
}

/**
 * Calculate delay based on strategy
 */
function calculateDelay(
  attempt: number,
  strategy: RetryStrategy,
  baseDelay: number,
  maxDelay: number
): number {
  let delay: number;

  switch (strategy) {
    case 'exponential':
      delay = baseDelay * Math.pow(2, attempt - 1);
      break;
    case 'linear':
      delay = baseDelay * attempt;
      break;
    case 'fixed':
      delay = baseDelay;
      break;
    default:
      delay = baseDelay * Math.pow(2, attempt - 1);
  }

  return Math.min(delay, maxDelay);
}

/**
 * Add jitter to delay (random value between 0 and delay)
 */
function addJitter(delay: number): number {
  return Math.floor(Math.random() * delay);
}

/**
 * Enhanced retry function with configurable strategies
 */
export async function retry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    strategy = 'exponential',
    baseDelay = 100,
    maxDelay = 5000,
    jitter = true,
    retryBudget,
    name = 'Retry',
    isRetryable = () => true,
  } = config;

  const budget: RetryBudget | null = retryBudget
    ? {
        retries: [],
        maxRetries: retryBudget.maxRetries,
        windowMs: retryBudget.windowMs,
      }
    : null;

  let lastError: unknown;
  let totalDelay = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check retry budget if configured
    if (budget && attempt > 0) {
      if (!checkRetryBudget(budget)) {
        logger.warn(`${name}: Retry budget exceeded`, {
          maxRetries: budget.maxRetries,
          windowMs: budget.windowMs,
          attempts: attempt,
        });
        throw new Error(
          `Retry budget exceeded: ${budget.maxRetries} retries in ${budget.windowMs}ms`
        );
      }
      recordRetry(budget);
    }

    try {
      const result = await fn();
      
      if (attempt > 0) {
        logger.info(`${name}: Operation succeeded after ${attempt} retry(ies)`, {
          attempts: attempt + 1,
          totalDelay,
        });
      }

      return {
        result,
        attempts: attempt + 1,
        totalDelay,
      };
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!isRetryable(error)) {
        logger.debug(`${name}: Error is not retryable`, {
          error: getErrorMessage(error),
          attempt,
        });
        throw error;
      }

      // Don't delay after the last attempt
      if (attempt < maxRetries) {
        const delay = calculateDelay(attempt + 1, strategy, baseDelay, maxDelay);
        const finalDelay = jitter ? addJitter(delay) : delay;
        totalDelay += finalDelay;

        logger.debug(`${name}: Retrying after ${finalDelay}ms`, {
          attempt: attempt + 1,
          maxRetries,
          strategy,
          delay: finalDelay,
        });

        await new Promise(resolve => setTimeout(resolve, finalDelay));
      }
    }
  }

  // All retries exhausted
  logger.error(`${name}: All retries exhausted`, {
    maxRetries,
    totalDelay,
    error: getErrorMessage(lastError),
  });

  throw lastError;
}

/**
 * Create a retry function with pre-configured settings
 */
export function createRetryFunction<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: RetryConfig
): T {
  return (async (...args: Parameters<T>) => {
    const result = await retry(() => fn(...args), config);
    return result.result;
  }) as T;
}

/**
 * Common retry configurations
 */
export const RetryConfigs = {
  /** Fast retries for transient errors (3 attempts, 100ms base) */
  fast: {
    maxRetries: 3,
    strategy: 'exponential' as RetryStrategy,
    baseDelay: 100,
    maxDelay: 1000,
    jitter: true,
  },
  
  /** Standard retries for API calls (5 attempts, 200ms base) */
  standard: {
    maxRetries: 5,
    strategy: 'exponential' as RetryStrategy,
    baseDelay: 200,
    maxDelay: 5000,
    jitter: true,
  },
  
  /** Slow retries for background jobs (10 attempts, 1s base) */
  slow: {
    maxRetries: 10,
    strategy: 'exponential' as RetryStrategy,
    baseDelay: 1000,
    maxDelay: 60000,
    jitter: true,
  },
  
  /** Fixed delay retries (5 attempts, 1s fixed) */
  fixed: {
    maxRetries: 5,
    strategy: 'fixed' as RetryStrategy,
    baseDelay: 1000,
    maxDelay: 1000,
    jitter: false,
  },
};
