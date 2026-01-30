/**
 * Default Jurisdiction Configurations
 * 
 * Pre-configured KYC requirements for common jurisdictions
 */

import type { JurisdictionConfig } from '../types/jurisdiction-config.js';

// ═══════════════════════════════════════════════════════════════════
// Default Jurisdiction Configurations
// ═══════════════════════════════════════════════════════════════════

/**
 * United States (US)
 * - FINCEN CIP requirements
 * - BSA/AML compliance
 */
export const US_JURISDICTION: Partial<JurisdictionConfig> = {
  code: 'US',
  name: 'United States',
  region: 'NA',
  regulatoryBody: 'FINCEN',
  regulatoryFramework: ['BSA', 'AML', 'CIP'],
  
  amlRequirements: {
    initialScreeningRequired: true,
    initialScreeningTier: 'standard',
    periodicScreeningRequired: true,
    periodicScreeningInterval: 365,
    pepScreeningRequired: true,
    pepScreeningInterval: 180,
    pepEnhancedDueDiligence: true,
    sanctionScreeningRequired: true,
    sanctionLists: ['OFAC', 'UN'],
    sourceOfFundsRequired: true,
    sourceOfFundsThreshold: 10000,
    sourceOfFundsCurrency: 'USD',
    eddTriggers: [
      { type: 'pep', description: 'Customer is a PEP', automatic: true },
      { type: 'high_value', description: 'Transaction over $10,000', automatic: true, threshold: 10000 },
      { type: 'high_risk_country', description: 'High-risk country involvement', automatic: true },
    ],
    transactionMonitoringRequired: true,
    sarThreshold: 5000,
  },
  
  specialRules: {
    minimumAge: 18,
    requireLocalResidence: false,
    requireLocalAddress: false,
    requireLocalBankAccount: false,
    restrictedNationalities: ['KP', 'IR', 'SY', 'CU'],
    highRiskCountries: ['AF', 'BY', 'MM', 'KP', 'IR', 'RU', 'SY'],
    blockedCountries: ['KP', 'IR', 'SY', 'CU'],
    uboThreshold: 25,
  },
  
  riskConfig: {
    baseRiskScore: 20,
    riskCategory: 'low',
    fatfStatus: 'member',
    multipliers: {
      pep: 2.0,
      highRiskCountry: 2.5,
      complexStructure: 1.5,
      highValue: 1.3,
      cashIntensive: 1.8,
      cryptoRelated: 1.5,
    },
    thresholds: {
      lowRisk: 25,
      mediumRisk: 50,
      highRisk: 75,
      criticalRisk: 90,
    },
    autoActions: {
      highRisk: ['manual_review', 'enhanced_monitoring'],
      criticalRisk: ['manual_review', 'account_suspension'],
    },
  },
  
  isActive: true,
};

/**
 * European Union (Generic)
 * - 6AMLD compliance
 * - GDPR compliance
 */
export const EU_JURISDICTION: Partial<JurisdictionConfig> = {
  code: 'EU',
  name: 'European Union',
  region: 'EU',
  regulatoryBody: 'EBA',
  regulatoryFramework: ['6AMLD', 'GDPR', 'MiCA'],
  
  amlRequirements: {
    initialScreeningRequired: true,
    initialScreeningTier: 'standard',
    periodicScreeningRequired: true,
    periodicScreeningInterval: 365,
    pepScreeningRequired: true,
    pepScreeningInterval: 180,
    pepEnhancedDueDiligence: true,
    sanctionScreeningRequired: true,
    sanctionLists: ['EU', 'UN', 'OFAC'],
    sourceOfFundsRequired: true,
    sourceOfFundsThreshold: 15000,
    sourceOfFundsCurrency: 'EUR',
    eddTriggers: [
      { type: 'pep', description: 'Customer is a PEP', automatic: true },
      { type: 'high_value', description: 'Transaction over €15,000', automatic: true, threshold: 15000 },
      { type: 'high_risk_country', description: 'High-risk third country', automatic: true },
    ],
    transactionMonitoringRequired: true,
  },
  
  specialRules: {
    minimumAge: 18,
    requireLocalResidence: false,
    requireLocalAddress: false,
    requireLocalBankAccount: false,
    restrictedNationalities: ['KP', 'IR', 'SY'],
    highRiskCountries: ['AF', 'BY', 'MM', 'KP', 'IR', 'RU', 'SY'],
    blockedCountries: ['KP', 'IR', 'SY'],
    uboThreshold: 25,
  },
  
  riskConfig: {
    baseRiskScore: 15,
    riskCategory: 'low',
    fatfStatus: 'member',
    multipliers: {
      pep: 2.0,
      highRiskCountry: 2.5,
      complexStructure: 1.5,
      highValue: 1.3,
      cashIntensive: 1.8,
      cryptoRelated: 1.5,
    },
    thresholds: {
      lowRisk: 25,
      mediumRisk: 50,
      highRisk: 75,
      criticalRisk: 90,
    },
    autoActions: {
      highRisk: ['manual_review', 'enhanced_monitoring'],
      criticalRisk: ['manual_review', 'account_suspension', 'report_to_authority'],
    },
  },
  
  isActive: true,
};

/**
 * Malta (MGA - Gaming)
 * - MGA requirements for iGaming
 * - Strong AML focus
 */
