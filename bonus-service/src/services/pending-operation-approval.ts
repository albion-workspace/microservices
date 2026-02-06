/**
 * Generic Pending Operation Approval Service
 * 
 * Provides a reusable framework for handling approval/rejection workflows
 * for any type of pending operation (bonuses, payments, withdrawals, etc.).
 * 
 * Usage:
 * ```typescript
 * const approvalService = createPendingOperationApprovalService({
 *   operationType: 'bonus',
 *   redisKeyPrefix: 'pending:bonus:',
 *   defaultExpiration: '24h',
 * });
 * 
 * // Register approval handler
 * approvalService.registerApprovalHandler(async (data, context) => {
 *   // Custom approval logic
 *   return { success: true, resultId: '...' };
 * });
 * ```
 */

import { createPendingOperationStore, scanKeysIterator } from 'core-service';
import { logger, requireAuth } from 'core-service';
import type { ResolverContext } from 'core-service';
import { redis } from '../accessors.js';

export interface PendingOperationData extends Record<string, unknown> {
  requestedAt: number;
  requestedBy?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ApprovalContext {
  approvedBy: string;
  approvedByUserId: string;
  reason?: string;
}

export interface RejectionContext {
  rejectedBy: string;
  rejectedByUserId: string;
  reason?: string;
}

export interface ApprovalResult {
  success: boolean;
  resultId?: string;
  error?: string;
}

export type ApprovalHandler<T extends PendingOperationData = PendingOperationData> = (
  data: T,
  context: ApprovalContext
) => Promise<ApprovalResult>;

export interface PendingOperationApprovalConfig {
  operationType: string;
  redisKeyPrefix: string;
  defaultExpiration?: string;
}

export interface PendingOperationListItem<T extends PendingOperationData = PendingOperationData> {
  token: string;
  data: T;
  expiresAt: number;
}

/**
 * Create a generic pending operation approval service
 */
export function createPendingOperationApprovalService<T extends PendingOperationData = PendingOperationData>(
  config: PendingOperationApprovalConfig
) {
  const {
    operationType,
    redisKeyPrefix,
    defaultExpiration = '24h',
  } = config;

  const store = createPendingOperationStore({
    backend: 'redis',
    defaultExpiration,
    redisKeyPrefix,
  });

  let approvalHandler: ApprovalHandler<T> | null = null;

  /**
   * Register approval handler
   */
  function registerApprovalHandler(handler: ApprovalHandler<T>): void {
    approvalHandler = handler;
  }

  /**
   * Create pending operation approval request
   */
  async function createPendingOperation(
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const token = await store.create('approval', data, {
      operationType: 'approval',
      expiresIn: defaultExpiration,
      metadata: metadata || {},
    });

    logger.info('Pending operation approval created', {
      operationType,
      token,
      metadata: {
        ...metadata,
        requestedAt: data.requestedAt,
        requestedBy: data.requestedBy,
      },
    });

    return token;
  }

  /**
   * Approve pending operation
   */
  async function approvePendingOperation(
    token: string,
    context: ApprovalContext
  ): Promise<ApprovalResult> {
    const verified = await store.verify<T>(token, 'approval');
    
    if (!verified) {
      return { success: false, error: 'Invalid or expired approval token' };
    }

    if (!approvalHandler) {
      logger.error('No approval handler registered', { operationType, token });
      return { success: false, error: 'Approval handler not registered' };
    }

    try {
      const result = await approvalHandler(verified.data, context);
      
      if (result.success) {
        await store.delete(token, 'approval');
        
        logger.info('Pending operation approved', {
          operationType,
          token,
          resultId: result.resultId,
          approvedBy: context.approvedBy,
          approvedByUserId: context.approvedByUserId,
        });
      }

      return result;
    } catch (error: any) {
      logger.error('Failed to approve pending operation', {
        operationType,
        token,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject pending operation
   */
  async function rejectPendingOperation(
    token: string,
    context: RejectionContext
  ): Promise<{ success: boolean; error?: string }> {
    const verified = await store.verify<T>(token, 'approval');
    
    if (!verified) {
      return { success: false, error: 'Invalid or expired approval token' };
    }

    await store.delete(token, 'approval');
    
    logger.info('Pending operation rejected', {
      operationType,
      token,
      rejectedBy: context.rejectedBy,
      rejectedByUserId: context.rejectedByUserId,
      reason: context.reason,
    });

    return { success: true };
  }

  /**
   * List all pending operations
   */
  async function listPendingOperations(
    filter?: Record<string, unknown>
  ): Promise<Array<PendingOperationListItem<T>>> {
    if (!redis.isInitialized()) {
      logger.warn('Redis not available for listing pending operations', { operationType });
      return [];
    }

    const client = redis.getClient();
    const pattern = `${redisKeyPrefix}approval:*`;
    const results: Array<PendingOperationListItem<T>> = [];

    for await (const key of scanKeysIterator({ pattern, maxKeys: 10000 })) {
      const value = await client.get(key);
      if (!value) continue;

      try {
        const payload = JSON.parse(value);
        const token = key.split(':').pop() || '';
        const ttl = await client.ttl(key);
        const expiresAt = Date.now() + (ttl > 0 ? ttl * 1000 : 0);

        const data = payload.data as T;
        
        // Apply filters
        if (filter) {
          let matches = true;
          for (const [key, value] of Object.entries(filter)) {
            if (data[key] !== value) {
              matches = false;
              break;
            }
          }
          if (!matches) continue;
        }

        results.push({
          token,
          data,
          expiresAt,
        });
      } catch (error) {
        logger.warn('Failed to parse pending operation data', { operationType, key, error });
      }
    }

    return results;
  }

  /**
   * Get pending operation by token
   */
  async function getPendingOperation(
    token: string
  ): Promise<T | null> {
    const verified = await store.verify<T>(token, 'approval');
    return verified?.data || null;
  }

  /**
   * Get raw pending operation data including metadata, TTL, and full payload
   * Useful for debugging and admin inspection
   */
  async function getPendingOperationRawData(
    token: string
  ): Promise<{
    token: string;
    data: T;
    metadata?: Record<string, unknown>;
    expiresAt: number;
    ttlSeconds: number;
    createdAt?: number;
  } | null> {
    if (!redis.isInitialized()) {
      logger.warn('Redis not available for getting raw operation data', { operationType });
      return null;
    }

    const client = redis.getClient();
    const key = `${redisKeyPrefix}approval:${token}`;
    const value = await client.get(key);
    
    if (!value) {
      return null;
    }

    try {
      const payload = JSON.parse(value);
      const ttl = await client.ttl(key);
      const expiresAt = Date.now() + (ttl > 0 ? ttl * 1000 : 0);

      return {
        token,
        data: payload.data as T,
        metadata: payload.metadata,
        expiresAt,
        ttlSeconds: ttl,
        createdAt: payload.createdAt,
      };
    } catch (error) {
      logger.warn('Failed to parse raw pending operation data', { operationType, token, error });
      return null;
    }
  }

  return {
    registerApprovalHandler,
    createPendingOperation,
    approvePendingOperation,
    rejectPendingOperation,
    listPendingOperations,
    getPendingOperation,
    getPendingOperationRawData,
  };
}
