/**
 * Auth service accessors (db + redis) from a single factory call.
 * Uses core-service DB for users/sessions/configs.
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('auth-service', {
  databaseServiceName: 'core-service',
});
