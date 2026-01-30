/**
 * KYC Shared - Client-Safe Eligibility Checker
 * 
 * This package provides client-side KYC eligibility checking
 * without any server dependencies.
 * 
 * Safe to use in:
 * - React/Vue/Angular frontend apps
 * - React Native mobile apps
 * - Node.js server code
 */

export { KYCEligibility } from './KYCEligibility.js';
export type {
  KYCTier,
  KYCStatus,
  KYCUserContext,
  TierLimits,
  EligibilityCheck,
  EligibilityResult,
} from './types.js';
