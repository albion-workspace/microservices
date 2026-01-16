/**
 * Saga Execution Engine
 * 
 * Supports two rollback strategies:
 * 1. Compensation-based: Each step has a compensate function (default)
 * 2. MongoDB Transactions: Atomic multi-document operations (for financial data)
 */

import type { ClientSession } from 'mongodb';
import { logger } from '../common/logger.js';
import { getClient } from '../common/database.js';
import { getErrorMessage } from '../common/errors.js';
import type { SagaStep, SagaContext, SagaResult, SagaOptions } from './types.js';

export interface ExecuteSagaOptions {
  /** Use MongoDB transaction for atomic rollback (recommended for financial operations) */
  useTransaction?: boolean;
  /** Max commit retries on transient errors */
  maxRetries?: number;
}

export async function executeSaga<TEntity, TInput>(
  steps: SagaStep<TEntity, TInput>[],
  input: TInput,
  sagaId: string,
  options: ExecuteSagaOptions = {}
): Promise<SagaResult<TEntity, TInput>> {
  const { useTransaction = false, maxRetries = 3 } = options;
  
  if (useTransaction) {
    return executeSagaWithTransaction(steps, input, sagaId, maxRetries);
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
  maxRetries: number
): Promise<SagaResult<TEntity, TInput>> {
  const completedSteps: string[] = [];
  let context: SagaContext<TEntity, TInput> = { sagaId, input, data: {} };
  
  const client = getClient();
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
        }, {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        });
        
        // Transaction committed successfully
        logger.info(`Saga ${sagaId} committed`, { steps: completedSteps.length });
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
