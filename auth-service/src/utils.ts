/**
 * Utility functions for auth service
 * 
 * Includes password hashing/verification using bcrypt.
 * Passport.js does NOT automatically hash passwords - we must do it ourselves.
 */

// ═══════════════════════════════════════════════════════════════════
// Token Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract the actual token from a string that may contain prefixes
 * Always takes the last segment after the final colon
 * 
 * @example
 * extractToken("approval:token123") => "token123"
 * extractToken("pending:bonus:approval:token123") => "token123"
 * extractToken("token123") => "token123"
 */
export function extractToken(tokenString: string): string {
  return tokenString.includes(':') 
    ? tokenString.split(':').pop() || tokenString
    : tokenString;
}

/**
 * Extract operation type from a Redis key
 * Key format: pending:{operationType}:{subType}:{token}
 * 
 * @example
 * extractOperationTypeFromKey("pending:bonus:approval:token123") => "bonus"
 * extractOperationTypeFromKey("pending:payment:token123") => "payment"
 * extractOperationTypeFromKey("pending:registration:token123") => "registration"
 */
export function extractOperationTypeFromKey(key: string): string {
  if (!key.startsWith('pending:')) {
    return 'unknown';
  }
  
  const parts = key.split(':');
  return parts.length >= 2 ? parts[1] : 'unknown';
}

// ═══════════════════════════════════════════════════════════════════
// Redis Key Pattern Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Build Redis key patterns for pending operations
 * Returns patterns in order of specificity (most specific first)
 * 
 * @param token - The extracted token (without prefixes)
 * @param operationType - Optional operation type (e.g., 'bonus', 'payment', 'approval')
 * @returns Array of Redis key patterns to try, ordered by specificity
 * 
 * @example
 * buildPendingOperationPatterns('token123', 'approval')
 * // => ['pending:bonus:approval:token123', 'pending:payment:approval:token123', ...]
 */
export function buildPendingOperationPatterns(
  token: string,
  operationType?: string
): readonly string[] {
  const patterns: string[] = [];
  
  if (operationType === 'approval') {
    // Approval operations: use wildcard to find any approval operation dynamically
    // This avoids hardcoding specific operation types (bonus, payment, etc.)
    patterns.push(`pending:*:approval:${token}`);
  } else if (operationType) {
    // Specific operation type: try direct match first, then approval variant
    patterns.push(`pending:${operationType}:${token}`);
    patterns.push(`pending:${operationType}:approval:${token}`);
  } else {
    // No operation type - search broadly
    patterns.push(`pending:*:${token}`);
    patterns.push(`pending:*:approval:${token}`);
  }
  
  return patterns;
}

/**
 * Check if a Redis key matches a token (ends with token)
 * 
 * @param key - Redis key to check
 * @param token - Token to match against
 * @returns True if key ends with the token
 * 
 * @example
 * keyMatchesToken('pending:bonus:approval:token123', 'token123') => true
 * keyMatchesToken('pending:bonus:approval:token123', 'approval:token123') => false
 */
export function keyMatchesToken(key: string, token: string): boolean {
  return key.endsWith(`:${token}`) || key.endsWith(token);
}

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { RoleResolver, type UserRole, type User as AccessEngineUser } from 'core-service/access';
import { normalizeDocument, logger } from 'core-service';
import type { AuthConfig, IdentifierType, User } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Password Hashing & Verification (CRITICAL: Passport.js does NOT hash passwords)
// ═══════════════════════════════════════════════════════════════════

const BCRYPT_ROUNDS = 12; // Recommended rounds for production (balance between security and performance)

/**
 * Hash a password using bcrypt
 * CRITICAL: Always hash passwords before storing in database
 * 
 * @param password - Plain text password
 * @returns Hashed password (bcrypt hash string)
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 * CRITICAL: Always use this to compare passwords, never compare plain text
 * 
 * @param password - Plain text password to verify
 * @param hash - Bcrypt hash from database
 * @returns True if password matches hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password against policy requirements
 */
