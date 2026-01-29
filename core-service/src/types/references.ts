/**
 * Cross-Service References - Generic Types Only
 * 
 * Generic types for cross-service communication.
 * Domain-specific types should be defined in their respective services.
 */

// ═══════════════════════════════════════════════════════════════════
// User Reference (generic - used across all services)
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal user reference for cross-service operations
 */
export interface UserReference {
  userId: string;
  tenantId: string;
  email?: string;
  username?: string;
  verificationLevel?: 'none' | 'basic' | 'enhanced' | 'full';
}

// ═══════════════════════════════════════════════════════════════════
// Service Response (generic - standard API response format)
// ═══════════════════════════════════════════════════════════════════

/**
 * Standard response format for cross-service API calls
 */
export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  correlationId?: string;
  timestamp: Date;
}

/**
 * Create a success response
 */
export function successResponse<T>(data: T, correlationId?: string): ServiceResponse<T> {
  return {
    success: true,
    data,
    correlationId,
    timestamp: new Date(),
  };
}

/**
 * Create an error response
 */
export function errorResponse(
  code: string, 
  message: string, 
  details?: Record<string, unknown>,
  correlationId?: string
): ServiceResponse<never> {
  return {
    success: false,
    error: { code, message, details },
    correlationId,
    timestamp: new Date(),
  };
}
