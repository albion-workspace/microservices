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
  createGateway,
  logger,
  registerServiceConfigDefaults,
  registerServiceErrorCodes,
  resolveContext,
  isAuthenticated,
  hasRole,
  hasAnyRole,
  allow,
  on,
  startListening,
  getUserId,
  getTenantId,
  configureRedisStrategy,
  type ResolverContext,
  type IntegrationEvent,
} from 'core-service';

import { db, redis, registerKYCIndexes } from './accessors.js';
import { KYC_CONFIG_DEFAULTS } from './config-defaults.js';
import { loadConfig, validateConfig, printConfigSummary, SERVICE_NAME, type KYCConfig } from './config.js';
import { initializeProviders } from './providers/provider-factory.js';
import { initializeEventHandlers } from './event-dispatcher.js';
import { KYC_ERROR_CODES } from './error-codes.js';

// Import services
import { 
  kycProfileService, 
  kycDocumentService, 
  kycVerificationService,
  kycTypeDefs,
  kycCustomResolvers,
} from './services/kyc.js';

// Import engine for custom operations
import { kycEngine } from './services/kyc-engine/engine.js';
import { 
  getTierDisplayName, 
  getTierDescription, 
  getTierLimits 
} from './services/kyc-engine/tier-config.js';

// Import repositories for direct queries
import { kycRepository } from './repositories/kyc-repository.js';
import { documentRepository } from './repositories/document-repository.js';
import { verificationRepository } from './repositories/verification-repository.js';

// Import types
import type { KYCTier } from './types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Custom Resolvers
// ═══════════════════════════════════════════════════════════════════

const customTypeDefs = `
  ${kycTypeDefs}
  
  type TierInfo {
    tier: String!
    displayName: String!
    description: String!
    limits: TransactionLimits
  }
  
  extend type Query {
    # User queries
    myKYCProfile: KYCProfile
    myKYCLimits: TransactionLimits
    checkKYCEligibility(requiredTier: String!): KYCEligibility!
    checkTransactionLimit(type: String!, amount: Float!, currency: String!): TransactionLimitCheck!
    tierInfo: [TierInfo!]!
    
    # Admin queries
    kycProfileByUserId(userId: String!): KYCProfile
    pendingVerifications(limit: Int): [KYCVerification!]!
    highRiskProfiles(limit: Int): [KYCProfile!]!
  }
`;

const customResolvers = {
  Query: {
    // User queries
    myKYCProfile: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycRepository.findByUserId(userId, tenantId);
    },
    
    myKYCLimits: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      const profile = await kycRepository.findByUserId(userId, tenantId);
      const tier = profile?.currentTier ?? 'none';
      const jurisdiction = profile?.jurisdictionCode ?? 'US';
      return getTierLimits(tier, jurisdiction);
    },
    
    checkKYCEligibility: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycEngine.checkEligibility(userId, tenantId, args.requiredTier as KYCTier);
    },
    
    checkTransactionLimit: async (
      args: Record<string, unknown>, 
      ctx: ResolverContext
    ) => {
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      return kycEngine.checkTransactionLimit(
        userId,
        tenantId,
        args.type as 'deposit' | 'withdrawal' | 'transfer',
        args.amount as number,
        args.currency as string
      );
    },
    
    tierInfo: async () => {
      const tiers = ['none', 'basic', 'standard', 'enhanced', 'full', 'professional'] as const;
      return Promise.all(tiers.map(async (tier) => ({
        tier,
        displayName: getTierDisplayName(tier),
        description: getTierDescription(tier),
        limits: await getTierLimits(tier, 'US'),
      })));
    },
    
    // Admin queries
    kycProfileByUserId: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const tenantId = getTenantId(ctx);
      return kycRepository.findByUserId(args.userId as string, tenantId);
    },
    
    pendingVerifications: async (args: Record<string, unknown>) => {
      return verificationRepository.findPendingManualReviews((args.limit as number) ?? 50);
    },
    
    highRiskProfiles: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const tenantId = getTenantId(ctx);
      return kycRepository.findHighRiskProfiles(tenantId, (args.limit as number) ?? 50);
    },
  },
  Mutation: {
    // Custom mutations will be added as needed
  },
};