export function validatePassword(password: string, config: AuthConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < config.passwordMinLength) {
    errors.push(`Password must be at least ${config.passwordMinLength} characters long`);
  }
  
  if (config.passwordRequireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (config.passwordRequireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (config.passwordRequireSymbols && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Token Utilities
// ═══════════════════════════════════════════════════════════════════

export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function generateOTP(length: number = 6): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

export async function hashToken(token: string): Promise<string> {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('base64url');
}

// ═══════════════════════════════════════════════════════════════════
// Identifier Utilities
// ═══════════════════════════════════════════════════════════════════

export function detectIdentifierType(identifier: string): IdentifierType {
  // Email pattern
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    return 'email';
  }
  
  // Phone pattern (international format)
  if (/^\+?[\d\s-()]+$/.test(identifier) && identifier.replace(/\D/g, '').length >= 10) {
    return 'phone';
  }
  
  // Default to username
  return 'username';
}

export function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // If no country code, assume +1 (US) for demo purposes
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // Add + if missing
  if (!phone.startsWith('+')) {
    return `+${digits}`;
  }
  
  return phone;
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// ═══════════════════════════════════════════════════════════════════
// Validation Utilities
// ═══════════════════════════════════════════════════════════════════

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export function isValidUsername(username: string): boolean {
  // Username: 3-30 chars, alphanumeric + underscore/hyphen
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  return usernameRegex.test(username);
}

// ═══════════════════════════════════════════════════════════════════
// Security Utilities
// 
// Note: Account lockout checking is now handled by Passport LocalStrategy.
// These utilities are only used by Passport internally.
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// Device & Session Utilities
// ═══════════════════════════════════════════════════════════════════

export function parseUserAgent(userAgent: string | undefined): { os?: string; browser?: string; deviceType?: 'web' | 'mobile' | 'tablet' | 'desktop' } {
  if (!userAgent) return {};
  
  const result: { os?: string; browser?: string; deviceType?: 'web' | 'mobile' | 'tablet' | 'desktop' } = {};
  
  // Detect OS
  if (/windows/i.test(userAgent)) result.os = 'Windows';
  else if (/mac os x/i.test(userAgent)) result.os = 'macOS';
  else if (/linux/i.test(userAgent)) result.os = 'Linux';
  else if (/android/i.test(userAgent)) result.os = 'Android';
  else if (/iphone|ipad|ipod/i.test(userAgent)) result.os = 'iOS';
  
  // Detect browser
  if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) result.browser = 'Chrome';
  else if (/firefox/i.test(userAgent)) result.browser = 'Firefox';
  else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) result.browser = 'Safari';
  else if (/edg/i.test(userAgent)) result.browser = 'Edge';
  
  // Detect device type
  if (/mobile/i.test(userAgent)) result.deviceType = 'mobile';
  else if (/tablet|ipad/i.test(userAgent)) result.deviceType = 'tablet';
  else result.deviceType = result.os === 'Windows' || result.os === 'macOS' || result.os === 'Linux' ? 'desktop' : 'web';
  
  return result;
}

