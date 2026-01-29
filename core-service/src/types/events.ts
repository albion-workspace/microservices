/**
 * Event Data Type Definitions
 * 
 * These are reusable event data types for common events.
 * Services can use these with IntegrationEvent<T> from integration.ts.
 * 
 * Example usage in your service:
 * 
 *   import { emit, on, type IntegrationEvent } from 'core-service';
 *   import type { DepositCompletedData } from 'core-service';
 *   
 *   // Emit typed event
 *   await emit('deposit.completed', tenantId, userId, depositData);
 *   
 *   // Listen with typed handler
 *   on('deposit.completed', async (event: IntegrationEvent<DepositCompletedData>) => {
 *     console.log(event.data.amount);
 *   });
 */

import type { Currency } from './currency.js';

// ═══════════════════════════════════════════════════════════════════
// Event Data Types
// Use these with IntegrationEvent<T> from integration.ts
// ═══════════════════════════════════════════════════════════════════

/** Deposit completed event data */
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

/** Withdrawal completed event data */
export interface WithdrawalCompletedData {
  transactionId: string;
  walletId: string;
  amount: number;
  currency: Currency;
  paymentMethod: string;
}

/** Withdrawal requested event data */
export interface WithdrawalRequestedData {
  transactionId: string;
  walletId: string;
  amount: number;
  currency: Currency;
}

/** Bonus credited event data */
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

/** Bonus converted event data */
export interface BonusConvertedData {
  bonusId: string;
  amount: number;
  currency: Currency;
  walletId?: string;
  walletCategory?: string;
}

/** Bonus forfeited event data */
export interface BonusForfeitedData {
  bonusId: string;
  amount: number;
  currency: Currency;
  reason: 'expired' | 'cancelled' | 'withdrawal' | 'violation';
  walletId?: string;
  walletCategory?: string;
}

/** Turnover completed event data */
export interface TurnoverCompletedData {
  bonusId: string;
  totalTurnover: number;
  turnoverRequired: number;
  currency: Currency;
}

/** Turnover progress event data */
export interface TurnoverProgressData {
  bonusId: string;
  turnoverProgress: number;
  turnoverRequired: number;
  percentComplete: number;
  currency: Currency;
  activityCategory?: string;
  contributionAmount?: number;
}

/** User registered event data */
export interface UserRegisteredData {
  email?: string;
  referralCode?: string;
  referrerId?: string;
  country?: string;
  source?: string;
}

/** User verified event data */
export interface UserVerifiedData {
  verificationLevel: 'basic' | 'enhanced' | 'full';
  verifiedFields: string[];
}
