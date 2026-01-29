/**
 * Notification Service Database Access
 * 
 * Uses createServiceDatabaseAccess from core-service for consistent database access.
 * Notification-service uses per-service strategy (notification_service database).
 */

import { createServiceDatabaseAccess } from 'core-service';

// Create database accessor for notification-service
export const db = createServiceDatabaseAccess('notification-service');
