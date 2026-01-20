/**
 * Generic Utilities
 * 
 * Common utility functions used across microservices
 * These are generic helpers that don't depend on service-specific logic
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// Date/Time Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Add minutes to a date
 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * Add hours to a date
 */
export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Add seconds to a date
 */
export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/**
 * Add months to a date
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Add years to a date
 */
export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Token/Hash Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Hash a token using SHA-256
 * Useful for storing tokens securely (e.g., refresh tokens, reset tokens)
 */
export async function hashToken(token: string): Promise<string> {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a random token of specified length
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a random OTP code of specified length
 */
export function generateOTP(length: number = 6): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

/**
 * Generate a refresh token (base64url encoded)
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('base64url');
}

/**
 * Generate backup codes for 2FA
 */
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
// String/Identifier Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize email address (lowercase and trim)
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Normalize phone number (remove non-digits, add country code if missing)
 */
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

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Validate username format (3-30 chars, alphanumeric + underscore/hyphen)
 */
export function isValidUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  return usernameRegex.test(username);
}

/**
 * Detect identifier type (email, phone, or username)
 */
export type IdentifierType = 'email' | 'phone' | 'username';

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

// ═══════════════════════════════════════════════════════════════════
// Expiry Parsing
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse expiry string (e.g., '1h', '30m', '7d') to seconds
 * Used for JWT expiry, token expiry, etc.
 */
export function parseExpiry(exp: string): number {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return 3600; // default 1h
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(match[1]) * (mult[match[2]] || 3600);
}

// ═══════════════════════════════════════════════════════════════════
// Device/User Agent Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse user agent string to extract OS, browser, and device type
 */
export function parseUserAgent(userAgent: string | undefined): { 
  os?: string; 
  browser?: string; 
  deviceType?: 'web' | 'mobile' | 'tablet' | 'desktop' 
} {
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

/**
 * Generate device ID from user agent and IP address
 */
export function generateDeviceId(userAgent: string | undefined, ipAddress: string | undefined): string {
  const data = `${userAgent || 'unknown'}:${ipAddress || 'unknown'}`;
  return crypto.createHash('md5').update(data).digest('hex');
}