export const MT_JURISDICTION: Partial<JurisdictionConfig> = {
  code: 'MT',
  name: 'Malta',
  region: 'EU',
  regulatoryBody: 'MGA',
  regulatoryFramework: ['MGA', '6AMLD', 'GDPR'],
  
  amlRequirements: {
    initialScreeningRequired: true,
    initialScreeningTier: 'standard',
    periodicScreeningRequired: true,
    periodicScreeningInterval: 180,
    pepScreeningRequired: true,
    pepScreeningInterval: 90,
    pepEnhancedDueDiligence: true,
    sanctionScreeningRequired: true,
    sanctionLists: ['EU', 'UN', 'OFAC', 'UK'],
    sourceOfFundsRequired: true,
    sourceOfFundsThreshold: 2000,
    sourceOfFundsCurrency: 'EUR',
    eddTriggers: [
      { type: 'pep', description: 'Customer is a PEP', automatic: true },
      { type: 'high_value', description: 'Deposits over €2,000', automatic: true, threshold: 2000 },
      { type: 'high_risk_country', description: 'High-risk jurisdiction', automatic: true },
      { type: 'unusual_activity', description: 'Unusual gambling patterns', automatic: false },
    ],
    transactionMonitoringRequired: true,
  },
  
  specialRules: {
    minimumAge: 18,
    requireLocalResidence: false,
    requireLocalAddress: false,
    requireLocalBankAccount: false,
    restrictedNationalities: ['KP', 'IR', 'SY', 'US'],
    highRiskCountries: ['AF', 'BY', 'MM', 'KP', 'IR', 'RU', 'SY'],
    blockedCountries: ['KP', 'IR', 'SY', 'US'],
    selfExclusionRequired: true,
    selfExclusionDatabases: ['MGA-SE'],
    coolingOffRequired: true,
    coolingOffPeriodHours: 24,
    responsibleGamblingRequired: true,
    depositLimitRequired: true,
    lossLimitRequired: true,
    realityCheckRequired: true,
    realityCheckInterval: 60,
    uboThreshold: 25,
  },
  
  riskConfig: {
    baseRiskScore: 25,
    riskCategory: 'medium',
    fatfStatus: 'member',
    multipliers: {
      pep: 2.5,
      highRiskCountry: 3.0,
      complexStructure: 1.5,
      highValue: 1.5,
      cashIntensive: 2.0,
      cryptoRelated: 1.8,
    },
    thresholds: {
      lowRisk: 25,
      mediumRisk: 50,
      highRisk: 70,
      criticalRisk: 85,
    },
    autoActions: {
      highRisk: ['manual_review', 'enhanced_monitoring', 'limit_reduction'],
      criticalRisk: ['manual_review', 'account_suspension', 'report_to_authority'],
    },
  },
  
  isActive: true,
};

/**
 * United Kingdom (UKGC - Gaming)
 * - UKGC license requirements
 * - Strong player protection
 */
export const GB_JURISDICTION: Partial<JurisdictionConfig> = {
  code: 'GB',
  name: 'United Kingdom',
  region: 'EU',
  regulatoryBody: 'UKGC',
  regulatoryFramework: ['UKGC', 'MLR', 'GDPR'],
  
  amlRequirements: {
    initialScreeningRequired: true,
    initialScreeningTier: 'standard',
    periodicScreeningRequired: true,
    periodicScreeningInterval: 365,
    pepScreeningRequired: true,
    pepScreeningInterval: 180,
    pepEnhancedDueDiligence: true,
    sanctionScreeningRequired: true,
    sanctionLists: ['UK', 'EU', 'UN', 'OFAC'],
    sourceOfFundsRequired: true,
    sourceOfFundsThreshold: 2000,
    sourceOfFundsCurrency: 'GBP',
    eddTriggers: [
      { type: 'pep', description: 'Customer is a PEP', automatic: true },
      { type: 'high_value', description: 'Customer spends over £2,000', automatic: true, threshold: 2000 },
      { type: 'high_risk_country', description: 'High-risk jurisdiction', automatic: true },
    ],
    transactionMonitoringRequired: true,
  },
  
  specialRules: {
    minimumAge: 18,
    requireLocalResidence: false,
    requireLocalAddress: false,
    requireLocalBankAccount: false,
    restrictedNationalities: ['KP', 'IR', 'SY'],
    highRiskCountries: ['AF', 'BY', 'MM', 'KP', 'IR', 'RU', 'SY'],
    blockedCountries: ['KP', 'IR', 'SY'],
    selfExclusionRequired: true,
    selfExclusionDatabases: ['GAMSTOP'],
    coolingOffRequired: true,
    coolingOffPeriodHours: 24,
    responsibleGamblingRequired: true,
    depositLimitRequired: true,
    lossLimitRequired: true,
    realityCheckRequired: true,
    realityCheckInterval: 60,
    uboThreshold: 25,
  },
  
  riskConfig: {
    baseRiskScore: 20,
    riskCategory: 'low',
    fatfStatus: 'member',
    multipliers: {
      pep: 2.0,
      highRiskCountry: 2.5,
      complexStructure: 1.5,
      highValue: 1.3,
      cashIntensive: 1.8,
      cryptoRelated: 1.5,
    },
    thresholds: {
      lowRisk: 25,
      mediumRisk: 50,
      highRisk: 75,
      criticalRisk: 90,
    },
    autoActions: {
      highRisk: ['manual_review', 'enhanced_monitoring'],
      criticalRisk: ['manual_review', 'account_suspension', 'report_to_authority'],
    },
  },
  
  isActive: true,
};

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_JURISDICTIONS: Partial<JurisdictionConfig>[] = [
  US_JURISDICTION,
  EU_JURISDICTION,
  MT_JURISDICTION,
  GB_JURISDICTION,
];

export function getDefaultJurisdiction(code: string): Partial<JurisdictionConfig> | undefined {
  return DEFAULT_JURISDICTIONS.find(j => j.code === code);
}
