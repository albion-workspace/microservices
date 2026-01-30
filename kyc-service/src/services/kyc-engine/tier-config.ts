/**
 * Tier Configuration
 * 
 * Wrapper around KYCEligibility from shared-validators.
 * Provides async functions for future database-backed configurations.
 */

import { generateId } from 'core-service';
import { KYCEligibility } from 'shared-validators';

import type {
  KYCTier,
  VerificationRequirement,
} from '../../types/kyc-types.js';
import type { TransactionLimits } from '../../types/jurisdiction-config.js';

// ═══════════════════════════════════════════════════════════════════
// Exports (wrap KYCEligibility for async/DB support)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build verification requirements for a tier
 */
export async function buildTierRequirements(
  tier: KYCTier,
  _jurisdictionCode: string
): Promise<VerificationRequirement[]> {
  // TODO: Load jurisdiction-specific config from database
  const config = KYCEligibility.getTierRequirements(tier);
  
  const requirements: VerificationRequirement[] = [];
  let order = 0;
  
  // Document requirements
  for (const doc of config.documents) {
    requirements.push({
      id: generateId(),
      type: 'document',
      name: doc.name,
      documentTypes: doc.acceptedTypes,
      documentCategory: doc.category,
      status: 'pending',
      optional: !doc.required,
      order: order++,
    });
  }
  
  // Check requirements
  for (const check of config.checks) {
    requirements.push({
      id: generateId(),
      type: 'check',
      name: check.name,
      checkType: check.type,
      status: 'pending',
      optional: !check.required,
      order: order++,
    });
  }
  
  // Information requirements
  for (const info of config.information) {
    requirements.push({
      id: generateId(),
      type: 'information',
      name: info.displayName,
      fields: [info.fieldPath],
      status: 'pending',
      optional: !info.required,
      order: order++,
    });
  }
  
  return requirements;
}

/**
 * Get limits for a tier
 */
export async function getTierLimits(
  tier: KYCTier,
  _jurisdictionCode: string
): Promise<TransactionLimits> {
  // TODO: Load jurisdiction-specific limits from database
  return KYCEligibility.getTierLimits(tier) as TransactionLimits;
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: KYCTier): string {
  return KYCEligibility.getTierDisplayName(tier);
}

/**
 * Get tier description
 */
export function getTierDescription(tier: KYCTier): string {
  return KYCEligibility.getTierDescription(tier);
}

// Re-export KYCEligibility for direct use
export { KYCEligibility };
