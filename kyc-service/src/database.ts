/**
 * KYC Service Database Accessor
 * 
 * Uses core-service database patterns for consistency
 */

import { createServiceDatabaseAccess } from 'core-service';

/**
 * KYC Service Database Accessor
 * 
 * Follows per-service database strategy (kyc_service database)
 */
export const db = createServiceDatabaseAccess('kyc-service');

/**
 * Collection names
 */
export const COLLECTIONS = {
  /** KYC profiles */
  PROFILES: 'kyc_profiles',
  
  /** KYC documents */
  DOCUMENTS: 'kyc_documents',
  
  /** KYC verifications (verification attempts/sessions) */
  VERIFICATIONS: 'kyc_verifications',
  
  /** AML checks */
  AML_CHECKS: 'kyc_aml_checks',
  
  /** PEP screenings */
  PEP_SCREENINGS: 'kyc_pep_screenings',
  
  /** Sanction screenings */
  SANCTION_SCREENINGS: 'kyc_sanction_screenings',
  
  /** Risk assessments */
  RISK_ASSESSMENTS: 'kyc_risk_assessments',
  
  /** Source of funds declarations */
  SOURCE_OF_FUNDS: 'kyc_source_of_funds',
  
  /** Business KYC */
  BUSINESS_KYC: 'kyc_business',
  
  /** Jurisdiction configurations */
  JURISDICTION_CONFIGS: 'kyc_jurisdiction_configs',
  
  /** Domain configurations */
  DOMAIN_CONFIGS: 'kyc_domain_configs',
} as const;

/**
 * Register indexes for KYC collections
 */
export function registerKYCIndexes(): void {
  // KYC Profiles
  db.registerIndexes(COLLECTIONS.PROFILES, [
    // Primary lookups
    { key: { userId: 1, tenantId: 1 }, unique: true },
    { key: { tenantId: 1 } },
    
    // Status queries
    { key: { status: 1, tenantId: 1 } },
    { key: { currentTier: 1, tenantId: 1 } },
    { key: { riskLevel: 1, tenantId: 1 } },
    
    // Expiration
    { key: { expiresAt: 1 }, sparse: true },
    { key: { nextReviewAt: 1 }, sparse: true },
    
    // Provider sync
    { key: { 'providerReferences.provider': 1, 'providerReferences.externalId': 1 } },
    
    // Flags
    { key: { isPEP: 1, tenantId: 1 }, sparse: true },
    { key: { isHighRisk: 1, tenantId: 1 }, sparse: true },
  ]);
  
  // Documents
  db.registerIndexes(COLLECTIONS.DOCUMENTS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, type: 1 } },
    { key: { status: 1 } },
    { key: { expiresAt: 1 }, sparse: true },
    { key: { providerDocumentId: 1 }, sparse: true },
  ]);
  
  // Verifications
  db.registerIndexes(COLLECTIONS.VERIFICATIONS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, status: 1 } },
    { key: { 'providerSession.sessionId': 1 }, sparse: true },
    { key: { expiresAt: 1 } },
    { key: { status: 1, expiresAt: 1 } },
  ]);
  
  // AML Checks
  db.registerIndexes(COLLECTIONS.AML_CHECKS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, type: 1 } },
    { key: { status: 1 } },
    { key: { nextScheduledAt: 1 }, sparse: true },
    { key: { providerCheckId: 1 }, sparse: true },
  ]);
  
  // PEP Screenings
  db.registerIndexes(COLLECTIONS.PEP_SCREENINGS, [
    { key: { profileId: 1 } },
    { key: { isPEP: 1 } },
    { key: { providerCheckId: 1 }, sparse: true },
  ]);
  
  // Sanction Screenings
  db.registerIndexes(COLLECTIONS.SANCTION_SCREENINGS, [
    { key: { profileId: 1 } },
    { key: { result: 1 } },
    { key: { providerCheckId: 1 }, sparse: true },
  ]);
  
  // Risk Assessments
  db.registerIndexes(COLLECTIONS.RISK_ASSESSMENTS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, type: 1 } },
    { key: { level: 1 } },
    { key: { reviewRequired: 1, reviewedAt: 1 } },
  ]);
  
  // Source of Funds
  db.registerIndexes(COLLECTIONS.SOURCE_OF_FUNDS, [
    { key: { profileId: 1 } },
    { key: { status: 1 } },
  ]);
  
  // Business KYC
  db.registerIndexes(COLLECTIONS.BUSINESS_KYC, [
    { key: { profileId: 1 }, unique: true },
    { key: { registrationNumber: 1, registrationCountry: 1 } },
    { key: { status: 1 } },
  ]);
  
  // Jurisdiction Configs
  db.registerIndexes(COLLECTIONS.JURISDICTION_CONFIGS, [
    { key: { code: 1 }, unique: true },
    { key: { isActive: 1 } },
  ]);
  
  // Domain Configs
  db.registerIndexes(COLLECTIONS.DOMAIN_CONFIGS, [
    { key: { domain: 1 }, unique: true },
    { key: { isActive: 1 } },
  ]);
}
