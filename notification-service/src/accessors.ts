/**
 * Notification service accessors (db + redis) from one factory call.
 * Per-service database: notification_service.
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('notification-service');
