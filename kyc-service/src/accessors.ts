/**
 * KYC service accessors (db + redis) from one factory call.
 * Per-service database: kyc_service.
 * Domain: COLLECTIONS and registerKYCIndexes exported here.
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('kyc-service');

/** Collection names */
export const COLLECTIONS = {
  PROFILES: 'kyc_profiles',
  DOCUMENTS: 'kyc_documents',
  VERIFICATIONS: 'kyc_verifications',
  AML_CHECKS: 'kyc_aml_checks',
  PEP_SCREENINGS: 'kyc_pep_screenings',
  SANCTION_SCREENINGS: 'kyc_sanction_screenings',
  RISK_ASSESSMENTS: 'kyc_risk_assessments',
  SOURCE_OF_FUNDS: 'kyc_source_of_funds',
  BUSINESS_KYC: 'kyc_business',
  JURISDICTION_CONFIGS: 'kyc_jurisdiction_configs',
  DOMAIN_CONFIGS: 'kyc_domain_configs',
} as const;

/** Register indexes for KYC collections */
export function registerKYCIndexes(): void {
  db.registerIndexes(COLLECTIONS.PROFILES, [
    { key: { userId: 1, tenantId: 1 }, unique: true },
    { key: { tenantId: 1 } },
    { key: { status: 1, tenantId: 1 } },
    { key: { currentTier: 1, tenantId: 1 } },
    { key: { riskLevel: 1, tenantId: 1 } },
    { key: { expiresAt: 1 }, sparse: true },
    { key: { nextReviewAt: 1 }, sparse: true },
    { key: { 'providerReferences.provider': 1, 'providerReferences.externalId': 1 } },
    { key: { isPEP: 1, tenantId: 1 }, sparse: true },
    { key: { isHighRisk: 1, tenantId: 1 }, sparse: true },
  ]);
  db.registerIndexes(COLLECTIONS.DOCUMENTS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, type: 1 } },
    { key: { status: 1 } },
    { key: { expiresAt: 1 }, sparse: true },
    { key: { providerDocumentId: 1 }, sparse: true },
  ]);
  db.registerIndexes(COLLECTIONS.VERIFICATIONS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, status: 1 } },
    { key: { 'providerSession.sessionId': 1 }, sparse: true },
    { key: { expiresAt: 1 } },
    { key: { status: 1, expiresAt: 1 } },
  ]);
  db.registerIndexes(COLLECTIONS.AML_CHECKS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, type: 1 } },
    { key: { status: 1 } },
    { key: { nextScheduledAt: 1 }, sparse: true },
    { key: { providerCheckId: 1 }, sparse: true },
  ]);
  db.registerIndexes(COLLECTIONS.PEP_SCREENINGS, [
    { key: { profileId: 1 } },
    { key: { isPEP: 1 } },
    { key: { providerCheckId: 1 }, sparse: true },
  ]);
  db.registerIndexes(COLLECTIONS.SANCTION_SCREENINGS, [
    { key: { profileId: 1 } },
    { key: { result: 1 } },
    { key: { providerCheckId: 1 }, sparse: true },
  ]);
  db.registerIndexes(COLLECTIONS.RISK_ASSESSMENTS, [
    { key: { profileId: 1 } },
    { key: { profileId: 1, type: 1 } },
    { key: { level: 1 } },
    { key: { reviewRequired: 1, reviewedAt: 1 } },
  ]);
  db.registerIndexes(COLLECTIONS.SOURCE_OF_FUNDS, [
    { key: { profileId: 1 } },
    { key: { status: 1 } },
  ]);
  db.registerIndexes(COLLECTIONS.BUSINESS_KYC, [
    { key: { profileId: 1 }, unique: true },
    { key: { registrationNumber: 1, registrationCountry: 1 } },
    { key: { status: 1 } },
  ]);
  db.registerIndexes(COLLECTIONS.JURISDICTION_CONFIGS, [
    { key: { code: 1 }, unique: true },
    { key: { isActive: 1 } },
  ]);
  db.registerIndexes(COLLECTIONS.DOMAIN_CONFIGS, [
    { key: { domain: 1 }, unique: true },
    { key: { isActive: 1 } },
  ]);
}
