/**
 * Bonus service accessors (db + redis) from one factory call.
 * Per-service database: bonus_service.
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('bonus-service');
