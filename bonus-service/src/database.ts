/**
 * Bonus Service Database Access
 * 
 * Uses createServiceDatabaseAccess from core-service for consistent database access.
 * Bonus-service uses per-service strategy (bonus_service database).
 */

import { createServiceDatabaseAccess } from 'core-service';

// Create database accessor for bonus-service
export const db = createServiceDatabaseAccess('bonus-service');
