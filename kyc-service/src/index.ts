/**
 * KYC Service Entry Point
 * 
 * Generic KYC/Identity Verification Service supporting:
 * - Multi-tier verification (basic → standard → enhanced → full → professional)
 * - Provider-agnostic (Onfido, Sumsub, Jumio, etc.)
 * - Jurisdiction-aware (different rules per country)
 * - Domain-flexible (finance, betting, crypto, e-commerce)
 * - AML/PEP/Sanctions screening
 * - Risk-based approach
 * - Event-driven integration with auth, payment, bonus services
 */

import { 
  logger,
  registerServiceErrorCodes,
} from 'core-service';

import { db, registerKYCIndexes } from './database.js';
import { registerKYCConfigDefaults } from './config-defaults.js';
import { initializeProviders } from './providers/provider-factory.js';
import { initializeEventHandlers } from './event-dispatcher.js';
import { KYC_ERROR_CODES } from './error-codes.js';
import { kycService } from './graphql.js';

// ═══════════════════════════════════════════════════════════════════
// Service Initialization
// ═══════════════════════════════════════════════════════════════════

export async function initializeKYCService(options?: {
  brand?: string;
  tenantId?: string;
}): Promise<void> {
  logger.info('Initializing KYC service');
  
  // Register error codes
  registerServiceErrorCodes(KYC_ERROR_CODES);
  
  // Register configuration defaults
  registerKYCConfigDefaults();
  
  // Initialize database
  await db.initialize({
    brand: options?.brand ?? 'default',
    tenantId: options?.tenantId ?? 'default',
  });
  
  // Register indexes
  registerKYCIndexes();
  await db.ensureIndexes();
  
  // Initialize providers
  await initializeProviders();
  
  // Initialize event handlers
  await initializeEventHandlers();
  
  logger.info('KYC service initialized');
}

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

// Service
export { initializeKYCService };
export { kycService };

// Engine
export { kycEngine, KYCEngine } from './services/kyc-engine/engine.js';
export { 
  buildTierRequirements, 
  getTierLimits, 
  getTierDisplayName, 
  getTierDescription 
} from './services/kyc-engine/tier-config.js';
export { calculateRiskScore } from './services/kyc-engine/risk-calculator.js';

// Repositories
export { kycRepository, KYCRepository } from './repositories/kyc-repository.js';
export { documentRepository, DocumentRepository } from './repositories/document-repository.js';
export { verificationRepository, VerificationRepository } from './repositories/verification-repository.js';

// Providers
export { 
  providerFactory, 
  getDefaultProvider, 
  getProviderOrDefault,
  initializeProviders,
} from './providers/provider-factory.js';
export { BaseKYCProvider } from './providers/base-provider.js';
export { MockKYCProvider } from './providers/mock-provider.js';

// Events
export { emitKYCEvent, getWebhookManager } from './event-dispatcher.js';

// Types
export * from './types/kyc-types.js';
export * from './types/jurisdiction-config.js';
export * from './types/provider-types.js';

// Error codes
export { KYC_ERRORS, KYC_ERROR_CODES } from './error-codes.js';

// Database
export { db, COLLECTIONS } from './database.js';
