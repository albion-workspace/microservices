/**
 * Service accessors factory – single call for db + redis
 *
 * Use in each service to get { db, redis } without repeating boilerplate.
 * Auth-service should pass { databaseServiceName: 'core-service' } to use the shared DB.
 */

import { createServiceDatabaseAccess } from './mongodb/service-accessor.js';
import type { ServiceDatabaseAccessor } from './mongodb/service-accessor.js';
import { createServiceRedisAccess } from './redis/service-accessor.js';
import type { ServiceRedisAccessor } from './redis/service-accessor.js';

export interface CreateServiceAccessorsOptions {
  /** Database service name (default: serviceName). Use 'core-service' for auth to use shared DB. */
  databaseServiceName?: string;
}

export interface ServiceAccessors {
  db: ServiceDatabaseAccessor;
  redis: ServiceRedisAccessor;
}

/**
 * Create database and Redis accessors for a service in one call.
 *
 * @param serviceName - Service identifier (e.g. 'payment-service', 'auth-service')
 * @param options - Optional; use databaseServiceName: 'core-service' for auth-service
 */
export function createServiceAccessors(
  serviceName: string,
  options?: CreateServiceAccessorsOptions
): ServiceAccessors {
  const dbServiceName = options?.databaseServiceName ?? serviceName;
  return {
    db: createServiceDatabaseAccess(dbServiceName),
    redis: createServiceRedisAccess(serviceName),
  };
}
