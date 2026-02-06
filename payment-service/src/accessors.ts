/**
 * Payment service accessors (db + redis) from one factory call.
 * Per-service database: payment_service.
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('payment-service');
