/**
 * Generic Recovery System - Reusable recovery pattern for any operation
 * 
 * This module provides a generic recovery system that can be applied to:
 * - Transfers (current)
 * - Orders (future - user buys something, creates financial transaction)
 * - Any operation that creates financial transactions + related documents
 * 
 * Architecture:
 * - Generic operation interface (RecoverableOperation)
 * - Generic recovery helper (recoverOperation)
 * - Generic state tracker (Redis-based)
 * - Recovery job (finds stuck operations and recovers them)
 * 
 * Usage Pattern:
 * ```typescript
 * // 1. Define operation handler
 * const transferRecoveryHandler: RecoveryHandler<Transfer> = {
 *   findOperation: async (id) => await transfersCollection.findOne({ id }),
 *   findRelatedTransactions: async (id) => await transactionsCollection.find({ objectId: id, objectModel: 'transfer' }),
 *   reverseOperation: async (operation, session) => {
 *     // Create reverse transfer
 *     return await createReverseTransfer(operation, session);
 *   },
 *   deleteOperation: async (id, session) => {
 *     await transfersCollection.deleteOne({ id }, { session });
 *   },
 *   updateStatus: async (id, status, meta, session) => {
 *     await transfersCollection.updateOne({ id }, { $set: { status, ...meta, updatedAt: new Date() } }, { session });
 *   },
 * };
 * 
 * // 2. Use recovery helper
 * const result = await recoverOperation(transferId, transferRecoveryHandler);
 * 
 * // 3. Register for recovery job
 * registerRecoveryHandler('transfer', transferRecoveryHandler);
 * ```
 */

import type { ClientSession, Db, MongoClient } from 'mongodb';
import { logger } from '../../index.js';
import { getRedis, scanKeysArray } from '../../databases/redis/connection.js';
import type { DatabaseStrategyResolver, DatabaseContext } from '../../databases/mongodb/strategy.js';
import { DEFAULT_TRANSACTION_OPTIONS } from '../wallet/wallet.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Recoverable operation interface
 * Any operation that can be recovered must implement this
 */
export interface RecoverableOperation {
  id: string;
  status: 'pending' | 'active' | 'approved' | 'completed' | 'canceled' | 'failed' | 'recovered';
  createdAt: Date;
  updatedAt?: Date;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  recovered: boolean;
  action: 'deleted' | 'reversed' | 'already_failed' | 'no_action_needed';
  reverseOperationId?: string;
  reason?: string;
  error?: string;
}

/**
 * Recovery handler for a specific operation type
 * Each operation type (transfer, order, etc.) implements this
 */
export interface RecoveryHandler<TOperation extends RecoverableOperation> {
  /**
   * Find operation by ID
   */
  findOperation: (id: string, session?: ClientSession) => Promise<TOperation | null>;
  
  /**
   * Find related transactions for this operation
   */
  findRelatedTransactions: (id: string, session?: ClientSession) => Promise<unknown[]>;
  
  /**
   * Reverse the operation (create opposite operation)
   * Should create reverse operation + reverse transactions + update wallets
   */
  reverseOperation: (operation: TOperation, session: ClientSession) => Promise<{ operationId: string }>;
  
  /**
   * Delete the operation (if no transactions exist)
   */
  deleteOperation: (id: string, session: ClientSession) => Promise<void>;
  
  /**
   * Update operation status
   */
  updateStatus: (
    id: string,
    status: RecoverableOperation['status'],
    meta: Record<string, unknown>,
    session: ClientSession
  ) => Promise<void>;
  
  /**
   * Check if operation needs recovery
   * Returns true if operation is in inconsistent state
   */
  needsRecovery?: (operation: TOperation, transactions: unknown[]) => boolean;
  
  /**
   * Get operation type name (for logging)
   */
  getOperationType: () => string;
}

/**
 * Operation state for tracking (Redis)
 */
