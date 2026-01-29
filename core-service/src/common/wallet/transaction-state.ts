/**
 * Transaction State Manager - Redis-backed for performance
 * 
 * Migrated from MongoDB to Redis for:
 * - Faster writes (heartbeat updates every 5 seconds)
 * - Automatic expiration (TTL replaces recovery job)
 * - Reduced MongoDB load
 * - Better performance for temporary state tracking
 */

import { getRedis } from '../../databases/redis.js';
import { logger } from '../logger.js';

/**
 * Transaction state for crash recovery tracking
 */
export interface TransactionState {
  _id: string; // Transaction ID
  sagaId?: string; // Saga ID if part of saga
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'recovered';
  startedAt: Date;
  lastHeartbeat: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  currentStep?: string;
  steps: string[];
}

/**
 * Redis-based Transaction State Manager
 * 
 * Uses Redis with TTL for automatic expiration:
 * - In-progress states: 60 seconds TTL (auto-expires if no heartbeat)
 * - Completed states: 300 seconds TTL (for monitoring/debugging)
 * - Failed states: 300 seconds TTL (for monitoring/debugging)
 */
export class TransactionStateManager {
  private readonly KEY_PREFIX = 'tx:state:';
  private readonly IN_PROGRESS_TTL = 60; // 60 seconds - auto-expires if no heartbeat
  private readonly COMPLETED_TTL = 300; // 5 minutes - for monitoring
  private readonly FAILED_TTL = 300; // 5 minutes - for monitoring

