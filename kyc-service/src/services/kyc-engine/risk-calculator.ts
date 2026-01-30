/**
 * Risk Calculator
 * 
 * Calculates risk scores for KYC profiles
 */

import { generateId } from 'core-service';

import type {
  KYCProfile,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
} from '../../types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Risk Configuration
// ═══════════════════════════════════════════════════════════════════

const HIGH_RISK_COUNTRIES = [
  'AF', // Afghanistan
  'BY', // Belarus
  'MM', // Myanmar
  'CF', // Central African Republic
  'CD', // DR Congo
  'IR', // Iran
  'IQ', // Iraq
  'LB', // Lebanon
  'LY', // Libya
  'ML', // Mali
  'NI', // Nicaragua
  'KP', // North Korea
  'PK', // Pakistan
  'RU', // Russia
  'SO', // Somalia
  'SS', // South Sudan
  'SD', // Sudan
  'SY', // Syria
  'VE', // Venezuela
  'YE', // Yemen
  'ZW', // Zimbabwe
];

const FATF_GREY_LIST = [
  'AE', // UAE
  'BF', // Burkina Faso
  'CM', // Cameroon
  'CD', // DR Congo
  'HT', // Haiti
  'KE', // Kenya
  'ML', // Mali
  'MZ', // Mozambique
  'NG', // Nigeria
  'PH', // Philippines
  'SN', // Senegal
  'ZA', // South Africa
  'SS', // South Sudan
  'TZ', // Tanzania
  'VN', // Vietnam
];

const RISK_WEIGHTS = {
  geography: 0.25,
  customerType: 0.20,
  activity: 0.25,
  product: 0.15,
  compliance: 0.15,
};

// ═══════════════════════════════════════════════════════════════════
// Risk Calculator
// ═══════════════════════════════════════════════════════════════════

/**
 * Calculate risk score for a KYC profile
 */
export async function calculateRiskScore(profile: KYCProfile): Promise<RiskAssessment> {
  const factors: RiskFactor[] = [];
  
  // 1. Geography Risk
  const geoFactors = assessGeographyRisk(profile);
  factors.push(...geoFactors);
  
  // 2. Customer Type Risk
  const customerFactors = assessCustomerTypeRisk(profile);
  factors.push(...customerFactors);
  
  // 3. Activity Risk (placeholder - would need transaction data)
  const activityFactors = assessActivityRisk(profile);
  factors.push(...activityFactors);
  
  // 4. Product Risk
  const productFactors = assessProductRisk(profile);
  factors.push(...productFactors);
  
  // 5. Compliance Risk
  const complianceFactors = assessComplianceRisk(profile);
  factors.push(...complianceFactors);
  
  // Calculate total score
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedScore = factors.reduce((sum, f) => sum + f.weightedScore, 0);
  const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight * 100) / 100 : 0;
  
  // Normalize to 0-100
  const normalizedScore = Math.min(100, Math.max(0, score));
  
  // Determine level
  const level = scoreToLevel(normalizedScore);
  
  // Build recommendations
  const recommendations = buildRecommendations(factors, level);
  
  return {
    id: generateId(),
    profileId: profile.id,
    type: 'triggered',
    factors,
    score: normalizedScore,
    level,
    recommendations,
    reviewRequired: level === 'high' || level === 'critical',
    assessedAt: new Date(),
    assessedBy: 'system',
  };
}

// ═══════════════════════════════════════════════════════════════════
// Risk Factor Assessment
// ═══════════════════════════════════════════════════════════════════

function assessGeographyRisk(profile: KYCProfile): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const weight = RISK_WEIGHTS.geography;
  
  // Nationality risk
  const nationality = profile.personalInfo?.nationality;
  if (nationality) {
    let score = 10; // Base score
    let isHighRisk = false;
    let details = 'Standard risk country';
    
    if (HIGH_RISK_COUNTRIES.includes(nationality)) {
      score = 80;
      isHighRisk = true;
      details = 'High-risk country (sanctions/conflict)';
    } else if (FATF_GREY_LIST.includes(nationality)) {
      score = 50;
      isHighRisk = false;
      details = 'FATF grey list country';
    }
    
    factors.push({
      id: generateId(),
      category: 'geography',
      name: 'Nationality',
      weight,
      score,
      weightedScore: weight * score,
      details,
      isHighRisk,
    });
  }
  
  // Country of residence risk
  const residence = profile.personalInfo?.countryOfResidence;
  if (residence && residence !== nationality) {
    let score = 10;
    let isHighRisk = false;
    let details = 'Standard risk country';
    
    if (HIGH_RISK_COUNTRIES.includes(residence)) {
      score = 80;
      isHighRisk = true;
      details = 'Resides in high-risk country';
    } else if (FATF_GREY_LIST.includes(residence)) {
      score = 50;
      details = 'Resides in FATF grey list country';
    }
    
    factors.push({
      id: generateId(),
      category: 'geography',
      name: 'Country of Residence',
      weight: weight * 0.5,
      score,
      weightedScore: weight * 0.5 * score,
      details,
      isHighRisk,
    });
  }
  
  return factors;
}

