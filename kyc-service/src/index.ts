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
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
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

// Local Redis accessor
import { redis } from './redis.js';

import { db, registerKYCIndexes } from './database.js';
import { registerKYCConfigDefaults } from './config-defaults.js';
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
// Configuration
// NOTE: Database config is handled by core-service strategy-config.ts
// Uses MONGO_URI and REDIS_URL from environment variables
// See CODING_STANDARDS.md for database access patterns
// ═══════════════════════════════════════════════════════════════════

interface KYCConfig {
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret: string;
  jwtRefreshExpiresIn: string;
}

// Config loaded from environment variables (no hardcoded localhost fallbacks)
const kycConfig: KYCConfig = {
  port: parseInt(process.env.PORT || '9005', 10),
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  jwtSecret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
};

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

const buildGatewayConfig = (): Parameters<typeof createGateway>[0] => {
  return {
    name: 'kyc-service',
    port: kycConfig.port,
    cors: {
      origins: kycConfig.corsOrigins,
    },
    jwt: {
      secret: kycConfig.jwtSecret,
      expiresIn: kycConfig.jwtExpiresIn,
      refreshSecret: kycConfig.jwtRefreshSecret,
      refreshExpiresIn: kycConfig.jwtRefreshExpiresIn,
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
    // NOTE: mongoUri and redisUrl come from MONGO_URI and REDIS_URL env vars
    // handled by core-service gateway - no hardcoded values needed
    mongoUri: process.env.MONGO_URI,
    redisUrl: process.env.REDIS_URL,
    defaultPermission: 'deny' as const,
  };
};

// ═══════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════

async function main() {
  try {
    logger.info('Starting KYC service');
    
    // Register error codes
    registerServiceErrorCodes(KYC_ERROR_CODES);
    
    // Register configuration defaults
    registerKYCConfigDefaults();
    
    // Initialize database
    await db.initialize({
      brand: 'default',
      tenantId: 'default',
    });
    
    // Register indexes
    registerKYCIndexes();
    await db.ensureIndexes();
    
    // Initialize providers
    await initializeProviders();
    
    // Start gateway
    await createGateway(buildGatewayConfig());
    
    logger.info(`KYC service started on port ${kycConfig.port}`);
    
    // Initialize Redis accessor (after gateway connects to Redis)
    // Redis URL comes from REDIS_URL environment variable
    if (process.env.REDIS_URL) {
      try {
        await configureRedisStrategy({
          strategy: 'shared',
          defaultUrl: process.env.REDIS_URL,
        });
        await redis.initialize({ brand: 'default' });
        logger.info('Redis accessor initialized');
        
        // Initialize event handlers (after Redis is connected)
        await initializeEventHandlers();
      } catch (err) {
        logger.warn('Could not initialize Redis/event handlers', { 
          error: err instanceof Error ? err.message : 'Unknown error' 
        });
        // Don't throw - service can still run without event handlers
      }
    }
  } catch (error) {
    logger.error('Failed to start KYC service', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
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
