/**
 * Example Event Type Definitions
 * 
 * These are EXAMPLE event types showing the recommended structure.
 * Services should define their own event types in their own codebase.
 * 
 * The generic IntegrationEvent<T> from integration.ts can handle any payload.
 * These specific types are optional - use them if you want type safety for
 * well-known event types across your services.
 * 
 * Example of defining custom events in your service:
 * 
 *   // In your-service/src/events.ts
 *   import { emit, on, type IntegrationEvent } from 'core-service';
 *   
 *   // Define your event data types
 *   interface OrderCreatedData {
 *     orderId: string;
 *     items: Array<{ sku: string; qty: number }>;
 *     total: number;
 *   }
 *   
 *   // Create typed emitter (optional but recommended)
 *   export const emitOrderCreated = (tenantId: string, userId: string, data: OrderCreatedData) =>
 *     emit('order.created', tenantId, userId, data);
 *   
 *   // Create typed handler (optional but recommended)
 *   export const onOrderCreated = (handler: (event: IntegrationEvent<OrderCreatedData>) => Promise<void>) =>
 *     on('order.created', handler);
 */

import type { Currency } from './currency.js';

// ═══════════════════════════════════════════════════════════════════
// Base Event (for backward compatibility with existing code)
// ═══════════════════════════════════════════════════════════════════

/** @deprecated Use IntegrationEvent<T> from integration.ts instead */
export interface BaseEvent {
  eventId: string;
  eventType: string;
  timestamp: Date;
  tenantId: string;
  userId: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Example Event Data Types
// These show the RECOMMENDED structure for event payloads
// ═══════════════════════════════════════════════════════════════════

/** Example: Deposit completed event data */
export interface DepositCompletedData {
  transactionId: string;
  walletId: string;
  amount: number;
  currency: Currency;
  isFirstDeposit: boolean;
  depositCount: number;
  paymentMethod: string;
  paymentProvider?: string;
}

/** Example: Withdrawal completed event data */
export interface WithdrawalCompletedData {
  transactionId: string;
  walletId: string;
  amount: number;
  currency: Currency;
  paymentMethod: string;
}

/** Example: Bonus credited event data */
export interface BonusCreditedData {
  bonusId: string;
  templateId: string;
  bonusType: string;
  amount: number;
  currency: Currency;
  walletId?: string;
  walletCategory?: string;
  turnoverRequired: number;
  expiresAt: Date;
}

/** Example: Bonus converted event data */
export interface BonusConvertedData {
  bonusId: string;
  amount: number;
  currency: Currency;
  walletId?: string;
  walletCategory?: string;
}

/** Example: Bonus forfeited event data */
export interface BonusForfeitedData {
  bonusId: string;
  amount: number;
  currency: Currency;
  reason: 'expired' | 'cancelled' | 'withdrawal' | 'violation';
  walletId?: string;
  walletCategory?: string;
}

/** Example: User registered event data */
export interface UserRegisteredData {
  email?: string;
  referralCode?: string;
  referrerId?: string;
  country?: string;
  source?: string;
}

/** Example: User verified event data */
export interface UserVerifiedData {
  verificationLevel: 'basic' | 'enhanced' | 'full';
  verifiedFields: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Legacy Event Interfaces (for backward compatibility)
// @deprecated - Use emit<T>() with your own data types instead
// ═══════════════════════════════════════════════════════════════════

/** @deprecated Use emit('deposit.completed', ..., DepositCompletedData) */
export interface DepositCompletedEvent extends BaseEvent {
  eventType: 'deposit.completed';
  data: DepositCompletedData;
}

/** @deprecated Use emit('withdrawal.completed', ..., WithdrawalCompletedData) */
export interface WithdrawalCompletedEvent extends BaseEvent {
  eventType: 'withdrawal.completed';
  data: WithdrawalCompletedData;
}

/** @deprecated */
export interface WithdrawalRequestedEvent extends BaseEvent {
  eventType: 'withdrawal.requested';
  data: {
    transactionId: string;
    walletId: string;
    amount: number;
    currency: Currency;
  };
}

/** @deprecated Use emit('bonus.credited', ..., BonusCreditedData) */
export interface BonusCreditedEvent extends BaseEvent {
  eventType: 'bonus.credited';
  data: BonusCreditedData;
}

/** @deprecated Use emit('bonus.converted', ..., BonusConvertedData) */
export interface BonusConvertedEvent extends BaseEvent {
  eventType: 'bonus.converted';
  data: BonusConvertedData;
}

/** @deprecated Use emit('bonus.forfeited', ..., BonusForfeitedData) */
export interface BonusForfeitedEvent extends BaseEvent {
  eventType: 'bonus.forfeited';
  data: BonusForfeitedData;
}

/** @deprecated Use emit('turnover.completed', ...) */
export interface TurnoverCompletedEvent extends BaseEvent {
  eventType: 'turnover.completed';
  data: {
    bonusId: string;
    totalTurnover: number;
    turnoverRequired: number;
    currency: Currency;
  };
}

/** @deprecated Use emit('turnover.progress', ...) */
export interface TurnoverProgressEvent extends BaseEvent {
  eventType: 'turnover.progress';
  data: {
    bonusId: string;
    turnoverProgress: number;
    turnoverRequired: number;
    percentComplete: number;
    currency: Currency;
    activityCategory?: string;
    contributionAmount?: number;
  };
}

/** @deprecated Use emit('user.registered', ..., UserRegisteredData) */
export interface UserRegisteredEvent extends BaseEvent {
  eventType: 'user.registered';
  data: UserRegisteredData;
}

/** @deprecated Use emit('user.verified', ..., UserVerifiedData) */
export interface UserVerifiedEvent extends BaseEvent {
  eventType: 'user.verified';
  data: UserVerifiedData;
}

// Legacy aliases
/** @deprecated */
export type WageringCompletedEvent = TurnoverCompletedEvent;
/** @deprecated */
export type WageringProgressEvent = TurnoverProgressEvent;

/** @deprecated - Use IntegrationEvent<T> from integration.ts */
export type IntegrationEvent = 
  | DepositCompletedEvent
  | WithdrawalCompletedEvent
  | WithdrawalRequestedEvent
  | BonusCreditedEvent
  | BonusConvertedEvent
  | BonusForfeitedEvent
  | TurnoverCompletedEvent
  | TurnoverProgressEvent
  | UserRegisteredEvent
  | UserVerifiedEvent;

/** @deprecated Use emit() or buildEvent() from integration.ts */
export function createEvent<T extends IntegrationEvent>(
  eventType: T['eventType'],
  tenantId: string,
  userId: string,
  data: T['data'],
  correlationId?: string
): T {
  return {
    eventId: crypto.randomUUID(),
    eventType,
    timestamp: new Date(),
    tenantId,
    userId,
    correlationId,
    data,
  } as T;
}