// ═══════════════════════════════════════════════════════════════════
// Gateway Configuration
// ═══════════════════════════════════════════════════════════════════

function buildGatewayConfig(config: KYCConfig): Parameters<typeof createGateway>[0] {
  return {
    name: config.serviceName,
    port: config.port,
    cors: {
      origins: config.corsOrigins,
    },
    jwt: {
      secret: config.jwtSecret,
      expiresIn: config.jwtExpiresIn,
      refreshSecret: config.jwtRefreshSecret,
      refreshExpiresIn: config.jwtRefreshExpiresIn ?? '7d',
    },
    services: [
      { name: 'kycProfile', types: kycProfileService.types, resolvers: kycProfileService.resolvers },
      { name: 'kycDocument', types: kycDocumentService.types, resolvers: kycDocumentService.resolvers },
      { name: 'kycVerification', types: kycVerificationService.types, resolvers: kycVerificationService.resolvers },
      { name: 'kycCustom', types: customTypeDefs, resolvers: customResolvers },
    ],
    permissions: {
      Query: {
        health: allow,
        // User queries (authenticated)
        myKYCProfile: isAuthenticated,
        myKYCLimits: isAuthenticated,
        checkKYCEligibility: isAuthenticated,
        checkTransactionLimit: isAuthenticated,
        tierInfo: allow,
        // Entity queries (authenticated)
        kycProfiles: isAuthenticated,
        kycProfileByUserId: hasAnyRole('system', 'admin'),
        kycDocuments: isAuthenticated,
        kycDocument: isAuthenticated,
        kycVerifications: isAuthenticated,
        kycVerification: isAuthenticated,
        // Admin queries
        pendingVerifications: hasAnyRole('system', 'admin'),
        highRiskProfiles: hasAnyRole('system', 'admin'),
      },
      Mutation: {
        // User mutations
        createKycProfile: hasAnyRole('system', 'admin'),
        uploadKycDocument: isAuthenticated,
        startKycVerification: isAuthenticated,
      },
    },
    mongoUri: config.mongoUri,
    redisUrl: config.redisUrl,
    defaultPermission: 'deny' as const,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

async function main() {
  try {
    logger.info('Starting KYC service');

    registerServiceErrorCodes(KYC_ERROR_CODES);
    registerServiceConfigDefaults(SERVICE_NAME, KYC_CONFIG_DEFAULTS as unknown as Record<string, { value: unknown; sensitivePaths?: string[]; description?: string }>);

    const context = await resolveContext();
    const config = await loadConfig(context.brand, context.tenantId);
    validateConfig(config);
    printConfigSummary(config);

    const { database } = await db.initialize({
      brand: context.brand,
      tenantId: context.tenantId,
    });
    logger.info('Database initialized', { database: database.databaseName });

    registerKYCIndexes();
    await db.ensureIndexes();

    await initializeProviders();

    await createGateway(buildGatewayConfig(config));

    logger.info('KYC service started', { port: config.port });

    if (config.redisUrl) {
      try {
        await configureRedisStrategy({
          strategy: 'shared',
          defaultUrl: config.redisUrl,
        });
        await redis.initialize({ brand: context.brand });
        logger.info('Redis accessor initialized', { brand: context.brand });
        await initializeEventHandlers();
      } catch (err) {
        logger.warn('Could not initialize Redis/event handlers', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  } catch (error) {
    logger.error('Failed to start KYC service', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Run if this is the main module
main();

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

// Services
export { kycProfileService, kycDocumentService, kycVerificationService };

// Engine
export { kycEngine } from './services/kyc-engine/engine.js';
export { 
  getTierDisplayName, 
  getTierDescription, 
  getTierLimits,
  buildTierRequirements,
  KYCEligibility,
} from './services/kyc-engine/tier-config.js';
export { calculateRiskScore } from './services/kyc-engine/risk-calculator.js';

// Repositories
export { kycRepository } from './repositories/kyc-repository.js';
export { documentRepository } from './repositories/document-repository.js';
export { verificationRepository } from './repositories/verification-repository.js';

// Types
export * from './types/index.js';

// Error codes
export { KYC_ERRORS, KYC_ERROR_CODES } from './error-codes.js';
