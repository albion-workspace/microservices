/**
 * Auth Service Database Access
 * 
 * Uses createServiceDatabaseAccess from core-service for consistent database access.
 * 
 * NOTE: Auth-service uses 'core-service' as serviceName because users, sessions,
 * and configs are stored in the shared core_service database.
 */

import { createServiceDatabaseAccess } from 'core-service';

// Create database accessor using 'core-service' to access the shared database
// This is intentional - auth data lives in core_service database
export const db = createServiceDatabaseAccess('core-service');
