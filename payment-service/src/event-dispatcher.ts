/**
 * Payment Event Dispatcher
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
  initializeWebhooks,
} from 'core-service';

// ═══════════════════════════════════════════════════════════════════
// Payment Webhook Event Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Event types that payment-gateway can emit.
 * Third parties can subscribe to these via webhooks.
 */
export type PaymentWebhookEvents =
  | 'wallet.created'              // New wallet created
  | 'wallet.updated'              // Wallet settings changed
  | 'wallet.deposit.initiated'    // Deposit started
  | 'wallet.deposit.completed'    // Deposit successful
  | 'wallet.deposit.failed'       // Deposit failed
  | 'wallet.withdrawal.initiated' // Withdrawal requested
  | 'wallet.withdrawal.completed' // Withdrawal processed
  | 'wallet.withdrawal.failed'    // Withdrawal failed
  | 'wallet.transfer.completed'   // Internal transfer completed
  | 'wallet.*';                   // Wildcard for all wallet events

// ═══════════════════════════════════════════════════════════════════
// Webhook Manager
// ═══════════════════════════════════════════════════════════════════

/**
 * Webhook manager for payment gateway.
 * Uses 'payment_webhooks' collection with deliveries as sub-documents.
 */
export const paymentWebhooks = createWebhookManager<PaymentWebhookEvents>({
  serviceName: 'payment',
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
 * await emitPaymentEvent('wallet.deposit.completed', tenantId, userId, {
 *   transactionId: '123',
 *   walletId: 'wallet-456',
 *   amount: 1000,
 *   currency: 'USD',
 * });
 */
export const emitPaymentEvent = createUnifiedEmitter(paymentWebhooks);

// ═══════════════════════════════════════════════════════════════════
// Event Data Types (for type safety)
// ═══════════════════════════════════════════════════════════════════

export interface WalletCreatedData {
  walletId: string;
  userId: string;
  currency: string;
}

export interface DepositCompletedData {
  transactionId: string;
  walletId: string;
  type: string;
  amount: number;
  currency: string;
  balance: number;
  isFirstDeposit?: boolean;
}

export interface WithdrawalCompletedData {
  transactionId: string;
  walletId: string;
  type: string;
  amount: number;
  currency: string;
  balance: number;
}

// ═══════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize the payment webhooks system with database strategy.
 * Call this after database connection is established.
 * Uses generic initializeWebhooks helper from core-service.
 */
export { initializeWebhooks as initializePaymentWebhooksGeneric };

// Re-export for backward compatibility with existing service code
export async function initializePaymentWebhooks(options: {
  databaseStrategy: import('core-service').DatabaseStrategyResolver;
  defaultContext: import('core-service').DatabaseContext;
}): Promise<void> {
  return initializeWebhooks(paymentWebhooks, options);
}

/**
 * Cleanup old webhook deliveries.
 * Call this periodically (e.g., daily) to keep the database clean.
 */
export async function cleanupPaymentWebhookDeliveries(olderThanDays = 30): Promise<number> {
  return paymentWebhooks.cleanupDeliveries(olderThanDays);
}

