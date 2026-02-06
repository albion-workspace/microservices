/**
 * Auth service accessors (db + redis) from one factory call.
 * Uses core_service database.
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('auth-service', {
  databaseServiceName: 'core-service',
});