export interface OperationState {
  operationId: string;
  operationType: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'recovered';
  startedAt: Date;
  lastHeartbeat: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  currentStep?: string;
  steps: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Generic Operation State Tracker (Redis-based)
// ═══════════════════════════════════════════════════════════════════

/**
 * Generic operation state tracker using Redis
 * Tracks operation state for crash recovery
 */
export class OperationStateTracker {
  private redis = getRedis();
  private readonly KEY_PREFIX = 'operation_state:';
  private readonly IN_PROGRESS_TTL = 60; // 60 seconds
  private readonly COMPLETED_TTL = 300; // 5 minutes
  private readonly FAILED_TTL = 300; // 5 minutes

  /**
   * Set operation state
   */
  async setState(
    operationId: string,
    operationType: string,
    state: Partial<OperationState>
  ): Promise<void> {
    const key = `${this.KEY_PREFIX}${operationType}:${operationId}`;
    const fullState: OperationState = {
      operationId,
      operationType,
      status: state.status || 'pending',
      startedAt: state.startedAt || new Date(),
      lastHeartbeat: state.lastHeartbeat || new Date(),
      completedAt: state.completedAt,
      failedAt: state.failedAt,
      error: state.error,
      currentStep: state.currentStep,
      steps: state.steps || [],
    };

    if (!this.redis) {
      logger.warn('Redis not available, operation state tracking disabled');
      return;
    }

    const ttl = this.getTTLForStatus(fullState.status);
    // Serialize dates to ISO strings for JSON storage
    const serializedState = {
      ...fullState,
      startedAt: fullState.startedAt.toISOString(),
      lastHeartbeat: fullState.lastHeartbeat.toISOString(),
      completedAt: fullState.completedAt?.toISOString(),
      failedAt: fullState.failedAt?.toISOString(),
    };
    await this.redis.setEx(key, ttl, JSON.stringify(serializedState));
  }