  /**
   * Create or update transaction state
   */
  async setState(state: TransactionState, ttlSeconds?: number): Promise<void> {
    const redis = getRedis();
    if (!redis) {
      logger.warn('Redis not available, transaction state tracking disabled');
      return;
    }

    const key = `${this.KEY_PREFIX}${state._id}`;
    const ttl = ttlSeconds ?? this.getTTLForStatus(state.status);

    try {
      await redis.setEx(
        key,
        ttl,
        JSON.stringify({
          ...state,
          startedAt: state.startedAt.toISOString(),
          lastHeartbeat: state.lastHeartbeat.toISOString(),
          completedAt: state.completedAt?.toISOString(),
          failedAt: state.failedAt?.toISOString(),
        })
      );
    } catch (error) {
      logger.error('Failed to set transaction state in Redis', {
        stateId: state._id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get transaction state
   */
  async getState(stateId: string): Promise<TransactionState | null> {
    const redis = getRedis();
    if (!redis) {
      return null;
    }

    const key = `${this.KEY_PREFIX}${stateId}`;

    try {
      const value = await redis.get(key);
      if (!value) {
        return null;
      }

      const state = JSON.parse(value) as any;
      return {
        ...state,
        startedAt: new Date(state.startedAt),
        lastHeartbeat: new Date(state.lastHeartbeat),
        completedAt: state.completedAt ? new Date(state.completedAt) : undefined,
        failedAt: state.failedAt ? new Date(state.failedAt) : undefined,
      };
    } catch (error) {
      logger.error('Failed to get transaction state from Redis', {
        stateId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Update heartbeat (extends TTL)
   */
  async updateHeartbeat(stateId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) {
      return;
    }

    const key = `${this.KEY_PREFIX}${stateId}`;

    try {
      // Get current state
      const value = await redis.get(key);
      if (!value) {
        logger.debug('Transaction state not found for heartbeat update', { stateId });
        return;
      }

      const state = JSON.parse(value) as any;
      
      // Update heartbeat timestamp and extend TTL
      const updatedState: TransactionState = {
        ...state,
        lastHeartbeat: new Date(),
      };

      await redis.setEx(
        key,
        this.IN_PROGRESS_TTL,
        JSON.stringify({
          ...updatedState,
          startedAt: updatedState.startedAt instanceof Date ? updatedState.startedAt.toISOString() : updatedState.startedAt,
          lastHeartbeat: updatedState.lastHeartbeat.toISOString(),
          completedAt: updatedState.completedAt instanceof Date ? updatedState.completedAt.toISOString() : updatedState.completedAt,
          failedAt: updatedState.failedAt instanceof Date ? updatedState.failedAt.toISOString() : updatedState.failedAt,
        })
      );
    } catch (error) {
      logger.debug('Failed to update transaction heartbeat', {
        stateId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Update state status (with appropriate TTL)
   */
  async updateStatus(
    stateId: string,
    status: TransactionState['status'],
    updates?: Partial<Pick<TransactionState, 'error' | 'completedAt' | 'failedAt' | 'currentStep' | 'steps'>>
  ): Promise<void> {
    const redis = getRedis();
    if (!redis) {
      return;
    }

    const key = `${this.KEY_PREFIX}${stateId}`;

    try {
      // Get current state
      const value = await redis.get(key);
      if (!value) {
        logger.debug('Transaction state not found for status update', { stateId });
        return;
      }

      const state = JSON.parse(value) as any;
      
      // Update state
      const updatedState: TransactionState = {
        ...state,
        status,
        ...updates,
        lastHeartbeat: new Date(), // Update heartbeat on status change
      };

      const ttl = this.getTTLForStatus(status);
      await redis.setEx(
        key,
        ttl,
        JSON.stringify({
          ...updatedState,
          startedAt: updatedState.startedAt instanceof Date ? updatedState.startedAt.toISOString() : updatedState.startedAt,
          lastHeartbeat: updatedState.lastHeartbeat.toISOString(),
          completedAt: updatedState.completedAt instanceof Date ? updatedState.completedAt.toISOString() : updatedState.completedAt,
          failedAt: updatedState.failedAt instanceof Date ? updatedState.failedAt.toISOString() : updatedState.failedAt,
        })
      );
    } catch (error) {
      logger.error('Failed to update transaction state status', {
        stateId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Delete transaction state
   */
  async deleteState(stateId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) {
      return;
    }

    const key = `${this.KEY_PREFIX}${stateId}`;

    try {
      await redis.del(key);
    } catch (error) {
      logger.debug('Failed to delete transaction state', {
        stateId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Find stuck transactions (no heartbeat in maxAgeSeconds)
   * Uses Redis SCAN to find all transaction states and filters by heartbeat age
   * 
   * Note: Redis TTL automatically expires states (60s for in-progress), but this method
   * allows monitoring and recovery of stuck transactions before TTL expiration
   */
  async findStuckTransactions(maxAgeSeconds: number = 30): Promise<TransactionState[]> {
    const redis = getRedis();
    if (!redis) {
      return [];
    }

    const stuckTransactions: TransactionState[] = [];
    const now = Date.now();
    const maxAgeMs = maxAgeSeconds * 1000;

    try {
      // Step 1: Scan keys efficiently using scanIterator
      const { scanKeysIterator, batchGetValues } = await import('../../databases/redis.js');
      
      const keys: string[] = [];
      for await (const key of scanKeysIterator({
        pattern: `${this.KEY_PREFIX}*`,
        maxKeys: 10000, // Limit scan to prevent excessive load
        batchSize: 100,
      })) {
        keys.push(key);
      }

      if (keys.length === 0) {
        return [];
      }

      // Step 2: Batch get values using MGET (more efficient than individual GET calls)
      const values = await batchGetValues(keys);

      // Step 3: Process values
      for (const key of keys) {
        try {
          const value = values[key];
          if (!value) {
            // Keys from scanIterator are guaranteed to exist, but may have expired between scan and get
            continue;
          }

          const state = JSON.parse(value) as any;
          const lastHeartbeat = new Date(state.lastHeartbeat).getTime();
          const ageMs = now - lastHeartbeat;

          // Check if transaction is stuck (no heartbeat in maxAgeSeconds)
          if (ageMs > maxAgeMs) {
            // Only include in-progress or pending transactions
            if (state.status === 'in_progress' || state.status === 'pending') {
              // Extract transaction ID from key (remove prefix)
              const txId = key.startsWith(this.KEY_PREFIX) 
                ? key.substring(this.KEY_PREFIX.length)
                : key;
              
              stuckTransactions.push({
                ...state,
                _id: txId,
                startedAt: new Date(state.startedAt),
                lastHeartbeat: new Date(state.lastHeartbeat),
                completedAt: state.completedAt ? new Date(state.completedAt) : undefined,
                failedAt: state.failedAt ? new Date(state.failedAt) : undefined,
              });
            }
          }
        } catch (error) {
          // Skip invalid keys
          logger.debug('Failed to parse transaction state during scan', {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.debug('Found stuck transactions', {
        count: stuckTransactions.length,
        maxAgeSeconds,
      });

      return stuckTransactions;
    } catch (error) {
      logger.error('Failed to find stuck transactions', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Recover stuck transactions (mark as recovered)
   * Finds stuck transactions and marks them as recovered
   * 
   * @returns Number of transactions recovered
   */
  async recoverStuckTransactions(maxAgeSeconds: number = 30): Promise<number> {
    const stuckTransactions = await this.findStuckTransactions(maxAgeSeconds);
    
    if (stuckTransactions.length === 0) {
      return 0;
    }

    let recoveredCount = 0;
    const now = new Date();

    for (const tx of stuckTransactions) {
      try {
        // Mark as recovered
        const recoveredState: TransactionState = {
          ...tx,
          status: 'recovered',
          failedAt: now,
          error: 'Transaction timeout - no heartbeat received',
        };

        await this.setState(recoveredState, this.FAILED_TTL);
        recoveredCount++;

        logger.info('Recovered stuck transaction', {
          txId: tx._id,
          age: Math.round((now.getTime() - tx.lastHeartbeat.getTime()) / 1000),
        });
      } catch (error) {
        logger.error('Failed to recover stuck transaction', {
          txId: tx._id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return recoveredCount;
  }

  /**
   * Get TTL for status
   */
  private getTTLForStatus(status: TransactionState['status']): number {
    switch (status) {
      case 'in_progress':
      case 'pending':
        return this.IN_PROGRESS_TTL;
      case 'completed':
        return this.COMPLETED_TTL;
      case 'failed':
      case 'recovered':
        return this.FAILED_TTL;
      default:
        return this.IN_PROGRESS_TTL;
    }
  }
}

// Singleton instance
let stateManager: TransactionStateManager | null = null;

/**
 * Get transaction state manager instance
 */
export function getTransactionStateManager(): TransactionStateManager {
  if (!stateManager) {
    stateManager = new TransactionStateManager();
  }
  return stateManager;
}
