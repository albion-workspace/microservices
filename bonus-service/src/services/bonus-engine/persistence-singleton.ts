/**
 * Persistence Singleton
 * 
 * Provides a centralized way to get the initialized persistence layer.
 * Avoids circular dependencies by separating the singleton from index.ts.
 */

import { logger, resolveContext, initializeServiceDatabase, type DatabaseStrategyResolver, type DatabaseContext } from 'core-service';
import { createBonusPersistence, type BonusPersistenceOptions } from './persistence.js';

// Database strategy and context (initialized via initializeServiceDatabase)
let databaseStrategy: DatabaseStrategyResolver | undefined;
let defaultContext: DatabaseContext | undefined;
let bonusPersistence: ReturnType<typeof createBonusPersistence> | undefined;

/**
 * Initialize database strategy using centralized helper.
 * This is the single entry point for all database-related initialization.
 */
export async function initializeDatabaseLayer(): Promise<{
  strategy: DatabaseStrategyResolver;
  context: DatabaseContext;
}> {
  if (databaseStrategy && defaultContext) {
    return { strategy: databaseStrategy, context: defaultContext };
  }
  
  // Use centralized initializeServiceDatabase from core-service
  const context = await resolveContext();
  const result = await initializeServiceDatabase({
    serviceName: 'bonus-service',
    brand: context.brand,
    tenantId: context.tenantId,
  });
  
  databaseStrategy = result.strategy;
  defaultContext = result.context;
  
  logger.info('Database layer initialized via initializeServiceDatabase (persistence-singleton)', { 
    database: result.database.databaseName,
    context: defaultContext,
  });
  
  return { strategy: databaseStrategy, context: defaultContext };
}

/**
 * Get the initialized persistence layer.
 * This is the recommended way to access persistence in sagas and resolvers.
 */
export async function getInitializedPersistence(): Promise<ReturnType<typeof createBonusPersistence>> {
  if (!bonusPersistence) {
    const { strategy, context } = await initializeDatabaseLayer();
    const options: BonusPersistenceOptions = {
      databaseStrategy: strategy,
      defaultContext: context,
    };
    bonusPersistence = createBonusPersistence(options);
    logger.info('Bonus persistence initialized with database strategy (persistence-singleton)');
  }
  return bonusPersistence;
}

/**
 * Get the database strategy (for handler registry initialization)
 */
export function getDatabaseStrategy(): DatabaseStrategyResolver | undefined {
  return databaseStrategy;
}

/**
 * Get the default context (for handler registry initialization)
 */
export function getDefaultContext(): DatabaseContext | undefined {
  return defaultContext;
}
