/**
 * Bonus Event Dispatcher
 * 
 * Unified event dispatcher that handles both:
 * - Internal cross-service events (Redis pub/sub)
 * - External webhook notifications (HTTP)
 * 
 * This ensures consistency: same data goes to both channels.
 */

import {
  createWebhookManager,
  createUnifiedEmitter,
  logger,
} from 'core-service';

// ═══════════════════════════════════════════════════════════════════
// Bonus Webhook Event Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Event types that bonus-service can emit.
 * Third parties can subscribe to these via webhooks.
 */
export type BonusWebhookEvents =
  | 'bonus.awarded'         // Bonus credited to user
  | 'bonus.activated'       // Bonus activated (started usage)
  | 'bonus.converted'       // Bonus converted to real balance
  | 'bonus.forfeited'       // Bonus forfeited (e.g., withdrawal while active)
  | 'bonus.expired'         // Bonus expired
  | 'bonus.cancelled'       // Bonus cancelled by user
  | 'bonus.requirements_met' // Turnover requirements completed
  | 'bonus.*';              // Wildcard for all bonus events

// ═══════════════════════════════════════════════════════════════════
// Webhook Manager
// ═══════════════════════════════════════════════════════════════════

/**
 * Webhook manager for bonus service.
 * Uses 'bonus_webhooks' collection with deliveries as sub-documents.
 */
export const bonusWebhooks = createWebhookManager<BonusWebhookEvents>({
  serviceName: 'bonus',
  apiVersion: '2024-01-01',
});

// ═══════════════════════════════════════════════════════════════════
// Unified Event Dispatcher
// ═══════════════════════════════════════════════════════════════════

/**
 * Unified event emitter - dispatches to BOTH internal services AND webhooks.
 * 
 * This ensures consistency:
 * - Same data goes to Redis pub/sub (for cross-service communication)
 * - Same data goes to webhooks (for external/third-party integrations)
 * 
 * Use this instead of raw emit() to ensure webhooks are also triggered.
 * 
 * @example
 * await emitBonusEvent('bonus.awarded', tenantId, userId, {
 *   bonusId: '123',
 *   type: 'welcome',
 *   value: 100,
 *   currency: 'USD',
 *   walletId: 'wallet-456',
 * });
 */
export const emitBonusEvent = createUnifiedEmitter(bonusWebhooks);

// ═══════════════════════════════════════════════════════════════════
// Event Data Types (for type safety)
// ═══════════════════════════════════════════════════════════════════

export interface BonusAwardedData {
  bonusId: string;
  type: string;
  value: number;
  currency: string;
  walletId?: string;
  turnoverRequired?: number;
  expiresAt?: string;
}

export interface BonusConvertedData {
  bonusId: string;
  walletId?: string;
  amount: number;
  currency: string;
}

export interface BonusForfeitedData {
  bonusId: string;
  walletId?: string;
  forfeitedValue: number;
  currency: string;
  reason: string;
}

export interface BonusExpiredData {
  bonusId: string;
  walletId?: string;
  forfeitedValue: number;
  currency: string;
  type: string;
}

export interface BonusRequirementsMetData {
  bonusId: string;
  type: string;
  value: number;
  currency: string;
}

// ═══════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize the bonus webhooks system.
 * Call this after database connection is established.
 */
export async function initializeBonusWebhooks(): Promise<void> {
  try {
    await bonusWebhooks.initialize();
    logger.info('Bonus webhooks initialized');
  } catch (err) {
    logger.warn('Could not initialize bonus webhooks', { error: (err as Error).message });
  }
}

/**
 * Cleanup old webhook deliveries.
 * Call this periodically (e.g., daily) to keep the database clean.
 */
export async function cleanupBonusWebhookDeliveries(olderThanDays = 30): Promise<number> {
  return bonusWebhooks.cleanupDeliveries(olderThanDays);
}

