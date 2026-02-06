/**
 * JWT utilities (client-safe, read-only)
 *
 * Decode JWT payload without verification. For use in browser/client to read
 * claims (e.g. exp for proactive refresh). Verification must be done server-side.
 *
 * No Node.js or crypto dependencies - uses atob and JSON.parse only.
 */

export interface JwtPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

/**
 * Decode JWT token without verification (client-side only, for reading claims).
 *
 * @param token - Raw JWT string (header.payload.signature)
 * @returns Decoded payload or null if invalid/not a JWT
 */
export function decodeJWT(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    ) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Check if a decoded JWT payload is expired (exp claim in seconds since epoch).
 *
 * @param payload - Result of decodeJWT(token)
 * @param nowMs - Optional current time in ms (default: Date.now())
 * @returns true if exp is set and in the past
 */
export function isExpired(
  payload: JwtPayload | null,
  nowMs: number = Date.now()
): boolean {
  if (!payload?.exp) return false;
  return payload.exp * 1000 < nowMs;
}
