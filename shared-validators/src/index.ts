/**
 * shared-validators
 * 
 * Shared client-safe validators for eligibility checking.
 * No database dependencies - pure functions only.
 * 
 * Can be used in both server and client code for:
 * - Pre-validation before API calls
 * - UI state (show/hide features based on eligibility)
 * - Consistent validation logic across stack
 * 
 * @example
 * ```typescript
 * import { BonusEligibility, KYCEligibility } from 'shared-validators';
 * 
 * // Check bonus eligibility
 * const bonus = BonusEligibility.check(template, { kycTier: 'standard' });
 * 
 * // Check if user can withdraw
 * const result = KYCEligibility.checkTransaction(limits, {
 *   currentTier: 'basic',
 *   transactionType: 'withdrawal',
 *   amount: 500,
 *   currency: 'EUR',
 * });
 * 
 * // Get upgrade requirements
 * const requirements = KYCEligibility.getTierRequirements('enhanced');
 * ```
 */

export * from './BonusEligibility.js';
export * from './KYCEligibility.js';
export * from './jwt.js';
