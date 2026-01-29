/**
 * Event Dispatcher - Auth Service Webhooks
 * Handles user authentication events and webhook delivery
 */

import { createWebhookManager, getDatabase, logger, emit } from 'core-service';
import type { AuthEventType } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Auth Webhook Events
// ═══════════════════════════════════════════════════════════════════

export type AuthWebhookEvents = {
  'user.registered': { userId: string; email?: string; username?: string; phone?: string };
  'user.login': { userId: string; deviceId?: string; ipAddress?: string };
  'user.logout': { userId: string; deviceId?: string };
  'user.email_verified': { userId: string; email: string };
  'user.phone_verified': { userId: string; phone: string };
  'user.password_changed': { userId: string };
  'user.password_reset': { userId: string };
  'user.2fa_enabled': { userId: string };
  'user.2fa_disabled': { userId: string };
  'user.locked': { userId: string; reason: string };
  'user.unlocked': { userId: string };
  'user.suspended': { userId: string; reason: string };
  'user.deleted': { userId: string };
  /**
   * Generic user metadata update event
   * Used for tracking user activity flags (deposit, withdrawal, purchase, action, etc.)
   * Type field indicates what kind of metadata was updated
   * Note: userId is passed separately to emitAuthEvent, not in data
   */
  'user.metadata': { 
    type: 'deposit' | 'withdrawal' | 'purchase' | 'action' | string; // Activity type
    metadata: Record<string, any>; // The metadata fields that were updated
    transactionId?: string; // Optional: related transaction ID
    amount?: number; // Optional: transaction amount
    currency?: string; // Optional: transaction currency
    timestamp: string; // When the metadata was updated
  };
  'session.created': { userId: string; sessionId: string; deviceInfo: any };
  'session.expired': { userId: string; sessionId: string };
  'session.revoked': { userId: string; sessionId: string; reason: string };
  'social.connected': { userId: string; provider: string };
  'social.disconnected': { userId: string; provider: string };
};

/**
 * Create webhook manager for auth service
 */
export const authWebhooks = createWebhookManager({
  serviceName: 'auth-service',
});

/**
 * Initialize auth webhooks
 */
export async function initializeAuthWebhooks() {
  try {
    await authWebhooks.initialize();
    logger.info('Auth webhooks initialized');
  } catch (error) {
    logger.error('Failed to initialize auth webhooks', { error });
  }
}

/**
 * Emit auth event (both internal events via Redis + webhooks)
 * 
 * Events are emitted to:
 * - integration:auth channel (for notification-service and other services)
 * - Registered webhooks (external integrations)
 */
export async function emitAuthEvent<E extends keyof AuthWebhookEvents>(
  event: E,
  tenantId: string,
  userId: string,
  data: AuthWebhookEvents[E],
  options?: { skipInternal?: boolean; skipWebhooks?: boolean }
) {
  try {
    // Emit internal event via Redis (for cross-service communication)
    // notification-service listens to 'integration:auth' channel
    if (!options?.skipInternal) {
      await emit(
        'integration:auth',
        tenantId,
        userId,
        {
          type: event,
          data: data as any,
          timestamp: new Date(),
        }
      );
      
      logger.debug('Auth event emitted to integration:auth', { 
        event, 
        userId, 
        tenantId 
      });
    }
    
    // Dispatch webhook (for external integrations)
    if (!options?.skipWebhooks) {
      await authWebhooks.dispatch({
        eventType: event as string,
        tenantId,
        userId,
        data: data as any,
      });
    }
  } catch (error) {
    logger.error('Failed to emit auth event', { error, event, tenantId, userId });
  }
}

/**
 * Cleanup old webhook deliveries (run periodically)
 * Deliveries are now stored as sub-documents in webhook documents.
 */
export async function cleanupAuthWebhookDeliveries(olderThanDays: number = 30): Promise<number> {
  try {
    // Use the webhook manager's cleanup method which handles merged structure
    return await authWebhooks.cleanupDeliveries(olderThanDays);
  } catch (error) {
    logger.error('Failed to cleanup webhook deliveries', { error });
    return 0;
  }
}
