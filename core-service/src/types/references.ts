/**
 * Cross-Service References
 * 
 * Types for linking entities across microservices
 */

import type { Currency } from './currency.js';

// ═══════════════════════════════════════════════════════════════════
// Wallet Reference (from payment-gateway)
// ═══════════════════════════════════════════════════════════════════

/**
 * Reference to a wallet in payment-gateway
 * Use in bonus-service to link bonus to specific wallet
 */
export interface WalletReference {
  walletId: string;
  userId: string;
  tenantId: string;
  currency: Currency;
  category?: string;
}

/**
 * Wallet balance snapshot (for cross-service queries)
 */
export interface WalletBalanceSnapshot {
  walletId: string;
  balance: number;
  bonusBalance: number;
  lockedBalance: number;
  availableBalance: number;
  currency: Currency;
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Bonus Reference (from bonus-service)
// ═══════════════════════════════════════════════════════════════════

/**
 * Reference to a bonus in bonus-service
 * Use in payment-gateway to track bonus-related restrictions
 */
export interface BonusReference {
  bonusId: string;
  userId: string;
  tenantId: string;
  bonusType: string;
  currency: Currency;
  amount: number;
  turnoverRequired: number;       // Activity/turnover requirement
  turnoverProgress: number;       // Current progress
  expiresAt: Date;
  status: string;
}

/**
 * Active bonuses summary for a wallet
 */
export interface WalletBonusSummary {
  walletId: string;
  activeBonuses: BonusReference[];
  totalBonusAmount: number;
  totalTurnoverRequired: number;  // Total activity requirement
  totalTurnoverProgress: number;  // Total progress
  hasBlockingBonus: boolean;      // Blocks withdrawal until requirements met
}

// ═══════════════════════════════════════════════════════════════════
// Transaction Reference (from payment-gateway)
// ═══════════════════════════════════════════════════════════════════

/**
 * Reference to a transaction in payment-gateway
 * Use in bonus-service to link bonus to qualifying deposit
 */
export interface TransactionReference {
  transactionId: string;
  type: 'deposit' | 'withdrawal' | 'transfer';
  amount: number;
  currency: Currency;
  status: string;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// User Reference (shared)
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal user reference for cross-service operations
 */
export interface UserReference {
  userId: string;
  tenantId: string;
  email?: string;
  username?: string;
  verificationLevel?: 'none' | 'basic' | 'enhanced' | 'full';
}

// ═══════════════════════════════════════════════════════════════════
// Service Response (for cross-service calls)
// ═══════════════════════════════════════════════════════════════════

/**
 * Standard response format for cross-service API calls
 */
export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  correlationId?: string;
  timestamp: Date;
}

/**
 * Create a success response
 */
export function successResponse<T>(data: T, correlationId?: string): ServiceResponse<T> {
  return {
    success: true,
    data,
    correlationId,
    timestamp: new Date(),
  };
}

/**
 * Create an error response
 */
export function errorResponse(
  code: string, 
  message: string, 
  details?: Record<string, unknown>,
  correlationId?: string
): ServiceResponse<never> {
  return {
    success: false,
    error: { code, message, details },
    correlationId,
    timestamp: new Date(),
  };
}

