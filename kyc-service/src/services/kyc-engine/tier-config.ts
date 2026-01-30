/**
 * Tier Configuration
 * 
 * Builds tier requirements and limits based on jurisdiction
 */

import { generateId } from 'core-service';

import type {
  KYCTier,
  VerificationRequirement,
  DocumentType,
} from '../../types/kyc-types.js';
import type { TransactionLimits, OperationLimits } from '../../types/jurisdiction-config.js';

// ═══════════════════════════════════════════════════════════════════
// Default Tier Requirements
// ═══════════════════════════════════════════════════════════════════

interface TierRequirementConfig {
  documents: {
    category: 'identity' | 'address' | 'financial' | 'corporate' | 'biometric';
    types: DocumentType[];
    required: boolean;
    name: string;
  }[];
  checks: {
    type: 'aml' | 'pep' | 'sanctions' | 'liveness' | 'face_match';
    required: boolean;
    name: string;
  }[];
  information: {
    field: string;
    name: string;
    required: boolean;
  }[];
}

const DEFAULT_TIER_REQUIREMENTS: Record<KYCTier, TierRequirementConfig> = {
  none: {
    documents: [],
    checks: [],
    information: [],
  },
  
  basic: {
    documents: [],
    checks: [
      { type: 'aml', required: true, name: 'AML Screening' },
    ],
    information: [
      { field: 'personalInfo.firstName', name: 'First Name', required: true },
      { field: 'personalInfo.lastName', name: 'Last Name', required: true },
      { field: 'personalInfo.dateOfBirth', name: 'Date of Birth', required: true },
      { field: 'personalInfo.email', name: 'Email Address', required: true },
    ],
  },
  
  standard: {
    documents: [
      { 
        category: 'identity', 
        types: ['passport', 'national_id', 'drivers_license'],
        required: true,
        name: 'Government-issued ID',
      },
      {
        category: 'biometric',
        types: ['selfie'],
        required: true,
        name: 'Selfie Photo',
      },
    ],
    checks: [
      { type: 'aml', required: true, name: 'AML Screening' },
      { type: 'pep', required: true, name: 'PEP Screening' },
      { type: 'liveness', required: true, name: 'Liveness Check' },
      { type: 'face_match', required: true, name: 'Face Match' },
    ],
    information: [
      { field: 'personalInfo.firstName', name: 'First Name', required: true },
      { field: 'personalInfo.lastName', name: 'Last Name', required: true },
      { field: 'personalInfo.dateOfBirth', name: 'Date of Birth', required: true },
      { field: 'personalInfo.nationality', name: 'Nationality', required: true },
      { field: 'personalInfo.countryOfResidence', name: 'Country of Residence', required: true },
    ],
  },
  
  enhanced: {
    documents: [
      { 
        category: 'identity', 
        types: ['passport', 'national_id', 'drivers_license'],
        required: true,
        name: 'Government-issued ID',
      },
      {
        category: 'address',
        types: ['utility_bill', 'bank_statement', 'tax_document'],
        required: true,
        name: 'Proof of Address',
      },
      {
        category: 'biometric',
        types: ['selfie'],
        required: true,
        name: 'Selfie Photo',
      },
    ],
    checks: [
      { type: 'aml', required: true, name: 'AML Screening' },
      { type: 'pep', required: true, name: 'PEP Screening' },
      { type: 'sanctions', required: true, name: 'Sanctions Screening' },
      { type: 'liveness', required: true, name: 'Liveness Check' },
      { type: 'face_match', required: true, name: 'Face Match' },
    ],
    information: [
      { field: 'personalInfo.firstName', name: 'First Name', required: true },
      { field: 'personalInfo.lastName', name: 'Last Name', required: true },
      { field: 'personalInfo.dateOfBirth', name: 'Date of Birth', required: true },
      { field: 'personalInfo.nationality', name: 'Nationality', required: true },
      { field: 'personalInfo.countryOfResidence', name: 'Country of Residence', required: true },
      { field: 'addresses', name: 'Residential Address', required: true },
    ],
  },
  
  full: {
    documents: [
      { 
        category: 'identity', 
        types: ['passport', 'national_id', 'drivers_license'],
        required: true,
        name: 'Government-issued ID',
      },
      {
        category: 'address',
        types: ['utility_bill', 'bank_statement', 'tax_document'],
        required: true,
        name: 'Proof of Address',
      },
      {
        category: 'financial',
        types: ['proof_of_income', 'tax_return', 'bank_statement'],
        required: true,
        name: 'Source of Funds Documentation',
      },
      {
        category: 'biometric',
        types: ['selfie'],
        required: true,
        name: 'Selfie Photo',
      },
    ],
    checks: [
      { type: 'aml', required: true, name: 'AML Screening' },
      { type: 'pep', required: true, name: 'PEP Screening' },
      { type: 'sanctions', required: true, name: 'Sanctions Screening' },
      { type: 'liveness', required: true, name: 'Liveness Check' },
      { type: 'face_match', required: true, name: 'Face Match' },
    ],
    information: [
      { field: 'personalInfo.firstName', name: 'First Name', required: true },
      { field: 'personalInfo.lastName', name: 'Last Name', required: true },
      { field: 'personalInfo.dateOfBirth', name: 'Date of Birth', required: true },
      { field: 'personalInfo.nationality', name: 'Nationality', required: true },
      { field: 'personalInfo.countryOfResidence', name: 'Country of Residence', required: true },
      { field: 'addresses', name: 'Residential Address', required: true },
      { field: 'personalInfo.occupation', name: 'Occupation', required: true },
      { field: 'sourceOfFunds', name: 'Source of Funds', required: true },
    ],
  },
  
  professional: {
    documents: [
      { 
        category: 'identity', 
        types: ['passport', 'national_id', 'drivers_license'],
        required: true,
        name: 'Government-issued ID (Authorized Person)',
      },
      {
        category: 'corporate',
        types: ['company_registration', 'articles_of_incorporation'],
        required: true,
        name: 'Company Registration Documents',
      },
      {
        category: 'corporate',
        types: ['shareholder_register', 'beneficial_owner_declaration'],
        required: true,
        name: 'Beneficial Owner Documentation',
      },
      {
        category: 'address',
        types: ['utility_bill', 'bank_statement'],
        required: true,
        name: 'Proof of Business Address',
      },
    ],
    checks: [
      { type: 'aml', required: true, name: 'AML Screening' },
      { type: 'pep', required: true, name: 'PEP Screening (Directors & UBOs)' },
      { type: 'sanctions', required: true, name: 'Sanctions Screening' },
    ],
    information: [
      { field: 'businessInfo.companyName', name: 'Company Name', required: true },
      { field: 'businessInfo.registrationNumber', name: 'Registration Number', required: true },
      { field: 'businessInfo.registrationCountry', name: 'Country of Registration', required: true },
      { field: 'businessInfo.companyType', name: 'Company Type', required: true },
      { field: 'businessInfo.beneficialOwners', name: 'Beneficial Owners', required: true },
      { field: 'businessInfo.directors', name: 'Directors', required: true },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// Default Tier Limits (EUR)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_TIER_LIMITS: Record<KYCTier, TransactionLimits> = {
  none: {
    currency: 'EUR',
    deposit: {
      minAmount: 10,
      maxAmount: 0, // Not allowed
      dailyLimit: 0,
      monthlyLimit: 0,
    },
    withdrawal: {
      minAmount: 10,
      maxAmount: 0,
      dailyLimit: 0,
      monthlyLimit: 0,
    },
  },
  
  basic: {
    currency: 'EUR',
    deposit: {
      minAmount: 10,
      maxAmount: 1000,
      dailyLimit: 2000,
      monthlyLimit: 5000,
    },
    withdrawal: {
      minAmount: 10,
      maxAmount: 500,
      dailyLimit: 1000,
      monthlyLimit: 2500,
    },
    transfer: {
      minAmount: 10,
      maxAmount: 500,
      dailyLimit: 1000,
      monthlyLimit: 2500,
    },
    maxBalance: 5000,
  },
  
  standard: {
    currency: 'EUR',
    deposit: {
      minAmount: 10,
      maxAmount: 5000,
      dailyLimit: 10000,
      monthlyLimit: 25000,
    },
    withdrawal: {
      minAmount: 10,
      maxAmount: 2500,
      dailyLimit: 5000,
      monthlyLimit: 15000,
    },
    transfer: {
      minAmount: 10,
      maxAmount: 2500,
      dailyLimit: 5000,
      monthlyLimit: 15000,
    },
    maxBalance: 50000,
  },
  
  enhanced: {
    currency: 'EUR',
    deposit: {
      minAmount: 10,
      maxAmount: 25000,
      dailyLimit: 50000,
      monthlyLimit: 150000,
    },
    withdrawal: {
      minAmount: 10,
      maxAmount: 15000,
      dailyLimit: 30000,
      monthlyLimit: 100000,
    },
    transfer: {
      minAmount: 10,
      maxAmount: 15000,
      dailyLimit: 30000,
      monthlyLimit: 100000,
    },
    maxBalance: 250000,
  },
  
  full: {
    currency: 'EUR',
    deposit: {
      minAmount: 10,
      maxAmount: 100000,
      dailyLimit: 250000,
      monthlyLimit: 1000000,
    },
    withdrawal: {
      minAmount: 10,
      maxAmount: 50000,
      dailyLimit: 150000,
      monthlyLimit: 500000,
    },
    transfer: {
      minAmount: 10,
      maxAmount: 50000,
      dailyLimit: 150000,
      monthlyLimit: 500000,
    },
  },
  
  professional: {
    currency: 'EUR',
    deposit: {
      minAmount: 100,
      maxAmount: 1000000,
      dailyLimit: 5000000,
      monthlyLimit: 50000000,
    },
    withdrawal: {
      minAmount: 100,
      maxAmount: 500000,
      dailyLimit: 2500000,
      monthlyLimit: 25000000,
    },
    transfer: {
      minAmount: 100,
      maxAmount: 500000,
      dailyLimit: 2500000,
      monthlyLimit: 25000000,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

/**
 * Build verification requirements for a tier
 */
export async function buildTierRequirements(
  tier: KYCTier,
  jurisdictionCode: string
): Promise<VerificationRequirement[]> {
  // TODO: Load jurisdiction-specific config from database
  const config = DEFAULT_TIER_REQUIREMENTS[tier];
  
  const requirements: VerificationRequirement[] = [];
  let order = 0;
  
  // Document requirements
  for (const doc of config.documents) {
    requirements.push({
      id: generateId(),
      type: 'document',
      name: doc.name,
      documentTypes: doc.types,
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
      name: info.name,
      fields: [info.field],
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
  jurisdictionCode: string
): Promise<TransactionLimits> {
  // TODO: Load jurisdiction-specific limits from database
  return DEFAULT_TIER_LIMITS[tier];
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: KYCTier): string {
  const names: Record<KYCTier, string> = {
    none: 'Unverified',
    basic: 'Basic',
    standard: 'Standard',
    enhanced: 'Enhanced',
    full: 'Full',
    professional: 'Professional',
  };
  return names[tier];
}

/**
 * Get tier description
 */
export function getTierDescription(tier: KYCTier): string {
  const descriptions: Record<KYCTier, string> = {
    none: 'No verification completed',
    basic: 'Email and phone verified',
    standard: 'Government-issued ID verified',
    enhanced: 'ID and address verified',
    full: 'Full KYC with source of funds',
    professional: 'Corporate/institutional verification',
  };
  return descriptions[tier];
}
