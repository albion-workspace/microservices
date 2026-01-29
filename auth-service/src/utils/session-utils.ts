/**
 * Session Utility Functions
 * Reusable functions for session operations
 */

import { normalizeDocument, generateMongoId, extractDocumentId, findById } from 'core-service';
import { db } from '../database.js';
import type { Session, DeviceInfo } from '../types.js';
import { hashToken, generateRefreshToken, addSeconds } from '../utils.js';

/**
 * Find existing valid session for the same device
 */
export async function findExistingSession(
  userId: string,
  tenantId: string,
  deviceId: string
): Promise<Session | null> {
  const database = await db.getDb();
  const now = new Date();
  
  const existingSession = await database.collection('sessions').findOne({
    userId,
    tenantId,
    deviceId,
    isValid: true,
    refreshTokenExpiresAt: { $gt: now },
    sessionExpiresAt: { $gt: now },
  }) as unknown as Session | null;
  
  return existingSession ? normalizeDocument(existingSession) : null;
}

/**
 * Create a new session with refresh token
 */
export async function createSession(
  userId: string,
  tenantId: string,
  deviceId: string,
  deviceInfo: DeviceInfo,
  refreshTokenExpiresIn: number,
  sessionExpiresIn: number
): Promise<{ sessionId: string; refreshToken: string }> {
  const database = await db.getDb();
  const now = new Date();
  
  // Generate refresh token
  const refreshTokenValue = generateRefreshToken();
  const refreshTokenHash = await hashToken(refreshTokenValue);
  
  // Create session
  const { objectId: sessionObjectId, idString: sessionId } = generateMongoId();
  
  const session: Session = {
    id: sessionId,
    userId,
    tenantId,
    token: refreshTokenValue, // Temporary - will be removed
    tokenHash: refreshTokenHash,
    refreshTokenExpiresAt: addSeconds(now, refreshTokenExpiresIn),
    deviceId,
    deviceInfo,
    createdAt: now,
    lastAccessedAt: now,
    sessionExpiresAt: addSeconds(now, sessionExpiresIn),
    isValid: true,
  };
  
  await database.collection('sessions').insertOne(session as any);
  
  // Remove plain token from database (security best practice)
  await database.collection('sessions').updateOne(
    { _id: sessionObjectId },
    { $unset: { token: '' } }
  );
  
  return { sessionId, refreshToken: refreshTokenValue };
}

/**
 * Update existing session (reuse with token rotation)
 */
export async function updateSessionForReuse(
  session: Session,
  deviceInfo: DeviceInfo,
  refreshTokenExpiresIn: number
): Promise<string> {
  const database = await db.getDb();
  const now = new Date();
  
  // Generate new refresh token (rotation for security)
  const refreshTokenValue = generateRefreshToken();
  const refreshTokenHash = await hashToken(refreshTokenValue);
  
  // Use extractDocumentId helper to get session ID, then findById to get document with _id
  const sessionId = extractDocumentId(session);
  if (!sessionId) {
    throw new Error('Session missing ID field');
  }
  
  // Use findById helper to get the document with _id for update
  const sessionDoc = await findById(database.collection('sessions'), sessionId);
  if (!sessionDoc || !(sessionDoc as any)._id) {
    throw new Error('Session document not found');
  }
  
  await database.collection('sessions').updateOne(
    { _id: (sessionDoc as any)._id },
    {
      $set: {
        tokenHash: refreshTokenHash,
        refreshTokenExpiresAt: addSeconds(now, refreshTokenExpiresIn),
        lastAccessedAt: now,
        deviceInfo,
      },
    }
  );
  
  return refreshTokenValue;
}

/**
 * Invalidate session by token hash
 */
export async function invalidateSessionByToken(
  tokenHash: string,
  userId: string,
  reason: string
): Promise<boolean> {
  const database = await db.getDb();
  const now = new Date();
  
  const result = await database.collection('sessions').updateOne(
    { tokenHash, userId, isValid: true },
    { $set: { isValid: false, revokedAt: now, revokedReason: reason } }
  );
  
  return result.matchedCount > 0;
}

/**
 * Invalidate all sessions for a user
 */
export async function invalidateAllUserSessions(
  userId: string,
  tenantId: string,
  reason: string
): Promise<number> {
  const database = await db.getDb();
  const now = new Date();
  
  const result = await database.collection('sessions').updateMany(
    { userId, tenantId, isValid: true },
    { $set: { isValid: false, revokedAt: now, revokedReason: reason } }
  );
  
  return result.modifiedCount || 0;
}

/**
 * Update session last used timestamp
 */
export async function updateSessionLastUsed(session: Session): Promise<void> {
  const database = await db.getDb();
  const now = new Date();
  
  const sessionId = extractDocumentId(session);
  if (!sessionId) {
    throw new Error('Session missing ID field');
  }
  
  // Use findById helper to get the document with _id for update
  const sessionDoc = await findById(database.collection('sessions'), sessionId);
  if (!sessionDoc || !(sessionDoc as any)._id) {
    throw new Error('Session document not found');
  }
  
  await database.collection('sessions').updateOne(
    { _id: (sessionDoc as any)._id },
    {
      $set: {
        lastUsedAt: now,
        lastAccessedAt: now,
      },
    }
  );
}