export function generateDeviceId(userAgent: string | undefined, ipAddress: string | undefined): string {
  const data = `${userAgent || 'unknown'}:${ipAddress || 'unknown'}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════
// Time Utilities
// ═══════════════════════════════════════════════════════════════════

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

// ═══════════════════════════════════════════════════════════════════
// Random Utilities
// ═══════════════════════════════════════════════════════════════════

export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

// ═══════════════════════════════════════════════════════════════════
// User Data Extraction Utilities (using access-engine)
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert roles to string array using access-engine patterns
 * Handles UserRole[] format - extracts role names, filters active and non-expired
 * Uses the same logic as access-engine's RoleResolver.normalizeUserRoles
 */
export function rolesToArray(roles: UserRole[] | string[] | undefined | null): string[] {
  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    return [];
  }
  
  // Handle legacy string[] format (access-engine compatibility)
  if (typeof roles[0] === 'string') {
    return roles as string[];
  }
  
  // Handle UserRole[] format using access-engine's exact logic
  // This matches RoleResolver's normalizeUserRoles and resolveUserPermissions logic
  const now = new Date();
  return (roles as UserRole[])
    .filter((r) => {
      // Defensive check: ensure r is an object with role property
      if (!r || typeof r !== 'object') {
        return false;
      }
      // Filter inactive roles (access-engine pattern)
      return r.active !== false;
    })
    .filter((r) => {
      // Filter expired roles
      if (!r.expiresAt) {
        return true;
      }
      const expiresAt = r.expiresAt instanceof Date ? r.expiresAt : new Date(r.expiresAt);
      return expiresAt > now;
    })
    .map((r) => {
      // Extract role name - handle both string and object formats
      if (typeof r === 'string') {
        return r;
      }
      return r.role;
    })
    .filter(Boolean); // Remove any falsy values
}

/**
 * Extract permissions from user object
 * Handles both array format and object format { "permission": true }
 */
export function permissionsToArray(permissions: string[] | Record<string, boolean> | undefined | null): string[] {
  if (!permissions) {
    return [];
  }
  
  if (Array.isArray(permissions)) {
    return permissions;
  }
  
  if (typeof permissions === 'object' && !Array.isArray(permissions)) {
    return Object.keys(permissions).filter(key => permissions[key] === true);
  }
  
  return [];
}

/**
 * Extract roles and permissions from user object for UserContext
 * Uses access-engine's RoleResolver for proper role resolution when provided
 * Returns normalized arrays ready for JWT token creation
 * 
 * When RoleResolver is provided, this will:
 * - Resolve role inheritance
 * - Merge permissions from role definitions
 * - Handle context-based roles
 */
export function extractUserContext(user: User, roleResolver?: RoleResolver): { roles: string[]; permissions: string[] } {
  const roles = rolesToArray(user.roles);
  let permissions: string[] = permissionsToArray(user.permissions);
  
  // If RoleResolver is provided, use access-engine's resolution for inherited permissions
  if (roleResolver && roles.length > 0) {
    // Convert user to access-engine User format
    // RoleResolver.resolveUserPermissions accepts User & { roles?: UserRole[] | string[] }
    const userId = user.id || (user as any)._id?.toString() || '';
    const accessUser: any = {
      userId,
      tenantId: user.tenantId,
      roles: (user.roles || []), // Pass original roles - RoleResolver handles both formats
      permissions: permissions, // Pass already normalized permissions
    };
    
    const resolved = roleResolver.resolveUserPermissions(accessUser, {
      includeInherited: true,
      includePermissions: true,
    });
    
    // Merge resolved permissions with direct permissions (access-engine handles deduplication)
    const resolvedPerms = Array.from(resolved.permissions);
    permissions = Array.from(new Set([...permissions, ...resolvedPerms]));
  }
  
  return {
    roles,
    permissions,
  };
}

/**
 * Create UserContext from user object
 * Reusable function for consistent UserContext creation
 * Uses access-engine's RoleResolver for role/permission resolution when provided
 */
export function createUserContext(
  user: User & { _id?: any },
  roleResolver?: RoleResolver
): { userId: string; tenantId: string; roles: string[]; permissions: string[] } {
  const userId = ensureUserId(user);
  const { roles, permissions } = extractUserContext(user, roleResolver);
  
  return {
    userId,
    tenantId: user.tenantId,
    roles,
    permissions,
  };
}

/**
 * Ensure user has valid id field (from _id if needed)
 * Throws error if user ID cannot be determined
 */
export function ensureUserId(user: User & { _id?: any }): string {
  if (user.id) {
    return user.id;
  }
  
  if (user._id) {
    return user._id.toString();
  }
  
  throw new Error('User missing id field - cannot determine user ID');
}

/**
 * Normalize user object: map _id to id, normalize permissions and roles
 * Reusable function for consistent user normalization across the service
 */
export function normalizeUser(user: any): any {
  if (!user) {
    return null;
  }
  
  // Use core-service helper to ensure id field exists from _id
  const normalized = normalizeDocument(user);
  if (!normalized) return null;
  
  // Normalize permissions using utility function
  normalized.permissions = permissionsToArray(normalized.permissions);
  
  // Normalize roles using utility function - CRITICAL for GraphQL compatibility
  // This ensures UserRole[] is converted to string[] before GraphQL serialization
  normalized.roles = rolesToArray(normalized.roles);
  
  // Defensive check: ensure roles is always an array of strings
  if (!Array.isArray(normalized.roles)) {
    logger.warn('Roles normalization failed, forcing to empty array', { 
      userId: normalized.id, 
      roles: normalized.roles,
      rolesType: typeof normalized.roles 
    });
    normalized.roles = [];
  }
  
  // Additional validation: ensure all roles are strings
  normalized.roles = normalized.roles.map((r: any) => {
    if (typeof r === 'string') {
      return r;
    }
    if (r && typeof r === 'object' && r.role) {
      return r.role;
    }
    logger.warn('Invalid role format found, skipping', { role: r, userId: normalized.id });
    return null;
  }).filter(Boolean);
  
  return normalized;
}

/**
 * Normalize multiple user objects
 */
export function normalizeUsers(users: any[]): any[] {
  return users.map(user => normalizeUser(user)).filter(Boolean);
}
