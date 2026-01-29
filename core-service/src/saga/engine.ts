/**
 * Saga Execution Engine
 * 
 * Supports two rollback strategies:
 * 1. Compensation-based: Each step has a compensate function (default)
 * 2. MongoDB Transactions: Atomic multi-document operations (for financial data)
 */

import type { ClientSession, MongoClient } from 'mongodb';
import { logger } from '../common/logger.js';
import { getErrorMessage } from '../common/errors.js';
import type { SagaStep, SagaContext, SagaResult, SagaOptions } from './types.js';
import type { DatabaseStrategyResolver, DatabaseContext } from '../databases/strategy.js';
import { DEFAULT_TRANSACTION_OPTIONS } from '../common/wallet-types.js';

export interface ExecuteSagaOptions {
  /** Use MongoDB transaction for atomic rollback (recommended for financial operations) */
  useTransaction?: boolean;
  /** Max commit retries on transient errors */
  maxRetries?: number;
  /** MongoDB client for transaction support */
  client?: MongoClient;
  /** Database strategy resolver */
  databaseStrategy?: DatabaseStrategyResolver;
  /** Database context for strategy resolution */
  context?: DatabaseContext;
}

export async function executeSaga<TEntity, TInput>(
  steps: SagaStep<TEntity, TInput>[],
  input: TInput,
  sagaId: string,
  options: ExecuteSagaOptions = {}
): Promise<SagaResult<TEntity, TInput>> {
  const { useTransaction = false, maxRetries = 3 } = options;
  
  if (useTransaction) {
    return executeSagaWithTransaction(steps, input, sagaId, maxRetries, options);
  }
  
  return executeSagaWithCompensation(steps, input, sagaId);
}

/**
 * Execute saga with MongoDB transaction - atomic rollback on failure
 * Use for financial/monetary operations where data consistency is critical
 */
async function executeSagaWithTransaction<TEntity, TInput>(
  steps: SagaStep<TEntity, TInput>[],
  input: TInput,
  sagaId: string,
  maxRetries: number,
  options: ExecuteSagaOptions
): Promise<SagaResult<TEntity, TInput>> {
  const completedSteps: string[] = [];
  let context: SagaContext<TEntity, TInput> = { sagaId, input, data: {} };
  
  // Resolve MongoDB client
  let client: MongoClient;
  if (options.client) {
    client = options.client;
  } else if (options.databaseStrategy && options.context) {
    // Get client from database strategy
    const db = await options.databaseStrategy.resolve(options.context);
    client = db.client;
  } else {
    throw new Error('Saga with transaction requires either client or databaseStrategy with context');
  }
  
  const session = client.startSession();
  
  // Inject session into context for repository operations
  context.data._session = session;
  
  logger.info(`Saga ${sagaId} starting with transaction`, { steps: steps.length });
  
  try {
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        await session.withTransaction(async () => {
          // Execute all steps within transaction
          for (const step of steps) {
            logger.debug(`Saga ${sagaId} executing: ${step.name} (tx)`);
            context = await step.execute(context);
            completedSteps.push(step.name);
          }
        }, DEFAULT_TRANSACTION_OPTIONS);
        
        // Transaction committed successfully - no logging needed (expected behavior)
        return { success: true, context, completedSteps };
        
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        
        // Check for transient errors (can retry)
        if (isTransientError(error) && retries < maxRetries - 1) {
          retries++;
          
          // Exponential backoff: 100ms, 200ms, 400ms (max 1s)
          const backoffMs = Math.min(100 * Math.pow(2, retries - 1), 1000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          
          logger.warn(`Saga ${sagaId} transient error, retrying (${retries}/${maxRetries})`, { 
            error: errorMsg,
            backoffMs 
          });
          completedSteps.length = 0; // Reset completed steps for retry
          context = { sagaId, input, data: { _session: session } };
          continue;
        }
        
        // Non-transient error or max retries reached
        logger.error(`Saga ${sagaId} transaction aborted`, { error: errorMsg, retries });
        return { success: false, context: { ...context, error: errorMsg }, error: errorMsg, completedSteps };
      }
    }
    
    // Should not reach here, but safety return
    return { success: false, context, error: 'Max retries exceeded', completedSteps };
    
  } finally {
    await session.endSession();
  }
}

/**
 * Execute saga with compensation - runs compensate functions on failure
 * Default mode, suitable for most operations
 */
async function executeSagaWithCompensation<TEntity, TInput>(
  steps: SagaStep<TEntity, TInput>[],
  input: TInput,
  sagaId: string
): Promise<SagaResult<TEntity, TInput>> {
  const completedSteps: string[] = [];
  let context: SagaContext<TEntity, TInput> = { sagaId, input, data: {} };

  logger.info(`Saga ${sagaId} starting`, { steps: steps.length });

  try {
    for (const step of steps) {
      logger.debug(`Saga ${sagaId} executing: ${step.name}`);
      
      try {
        context = await step.execute(context);
        completedSteps.push(step.name);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`Saga ${sagaId} failed at ${step.name}`, { error: errorMsg });
        
        if (step.critical !== false) {
          context.error = errorMsg;
          await runCompensation(steps, completedSteps, context, sagaId);
          return { success: false, context, error: errorMsg, completedSteps };
        }
      }
    }

    logger.info(`Saga ${sagaId} completed`);
    return { success: true, context, completedSteps };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    return { success: false, context: { ...context, error: errorMsg }, error: errorMsg, completedSteps };
  }
}

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('transient') || 
         msg.includes('writeconflict') || 
         msg.includes('network') ||
         msg.includes('socket') ||
         msg.includes('timeout');
}

async function runCompensation<TEntity, TInput>(
  steps: SagaStep<TEntity, TInput>[],
  completedSteps: string[],
  context: SagaContext<TEntity, TInput>,
  sagaId: string
): Promise<void> {
  logger.warn(`Saga ${sagaId} compensating ${completedSteps.length} steps`);

  for (const stepName of [...completedSteps].reverse()) {
    const step = steps.find(s => s.name === stepName);
    if (step?.compensate) {
      try {
        await step.compensate(context);
      } catch (error) {
        logger.error(`Saga ${sagaId} compensation failed: ${stepName}`, { error });
      }
    }
  }
}
