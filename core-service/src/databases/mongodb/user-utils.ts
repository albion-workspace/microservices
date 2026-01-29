/**
 * User Utilities
 * 
 * Generic utilities for querying users across services.
 * Supports role-based user lookup for flexible system user management.
 */

import type { MongoClient, Db, Document } from 'mongodb';
import { logger } from '../../common/logger.js';
import { getErrorMessage } from '../../common/errors.js';
import { CORE_DATABASE_NAME } from './constants.js';
import type { DatabaseStrategyResolver, DatabaseContext } from './strategy.js';

export interface FindUserByRoleOptions {
  role: string;
  tenantId?: string;
  database?: string;
  throwIfNotFound?: boolean;
  client?: MongoClient;
  databaseInstance?: Db;
  databaseStrategy?: DatabaseStrategyResolver;
  context?: DatabaseContext;
}

interface InternalFindOptions extends FindUserByRoleOptions {
  findOne: boolean;
}

async function findUsersByRoleInternal(options: InternalFindOptions): Promise<string[]> {
  const { role, tenantId, database = CORE_DATABASE_NAME, throwIfNotFound = true, findOne } = options;

  try {
    const client = resolveMongoClient(options);
    const authDb = client.db(database);
    const usersCollection = authDb.collection('users');

    const query = buildRoleQuery(role, tenantId);
    logger.debug(`Finding user${findOne ? '' : 's'} by role`, { role, tenantId, database });

    const users = findOne
      ? await usersCollection.findOne(query).then(user => user ? [user] : [])
      : await usersCollection.find(query).toArray();

    const userIds = users.map(user => extractUserId(user)).filter((id): id is string => Boolean(id));

    if (userIds.length === 0) {
      const errorMsg = `No user found with role "${role}"${tenantId ? ` for tenant "${tenantId}"` : ''}`;
      if (throwIfNotFound && findOne) {
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      logger.warn(errorMsg);
    }

    return userIds;
  } catch (error) {
    logger.error(`Error finding user${findOne ? '' : 's'} by role`, { role, tenantId, error: getErrorMessage(error) });
    throw error;
  }
}

function resolveMongoClient(options: FindUserByRoleOptions): MongoClient {
  if (options.client) return options.client;
  if (options.databaseStrategy && options.context) {
    throw new Error('findUserIdByRole requires client option when using databaseStrategy');
  }
  throw new Error('findUserIdByRole requires either client or databaseStrategy with context');
}

function buildRoleQuery(role: string, tenantId?: string): Record<string, unknown> {
  const query: Record<string, unknown> = {
    $or: [
      { roles: { $elemMatch: { role, active: { $ne: false } } } },
      { roles: role },
    ],
  };
  if (tenantId) query.tenantId = tenantId;
  return query;
}

function extractUserId(user: Document): string | null {
  return user._id?.toString() || user.id || null;
}

export async function findUserIdByRole(options: FindUserByRoleOptions): Promise<string> {
  const results = await findUsersByRoleInternal({ ...options, findOne: true });
  return results[0] || '';
}

export async function findUserIdsByRole(options: FindUserByRoleOptions): Promise<string[]> {
  return findUsersByRoleInternal({ ...options, findOne: false, throwIfNotFound: false });
}
