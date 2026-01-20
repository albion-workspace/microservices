/**
 * Utility functions for auth service
 * 
 * Note: Password hashing/verification is handled by Passport.js via core-service.
 * This file only contains utilities that are NOT part of Passport's authentication flow.
 */

import crypto from 'crypto';
import type { AuthConfig, IdentifierType } from './types.js';

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

/**
 * Calculate lockout end time
 * Used by Passport LocalStrategy for account lockout
 */
export function calculateLockoutEnd(config: AuthConfig): Date {
  return new Date(Date.now() + config.lockoutDuration * 60 * 1000);
}

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
// Role Utilities (using access-engine patterns)
// ═══════════════════════════════════════════════════════════════════

import type { UserRole } from './types/role-types.js';

/**
 * Convert roles to string array
 * Handles both legacy format (string[]) and new format (UserRole[])
 * Uses the same logic as access-engine's normalizeUserRoles
 */
export function rolesToArray(roles: UserRole[] | string[] | undefined | null): string[] {
  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    return [];
  }
  
  // Check if it's legacy format (string[])
  if (typeof roles[0] === 'string') {
    return (roles as string[]).filter(Boolean);
  }
  
  // UserRole[] format - extract role names, filter active and non-expired
  const now = new Date();
  return (roles as UserRole[])
    .filter((r) => r.active !== false)
    .filter((r) => !r.expiresAt || new Date(r.expiresAt) > now)
    .map((r) => r.role)
    .filter(Boolean);
}
