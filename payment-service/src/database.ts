/**
 * Payment Service Database Access
 * 
 * Uses createServiceDatabaseAccess from core-service for consistent database access.
 * Payment-service uses per-service strategy (payment_service database).
 */

import { createServiceDatabaseAccess } from 'core-service';

// Create database accessor for payment-service
export const db = createServiceDatabaseAccess('payment-service');