function assessCustomerTypeRisk(profile: KYCProfile): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const weight = RISK_WEIGHTS.customerType;
  
  // PEP status
  if (profile.isPEP) {
    factors.push({
      id: generateId(),
      category: 'customer_type',
      name: 'Politically Exposed Person',
      weight: weight * 2, // Double weight for PEP
      score: 75,
      weightedScore: weight * 2 * 75,
      details: 'Customer is a PEP or related to a PEP',
      isHighRisk: true,
    });
  }
  
  // Business account
  if (profile.businessInfo) {
    let score = 30;
    let details = 'Standard business account';
    
    // Complex ownership structure
    if (profile.businessInfo.beneficialOwners.length > 3) {
      score += 20;
      details = 'Complex ownership structure (multiple UBOs)';
    }
    
    factors.push({
      id: generateId(),
      category: 'customer_type',
      name: 'Business Account',
      weight,
      score,
      weightedScore: weight * score,
      details,
      isHighRisk: score > 50,
    });
  }
  
  // Account age (new accounts are higher risk)
  const accountAgeDays = Math.floor((Date.now() - profile.createdAt.getTime()) / (24 * 60 * 60 * 1000));
  if (accountAgeDays < 30) {
    factors.push({
      id: generateId(),
      category: 'customer_type',
      name: 'New Account',
      weight: weight * 0.3,
      score: 40,
      weightedScore: weight * 0.3 * 40,
      details: `Account age: ${accountAgeDays} days`,
      isHighRisk: false,
    });
  }
  
  return factors;
}

function assessActivityRisk(profile: KYCProfile): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const weight = RISK_WEIGHTS.activity;
  
  // TODO: Would need transaction data from payment service
  // For now, return base activity score
  
  factors.push({
    id: generateId(),
    category: 'activity',
    name: 'Transaction Activity',
    weight,
    score: 20, // Base score
    weightedScore: weight * 20,
    details: 'Normal transaction activity',
    isHighRisk: false,
  });
  
  return factors;
}

function assessProductRisk(profile: KYCProfile): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const weight = RISK_WEIGHTS.product;
  
  // Tier-based product risk
  const tierRisk: Record<string, number> = {
    none: 10,
    basic: 20,
    standard: 25,
    enhanced: 30,
    full: 35,
    professional: 40,
  };
  
  const score = tierRisk[profile.currentTier] ?? 20;
  
  factors.push({
    id: generateId(),
    category: 'product',
    name: 'Account Tier',
    weight,
    score,
    weightedScore: weight * score,
    details: `${profile.currentTier} tier account`,
    isHighRisk: false,
  });
  
  return factors;
}

function assessComplianceRisk(profile: KYCProfile): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const weight = RISK_WEIGHTS.compliance;
  
  // AML check results
  const latestAMLCheck = profile.amlChecks[profile.amlChecks.length - 1];
  if (latestAMLCheck) {
    let score = 10;
    let details = 'AML check clear';
    let isHighRisk = false;
    
    if (latestAMLCheck.status === 'potential_match') {
      score = 60;
      details = 'Potential AML match found';
      isHighRisk = true;
    } else if (latestAMLCheck.status === 'match') {
      score = 90;
      details = 'AML match found';
      isHighRisk = true;
    }
    
    factors.push({
      id: generateId(),
      category: 'compliance',
      name: 'AML Screening',
      weight,
      score,
      weightedScore: weight * score,
      details,
      isHighRisk,
    });
  }
  
  // Sanction check results
  const latestSanctionCheck = profile.sanctionScreenings[profile.sanctionScreenings.length - 1];
  if (latestSanctionCheck) {
    let score = 10;
    let details = 'Sanction check clear';
    let isHighRisk = false;
    
    if (latestSanctionCheck.result === 'potential_match') {
      score = 70;
      details = 'Potential sanction match found';
      isHighRisk = true;
    } else if (latestSanctionCheck.result === 'match') {
      score = 100;
      details = 'Sanction match found';
      isHighRisk = true;
    }
    
    factors.push({
      id: generateId(),
      category: 'compliance',
      name: 'Sanction Screening',
      weight: weight * 1.5, // Higher weight for sanctions
      score,
      weightedScore: weight * 1.5 * score,
      details,
      isHighRisk,
    });
  }
  
  // Verification status
  if (profile.status !== 'approved') {
    factors.push({
      id: generateId(),
      category: 'compliance',
      name: 'Verification Status',
      weight: weight * 0.5,
      score: profile.status === 'pending' ? 30 : profile.status === 'rejected' ? 70 : 50,
      weightedScore: weight * 0.5 * (profile.status === 'pending' ? 30 : profile.status === 'rejected' ? 70 : 50),
      details: `KYC status: ${profile.status}`,
      isHighRisk: profile.status === 'rejected' || profile.status === 'suspended',
    });
  }
  
  return factors;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function scoreToLevel(score: number): RiskLevel {
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

function buildRecommendations(factors: RiskFactor[], level: RiskLevel): string[] {
  const recommendations: string[] = [];
  
  // High risk factors
  const highRiskFactors = factors.filter(f => f.isHighRisk);
  
  for (const factor of highRiskFactors) {
    switch (factor.category) {
      case 'geography':
        recommendations.push('Review customer documentation for residence/nationality');
        break;
      case 'customer_type':
        if (factor.name === 'Politically Exposed Person') {
          recommendations.push('Conduct Enhanced Due Diligence (EDD) for PEP status');
          recommendations.push('Review source of wealth documentation');
        }
        break;
      case 'compliance':
        if (factor.name.includes('AML')) {
          recommendations.push('Manual review of AML screening results');
        }
        if (factor.name.includes('Sanction')) {
          recommendations.push('URGENT: Review sanction screening match');
        }
        break;
    }
  }
  
  // Level-based recommendations
  if (level === 'high') {
    recommendations.push('Implement enhanced transaction monitoring');
    recommendations.push('Schedule periodic review (90 days)');
  } else if (level === 'critical') {
    recommendations.push('URGENT: Escalate for senior compliance review');
    recommendations.push('Consider account restrictions');
    recommendations.push('File SAR if suspicious activity confirmed');
  }
  
  return [...new Set(recommendations)]; // Remove duplicates
}
