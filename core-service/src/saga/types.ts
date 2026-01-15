/**
 * Saga Types
 */

import type { ClientSession } from 'mongodb';
import type { Repository, IndexConfig } from '../types/index.js';

export interface SagaContext<TEntity, TInput> {
  sagaId: string;
  input: TInput;
  entity?: TEntity;
  data: Record<string, unknown> & {
    /** MongoDB session for transactional sagas */
    _session?: ClientSession;
  };
  error?: string;
}

export interface SagaStep<TEntity, TInput> {
  name: string;
  /** If true (default), saga will rollback on step failure */
  critical?: boolean;
  execute: (ctx: SagaContext<TEntity, TInput>) => Promise<SagaContext<TEntity, TInput>>;
  /** Compensation function for non-transactional sagas */
  compensate?: (ctx: SagaContext<TEntity, TInput>) => Promise<void>;
}

export interface SagaResult<TEntity, TInput> {
  success: boolean;
  context: SagaContext<TEntity, TInput>;
  error?: string;
  completedSteps: string[];
}

/** Options for saga execution behavior */
export interface SagaOptions {
  /** 
   * Use MongoDB transaction for atomic rollback
   * Recommended for financial/monetary operations
   * Requires MongoDB replica set
   */
  useTransaction?: boolean;
  /** Max commit retries on transient errors (default: 3) */
  maxRetries?: number;
}

export interface EntityConfig<TEntity, TInput> {
  name: string;
  collection: string;
  graphqlType: string;
  graphqlInput: string;
  validateInput: (input: unknown) => TInput | { errors: string[] };
  indexes?: IndexConfig[];
}

export interface ServiceConfig<TEntity extends { id: string }, TInput> {
  name: string;
  entity: EntityConfig<TEntity, TInput>;
  saga: SagaStep<TEntity, TInput>[];
  /** Options for saga execution */
  sagaOptions?: SagaOptions;
}