  /**
   * Get operation state
   */
  async getState(operationId: string, operationType: string): Promise<OperationState | null> {
    if (!this.redis) {
      return null;
    }

    const key = `${this.KEY_PREFIX}${operationType}:${operationId}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    const parsed = JSON.parse(data) as any;
    // Deserialize dates from ISO strings
    return {
      ...parsed,
      startedAt: new Date(parsed.startedAt),
      lastHeartbeat: new Date(parsed.lastHeartbeat),
      completedAt: parsed.completedAt ? new Date(parsed.completedAt) : undefined,
      failedAt: parsed.failedAt ? new Date(parsed.failedAt) : undefined,
    } as OperationState;
  }

  /**
   * Update heartbeat
   */
  async updateHeartbeat(operationId: string, operationType: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    const state = await this.getState(operationId, operationType);
    if (!state) return;

    // Update heartbeat without full state update (more efficient)
    const key = `${this.KEY_PREFIX}${operationType}:${operationId}`;
    const data = await this.redis.get(key);
    if (!data) return;

    const parsed = JSON.parse(data) as any;
    parsed.lastHeartbeat = new Date().toISOString();
    
    // Get current TTL or use default
    const ttl = this.getTTLForStatus(parsed.status || 'in_progress');
    await this.redis.setEx(key, ttl, JSON.stringify(parsed));
  }

  /**
   * Mark as completed
   */
  async markCompleted(operationId: string, operationType: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    const state = await this.getState(operationId, operationType);
    if (!state) return;

    await this.setState(operationId, operationType, {
      ...state,
      status: 'completed',
      completedAt: new Date(),
      lastHeartbeat: new Date(),
    });
  }

  /**
   * Mark as failed
   */
  async markFailed(operationId: string, operationType: string, error: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    const state = await this.getState(operationId, operationType);
    if (!state) {
      // Create new state if doesn't exist
      await this.setState(operationId, operationType, {
        status: 'failed',
        failedAt: new Date(),
        error,
        startedAt: new Date(),
        lastHeartbeat: new Date(),
        steps: [],
      });
      return;
    }

    await this.setState(operationId, operationType, {
      ...state,
      status: 'failed',
      failedAt: new Date(),
      error,
      lastHeartbeat: new Date(),
    });
  }

  /**
   * Find stuck operations (no heartbeat in maxAgeSeconds)
   */
  async findStuckOperations(
    operationType: string,
    maxAgeSeconds: number = 30
  ): Promise<OperationState[]> {
    if (!this.redis) {
      return [];
    }

    const pattern = `${this.KEY_PREFIX}${operationType}:*`;
    // Use scanKeysArray for better performance (avoids blocking KEYS command)
    const keys = await scanKeysArray({ pattern, maxKeys: 1000 });
    const stuck: OperationState[] = [];
    const cutoffTime = new Date(Date.now() - maxAgeSeconds * 1000);

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (!data) continue;

      const state = JSON.parse(data) as OperationState;
      // Parse dates from JSON strings
      const lastHeartbeat = typeof state.lastHeartbeat === 'string' 
        ? new Date(state.lastHeartbeat) 
        : state.lastHeartbeat;
      
      if (
        (state.status === 'pending' || state.status === 'in_progress') &&
        lastHeartbeat < cutoffTime
      ) {
        stuck.push({
          ...state,
          lastHeartbeat,
          startedAt: typeof state.startedAt === 'string' ? new Date(state.startedAt) : state.startedAt,
        });
      }
    }

    return stuck;
  }

  /**
   * Delete state
   */
  async deleteState(operationId: string, operationType: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    const key = `${this.KEY_PREFIX}${operationType}:${operationId}`;
    await this.redis.del(key);
  }

  /**
   * Get TTL for status
   */
  private getTTLForStatus(status: OperationState['status']): number {
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
let stateTracker: OperationStateTracker | null = null;

/**
 * Get operation state tracker instance
 */
export function getOperationStateTracker(): OperationStateTracker {
  if (!stateTracker) {
    stateTracker = new OperationStateTracker();
  }
  return stateTracker;
}

// ═══════════════════════════════════════════════════════════════════
// Generic Recovery Helper
// ═══════════════════════════════════════════════════════════════════

/**
 * Recover a single operation
 * Generic function that works with any operation type via handler
 */
export async function recoverOperation<TOperation extends RecoverableOperation>(
  operationId: string,
  handler: RecoveryHandler<TOperation>,
  options?: {
    database?: Db;
    databaseStrategy?: DatabaseStrategyResolver;
    context?: DatabaseContext;
    session?: ClientSession;
  }
): Promise<RecoveryResult> {
  const session = options?.session;
  
  const executeRecovery = async (txSession: ClientSession): Promise<RecoveryResult> => {
    try {
      // 1. Find operation
      const operation = await handler.findOperation(operationId, txSession);
      
      if (!operation) {
        logger.warn(`Operation ${operationId} not found for recovery`, {
          operationType: handler.getOperationType(),
        });
        return { recovered: false, action: 'no_action_needed', reason: 'operation_not_found' };
      }

      // 2. Find related transactions
      const transactions = await handler.findRelatedTransactions(operationId, txSession);

      // 3. Check if recovery is needed (custom logic if provided)
      const needsRecovery = handler.needsRecovery
        ? handler.needsRecovery(operation, transactions)
        : checkNeedsRecovery(operation, transactions);

      if (!needsRecovery) {
        logger.debug(`Operation ${operationId} does not need recovery`, {
          operationType: handler.getOperationType(),
          status: operation.status,
        });
        return { recovered: false, action: 'no_action_needed', reason: 'operation_consistent' };
      }

      // 4. Determine recovery action based on status
      if (operation.status === 'approved' || operation.status === 'completed') {
        // Operation completed - reverse it
        logger.info(`Recovering completed operation ${operationId}`, {
          operationType: handler.getOperationType(),
          status: operation.status,
        });
        return await reverseOperation(operation, handler, txSession);
      } else if (operation.status === 'pending') {
        // Operation pending - check if transactions exist
        if (transactions.length > 0) {
          // Transactions exist but operation is pending - reverse them
          logger.info(`Recovering pending operation ${operationId} with transactions`, {
            operationType: handler.getOperationType(),
            transactionCount: transactions.length,
          });
          return await reverseOperation(operation, handler, txSession);
        } else {
          // No transactions - just delete the operation
          logger.info(`Deleting pending operation ${operationId} (no transactions)`, {
            operationType: handler.getOperationType(),
          });
          await handler.deleteOperation(operationId, txSession);
          return { recovered: true, action: 'deleted' };
        }
      } else if (operation.status === 'failed') {
        // Operation already failed - check if transactions need cleanup
        if (transactions.length > 0) {
          logger.info(`Recovering failed operation ${operationId} with transactions`, {
            operationType: handler.getOperationType(),
            transactionCount: transactions.length,
          });
          return await reverseOperation(operation, handler, txSession);
        }
        return { recovered: true, action: 'already_failed' };
      }

      return { recovered: false, action: 'no_action_needed', reason: 'unknown_status' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to recover operation ${operationId}`, {
        operationType: handler.getOperationType(),
        error: errorMsg,
      });
      return { recovered: false, action: 'no_action_needed', reason: 'error', error: errorMsg };
    }
  };

  // Use external session if provided, otherwise create new one
  if (session) {
    return await executeRecovery(session);
  }

  let client: MongoClient;
  
  if (options?.database) {
    client = options.database.client;
  } else if (options?.databaseStrategy && options?.context) {
    const db = await options.databaseStrategy.resolve(options.context);
    client = db.client;
  } else {
    throw new Error('recoverOperation requires either database or databaseStrategy with context when session is not provided');
  }
  
  const internalSession = client.startSession();

  try {
    const result = await internalSession.withTransaction(async () => {
      return await executeRecovery(internalSession);
    }, DEFAULT_TRANSACTION_OPTIONS);

    return result;
  } finally {
    await internalSession.endSession();
  }
}

