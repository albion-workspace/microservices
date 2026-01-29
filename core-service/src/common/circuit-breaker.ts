/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures by stopping requests to failing services
 * and allowing them to recover gradually.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF-OPEN: Testing if service has recovered, allows limited requests
 * 
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 60000, // 1 minute
 *   monitoringWindow: 120000, // 2 minutes
 * });
 * 
 * try {
 *   const result = await breaker.execute(() => fetch('https://api.example.com'));
 * } catch (error) {
 *   if (error instanceof CircuitBreakerOpenError) {
 *     // Circuit breaker is open, service is down
 *   }
 * }
 * ```
 */

import { logger } from './logger.js';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before attempting half-open state (default: 60000) */
  resetTimeout?: number;
  /** Time window in ms for tracking failures (default: 120000) */
  monitoringWindow?: number;
  /** Name for logging (default: 'CircuitBreaker') */
  name?: string;
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string, public readonly state: 'open' | 'half-open') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  private failures: number[] = []; // Timestamps of failures
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private halfOpenAttempts: number = 0;
  private successCount: number = 0;
  
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly monitoringWindow: number;
  private readonly name: string;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeout = config.resetTimeout ?? 60000; // 1 minute
    this.monitoringWindow = config.monitoringWindow ?? 120000; // 2 minutes
    this.name = config.name ?? 'CircuitBreaker';
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Clean old failures outside monitoring window
    this.cleanOldFailures();

    // Check circuit state
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceLastFailure >= this.resetTimeout) {
        // Transition to half-open to test recovery
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
        this.successCount = 0;
        
        logger.info(`${this.name}: Transitioning to HALF-OPEN state`, {
          timeSinceLastFailure,
          resetTimeout: this.resetTimeout,
        });
      } else {
        // Still in open state, reject immediately
        const remainingTime = this.resetTimeout - timeSinceLastFailure;
        throw new CircuitBreakerOpenError(
          `Circuit breaker is OPEN. Service unavailable. Retry after ${Math.ceil(remainingTime / 1000)}s`,
          'open'
        );
      }
    }

    // Execute the function
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      
      // If we get enough successes in half-open, close the circuit
      if (this.successCount >= 2) {
        this.state = 'closed';
        this.failures = [];
        this.lastFailureTime = 0;
        this.halfOpenAttempts = 0;
        this.successCount = 0;
        
        logger.info(`${this.name}: Circuit breaker CLOSED (service recovered)`, {
          successes: this.successCount,
        });
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success (successful requests indicate health)
      if (this.failures.length > 0) {
        this.failures = [];
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.lastFailureTime = now;

    if (this.state === 'half-open') {
      // Failure in half-open state, immediately open circuit
      this.state = 'open';
      this.halfOpenAttempts = 0;
      this.successCount = 0;
      
      logger.warn(`${this.name}: Circuit breaker OPENED (service still failing)`, {
        halfOpenAttempts: this.halfOpenAttempts,
      });
    } else if (this.state === 'closed') {
      // Check if we've exceeded failure threshold
      const recentFailures = this.getRecentFailures();
      
      if (recentFailures >= this.failureThreshold) {
        this.state = 'open';
        
        logger.error(`${this.name}: Circuit breaker OPENED`, {
          failures: recentFailures,
          threshold: this.failureThreshold,
          monitoringWindow: this.monitoringWindow,
        });
      }
    }
  }

  /**
   * Get number of failures in the monitoring window
   */
  private getRecentFailures(): number {
    const now = Date.now();
    const cutoff = now - this.monitoringWindow;
    return this.failures.filter(timestamp => timestamp >= cutoff).length;
  }

  /**
   * Remove failures outside the monitoring window
   */
  private cleanOldFailures(): void {
    const now = Date.now();
    const cutoff = now - this.monitoringWindow;
    this.failures = this.failures.filter(timestamp => timestamp >= cutoff);
  }

  /**
   * Get current circuit breaker state
   */
  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    recentFailures: number;
    lastFailureTime: number | null;
    timeUntilRetry: number | null;
  } {
    const recentFailures = this.getRecentFailures();
    const timeUntilRetry = this.state === 'open' 
      ? Math.max(0, this.resetTimeout - (Date.now() - this.lastFailureTime))
      : null;

    return {
      state: this.state,
      failures: this.failures.length,
      recentFailures,
      lastFailureTime: this.lastFailureTime || null,
      timeUntilRetry,
    };
  }

  /**
   * Manually reset circuit breaker (for testing or manual recovery)
   */
  reset(): void {
    this.state = 'closed';
    this.failures = [];
    this.lastFailureTime = 0;
    this.halfOpenAttempts = 0;
    this.successCount = 0;
    
    logger.info(`${this.name}: Circuit breaker manually RESET`);
  }
}

/**
 * Create a circuit breaker instance with default configuration
 */
export function createCircuitBreaker(config?: CircuitBreakerConfig): CircuitBreaker {
  return new CircuitBreaker(config);
}
