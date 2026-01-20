/**
 * Saga Service - Returns resolvers (no HTTP server)
 * Used by gateway directly = ZERO network overhead
 */

import { randomUUID } from 'node:crypto';
import type { ServiceConfig, SagaContext, SagaOptions } from './types.js';
import type { Repository, Resolvers, ResolverContext } from '../types/index.js';
import { createRepository, generateId } from '../common/repository.js';
import { publish } from '../common/redis.js';
import { executeSaga } from './engine.js';
import { logger } from '../common/logger.js';

export function createService<TEntity extends { id: string }, TInput>(
  config: ServiceConfig<TEntity, TInput>
): { resolvers: Resolvers; repository: Repository<TEntity>; types: string } {
  
  const repository = createRepository<TEntity>(config.entity.collection, { indexes: config.entity.indexes });
  const Entity = capitalize(config.entity.name);
  const entities = config.entity.name + 's';

  // Inject dependencies into saga
  const sagaWithDeps = config.saga.map(step => ({
    ...step,
    execute: async (ctx: SagaContext<TEntity, TInput>) => {
      ctx.data._repository = repository;
      ctx.data._generateId = generateId;
      ctx.data._publish = publish;
      return step.execute(ctx);
    },
  }));

  // Saga execution options (transactional for financial operations)
  const sagaOptions = config.sagaOptions || {};

  // Build GraphQL type definitions from entity config
  const graphqlTypes = (config.entity.graphqlType || '').trim();
  const graphqlInput = (config.entity.graphqlInput || '').trim();
  
  // Extract the main entity type from graphqlType (skip Create*Result types)
  // Look for types that are NOT Create*Result (e.g., "type Transaction { ... }" -> "Transaction")
  const allTypeMatches = Array.from(graphqlTypes.matchAll(/type\s+(\w+)\s*\{/g));
  let entityTypeName = Entity; // Fallback to capitalized entity name
  for (const match of allTypeMatches) {
    const typeName = match[1];
    // Skip result types and connection types - we want the main entity type
    if (!typeName.startsWith('Create') && !typeName.endsWith('Result') && !typeName.endsWith('Connection')) {
      entityTypeName = typeName;
      break; // Use the first non-result, non-connection type
    }
  }
  
  // Special case: if entity name is 'withdrawal' or 'deposit' and no entity type found,
  // they both use 'Transaction' as the shared entity type
  if (entityTypeName === Entity && (config.entity.name === 'withdrawal' || config.entity.name === 'deposit')) {
    entityTypeName = 'Transaction';
  }
  
  // Extract input type name from graphqlInput (e.g., "input CreateWalletInput { ... }" -> "CreateWalletInput")
  const inputTypeMatch = graphqlInput.match(/input\s+(\w+)/);
  const inputTypeName = inputTypeMatch ? inputTypeMatch[1] : `Create${Entity}Input`;
  
  // Extract result type from graphqlTypes (e.g., "type CreateDepositResult { ... }" -> "CreateDepositResult")
  const resultTypeMatch = graphqlTypes.match(/type\s+(Create\w+Result)\s*\{/);
  const resultTypeName = resultTypeMatch ? resultTypeMatch[1] : `Create${Entity}Result`;
  
  // Extract connection type (e.g., "type TransactionConnection { ... }" -> "TransactionConnection")
  const connectionTypeMatch = graphqlTypes.match(/type\s+(\w+Connection)\s*\{/);
  // If no connection type found but entity type is Transaction, use TransactionConnection
  // (shared between deposit and withdrawal services)
  const connectionTypeName = connectionTypeMatch 
    ? connectionTypeMatch[1] 
    : (entityTypeName === 'Transaction' ? 'TransactionConnection' : `${entityTypeName}Connection`);
  
  // Generate Query and Mutation extensions
  // Always include plural query - connection type will be resolved from other services if needed
  const pluralQuery = `      ${entities}(first: Int, skip: Int, filter: JSON): ${connectionTypeName}`;
  
  const queryType = `
    extend type Query {
      ${config.entity.name}(id: ID!): ${entityTypeName}${pluralQuery ? '\n' + pluralQuery : ''}
    }
  `;
  
  const mutationType = `
    extend type Mutation {
      create${Entity}(input: ${inputTypeName}!): ${resultTypeName}
      update${Entity}(id: ID!, input: JSON!): ${entityTypeName}
      delete${Entity}(id: ID!): BasicResponse!
    }
  `;

  const types = [graphqlTypes, graphqlInput, queryType, mutationType]
    .filter(Boolean)
    .join('\n');

  const resolvers: Resolvers = {
    Query: {
      [config.entity.name]: async (args) => repository.findById(args.id as string),
      
      [entities]: async (args) => {
        const { first = 20, skip = 0, filter } = args as { first?: number; skip?: number; filter?: Record<string, unknown> };
        // Sort by createdAt descending by default (newest first)
        const result = await repository.findMany({ 
          filter: filter ?? {}, 
          skip, 
          take: first,
          sort: { createdAt: -1 } // Sort by createdAt descending
        });
        return {
          nodes: result.items,
          totalCount: result.total,
          pageInfo: { hasNextPage: skip + first < result.total, hasPreviousPage: skip > 0 },
        };
      },
    },

    Mutation: {
      [`create${Entity}`]: async (args, ctx) => {
        const start = Date.now();
        const sagaId = randomUUID();
        const input = (args as { input: unknown }).input;

        const validated = config.entity.validateInput(input);
        if (validated && typeof validated === 'object' && 'errors' in validated) {
          return { success: false, sagaId, errors: (validated as { errors: string[] }).errors, executionTimeMs: Date.now() - start };
        }

        logger.info(`Creating ${config.entity.name}`, { 
          sagaId, 
          userId: ctx.user?.userId,
          transactional: sagaOptions.useTransaction 
        });

        const result = await executeSaga(sagaWithDeps, validated as TInput, sagaId, {
          useTransaction: sagaOptions.useTransaction,
          maxRetries: sagaOptions.maxRetries,
        });
        
        return {
          success: result.success,
          [config.entity.name]: result.context.entity,
          sagaId,
          errors: result.error ? [result.error] : null,
          executionTimeMs: Date.now() - start,
        };
      },

      [`update${Entity}`]: async (args) => {
        const { id, input } = args as { id: string; input: Partial<TEntity> };
        return repository.update(id, input);
      },

      [`delete${Entity}`]: async (args) => {
        const deleted = await repository.delete((args as { id: string }).id);
        return { success: deleted, message: deleted ? `${Entity} deleted` : `${Entity} not found` };
      },
    },
  };

  return { resolvers, repository, types };
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export { generateId };