/**
 * Check if operation needs recovery (default logic)
 */
function checkNeedsRecovery(
  operation: RecoverableOperation,
  transactions: unknown[]
): boolean {
  // Default logic: operation needs recovery if:
  // 1. Status is 'pending' but transactions exist
  // 2. Status is 'approved'/'completed' but should be reversed
  // 3. Status is 'failed' but transactions exist

  if (operation.status === 'pending' && transactions.length > 0) {
    return true;
  }

  if (operation.status === 'failed' && transactions.length > 0) {
    return true;
  }

  // For approved/completed, we assume they need recovery if called
  // (caller should check business logic)
  if ((operation.status === 'approved' || operation.status === 'completed')) {
    return true;
  }

  return false;
}

/**
 * Reverse an operation
 */
async function reverseOperation<TOperation extends RecoverableOperation>(
  operation: TOperation,
  handler: RecoveryHandler<TOperation>,
  session: ClientSession
): Promise<RecoveryResult> {
  try {
    // Create reverse operation
    const reverseResult = await handler.reverseOperation(operation, session);

    // Mark original operation as recovered
    await handler.updateStatus(
      operation.id,
      'recovered',
      {
        recoveryOperationId: reverseResult.operationId,
        recoveredAt: new Date(),
      },
      session
    );

    // Update state tracker
    const stateTracker = getOperationStateTracker();
    await stateTracker.markCompleted(operation.id, handler.getOperationType());

    logger.info(`Reversed operation ${operation.id}`, {
      operationType: handler.getOperationType(),
      reverseOperationId: reverseResult.operationId,
    });

    return {
      recovered: true,
      action: 'reversed',
      reverseOperationId: reverseResult.operationId,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to reverse operation ${operation.id}`, {
      operationType: handler.getOperationType(),
      error: errorMsg,
    });
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Recovery Job System
// ═══════════════════════════════════════════════════════════════════

/**
 * Recovery handler registry
 */
const recoveryHandlers = new Map<string, RecoveryHandler<RecoverableOperation>>();

/**
 * Register a recovery handler for an operation type
 */
export function registerRecoveryHandler<TOperation extends RecoverableOperation>(
  operationType: string,
  handler: RecoveryHandler<TOperation>
): void {
  // Type assertion needed because handler is generic but registry stores base type
  recoveryHandlers.set(operationType, handler as unknown as RecoveryHandler<RecoverableOperation>);
  logger.info(`Registered recovery handler for operation type: ${operationType}`);
}

/**
 * Get recovery handler for operation type
 */
export function getRecoveryHandler(operationType: string): RecoveryHandler<RecoverableOperation> | undefined {
  return recoveryHandlers.get(operationType);
}

/**
 * Recover stuck operations for a specific operation type
 */
export async function recoverStuckOperations(
  operationType: string,
  maxAgeSeconds: number = 60
): Promise<number> {
  const handler = recoveryHandlers.get(operationType);
  if (!handler) {
    logger.warn(`No recovery handler registered for operation type: ${operationType}`);
    return 0;
  }

  const stateTracker = getOperationStateTracker();
  const stuckStates = await stateTracker.findStuckOperations(operationType, maxAgeSeconds);

  if (stuckStates.length === 0) {
    return 0;
  }

  logger.info(`Found ${stuckStates.length} stuck ${operationType} operations`, {
    operationType,
    maxAgeSeconds,
  });

  let recoveredCount = 0;

  for (const state of stuckStates) {
    try {
      const result = await recoverOperation(state.operationId, handler);
      if (result.recovered) {
        recoveredCount++;
        logger.info(`Recovered stuck ${operationType} operation`, {
          operationType,
          operationId: state.operationId,
          action: result.action,
        });
      }
    } catch (error) {
      logger.error(`Failed to recover ${operationType} operation`, {
        operationType,
        operationId: state.operationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return recoveredCount;
}

/**
 * Recover stuck operations for all registered operation types
 */
export async function recoverAllStuckOperations(maxAgeSeconds: number = 60): Promise<{
  [operationType: string]: number;
}> {
  const results: { [operationType: string]: number } = {};

  for (const operationType of recoveryHandlers.keys()) {
    const count = await recoverStuckOperations(operationType, maxAgeSeconds);
    if (count > 0) {
      results[operationType] = count;
    }
  }

  return results;
}

/**
 * Recovery job that runs periodically
 */
export class RecoveryJob {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start recovery job
   */
  start(intervalMs: number = 5 * 60 * 1000, maxAgeSeconds: number = 60): void {
    if (this.isRunning) {
      logger.warn('Recovery job already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting recovery job', { intervalMs, maxAgeSeconds });

    // Run immediately
    this.runRecovery(maxAgeSeconds);

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runRecovery(maxAgeSeconds);
    }, intervalMs);
  }

  /**
   * Stop recovery job
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('Stopped recovery job');
  }

  /**
   * Run recovery for all operation types
   */
  private async runRecovery(maxAgeSeconds: number): Promise<void> {
    try {
      const results = await recoverAllStuckOperations(maxAgeSeconds);
      const totalRecovered = Object.values(results).reduce((sum, count) => sum + count, 0);

      if (totalRecovered > 0) {
        logger.info(`Recovery job: Recovered ${totalRecovered} stuck operations`, results);
      }
    } catch (error) {
      logger.error('Recovery job failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Singleton instance
let recoveryJob: RecoveryJob | null = null;

/**
 * Get recovery job instance
 */
export function getRecoveryJob(): RecoveryJob {
  if (!recoveryJob) {
    recoveryJob = new RecoveryJob();
  }
  return recoveryJob;
}
