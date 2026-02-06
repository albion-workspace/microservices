/**
 * Payment service accessors (db + redis) from a single factory call.
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('payment-service');
