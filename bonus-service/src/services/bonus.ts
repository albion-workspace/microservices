/**
 * Bonus Service - Saga-based bonus management
 * 
 * Architecture: Wallets + Transactions + Transfers
 * - Wallets = Source of truth for balances
 * - Transactions = The ledger (each transaction is a ledger entry)
 * - Transfers = User-to-user operations (creates 2 transactions)
 */

import { createService, type, type Repository, type SagaContext, validateInput, getDatabase, logger, findUserIdByRole, GraphQLError, createServiceError } from 'core-service';
import type { BonusTemplate, UserBonus, BonusTransaction, BonusStatus } from '../types.js';
import { bonusEngine } from './bonus-engine/index.js';
import { templatePersistence } from './bonus-engine/persistence.js';
import type { BonusContext } from './bonus-engine/types.js';
import { getHandler } from './bonus-engine/handler-registry.js';

// ═══════════════════════════════════════════════════════════════════
// Bonus Template Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateBonusTemplateInput {
  name: string;
  code: string;
  type: string;
  domain: string;
  valueType: string;
  value: number;
  currency: string;                // Required currency
  supportedCurrencies?: string[];  // Optional: restrict to specific currencies
  turnoverMultiplier: number;      // Activity/turnover requirement multiplier
  validFrom: string;
  validUntil: string;
}

type BonusTemplateCtx = SagaContext<BonusTemplate, CreateBonusTemplateInput>;

const bonusTemplateSchema = type({
  name: 'string >= 3',
  code: 'string >= 3',
  type: 'string',
  domain: 'string',
  valueType: '"fixed" | "percentage" | "credit" | "multiplier" | "points" | "item"',
  value: 'number > 0',
  currency: 'string',
  'supportedCurrencies?': 'string[]',
  turnoverMultiplier: 'number >= 0',
  validFrom: 'string',
  validUntil: 'string',
});

const bonusTemplateSaga = [
  {
    name: 'createTemplate',
    critical: true,
    execute: async ({ input, data, ...ctx }: BonusTemplateCtx): Promise<BonusTemplateCtx> => {
      const repo = data._repository as Repository<BonusTemplate>;
      
      // Check if template with same code already exists (code is unique index)
      const existing = await repo.findOne({ code: input.code });
      if (existing) {
        // Template exists - update it with new fields (especially requiresApproval)
        const updates: Partial<BonusTemplate> = {
          name: input.name,
          type: input.type as any,
          domain: input.domain as any,
          valueType: input.valueType as any,
          value: input.value,
          currency: input.currency as any,
          supportedCurrencies: input.supportedCurrencies as any[],
          turnoverMultiplier: input.turnoverMultiplier,
          validFrom: new Date(input.validFrom),
          validUntil: new Date(input.validUntil),
          stackable: (input as any).stackable !== undefined ? (input as any).stackable : existing.stackable,
          priority: (input as any).priority !== undefined ? (input as any).priority : existing.priority,
          isActive: (input as any).isActive !== undefined ? (input as any).isActive : existing.isActive,
          requiresApproval: (input as any).requiresApproval !== undefined ? (input as any).requiresApproval : existing.requiresApproval,
          approvalThreshold: (input as any).approvalThreshold !== undefined ? (input as any).approvalThreshold : existing.approvalThreshold,
          description: (input as any).description !== undefined ? (input as any).description : existing.description,
        };
        const updated = await repo.update(existing.id, updates);
        if (!updated) {
          throw createServiceError('bonus', 'FailedToUpdateTemplate', {});
        }
        return { ...ctx, input, data, entity: updated };
      }
      
      // Template doesn't exist, create new one
      // Repository will automatically generate MongoDB ObjectId via generateMongoId()
      const template: Omit<BonusTemplate, 'id'> & { id?: string } = {
        name: input.name,
        code: input.code,
        type: input.type as any,
        domain: input.domain as any,
        valueType: input.valueType as any,
        value: input.value,
        currency: input.currency as any,
        supportedCurrencies: input.supportedCurrencies as any[],
        turnoverMultiplier: input.turnoverMultiplier,
        validFrom: new Date(input.validFrom),
        validUntil: new Date(input.validUntil),
        currentUsesTotal: 0,
        stackable: (input as any).stackable !== undefined ? (input as any).stackable : true,
        priority: (input as any).priority || 0,
        isActive: (input as any).isActive !== undefined ? (input as any).isActive : true,
        requiresApproval: (input as any).requiresApproval || false,
        approvalThreshold: (input as any).approvalThreshold,
        description: (input as any).description,
      };
      
      // Repository.create() will generate MongoDB ObjectId automatically
      const created = await repo.create(template as BonusTemplate);
      return { ...ctx, input, data, entity: created };
    },
    compensate: async ({ entity, data }: BonusTemplateCtx) => {
      if (entity) {
        const repo = data._repository as Repository<BonusTemplate>;
        await repo.delete(entity.id);
      }
    },
  },
];

export const bonusTemplateService = createService<BonusTemplate, CreateBonusTemplateInput>({
  name: 'bonusTemplate',
  entity: {
    name: 'bonusTemplate',
    collection: 'bonus_templates',
    graphqlType: `
      type BonusTemplate { 
        id: ID! 
        name: String! 
        code: String! 
        type: String! 
        domain: String! 
        description: String
        
        # Value configuration
        valueType: String!
        value: Float! 
        currency: String! 
        supportedCurrencies: [String!] 
        maxValue: Float
        minDeposit: Float
        
        # Turnover/Activity requirements
        turnoverMultiplier: Float!
        activityContributions: String  # JSON string of { category: rate }
        
        # Validity
        validFrom: String!
        validUntil: String!
        claimDeadlineDays: Int
        usageDeadlineDays: Int
        
        # Limits
        maxUsesTotal: Int
        maxUsesPerUser: Int
        currentUsesTotal: Int!
        
        # Eligibility (for client-side pre-validation)
        eligibleTiers: [String!]
        eligibleCountries: [String!]
        excludedCountries: [String!]
        minAccountAgeDays: Int
        requiresDeposit: Boolean
        requiresVerification: Boolean
        
        # Selection/Combo (for combo bonuses)
        minSelections: Int
        maxSelections: Int
        minActions: Int
        comboMultiplier: Float
        eligibleCategories: [String!]
        
        # Stacking
        stackable: Boolean!
        excludedBonusTypes: [String!]
        
        # Metadata
        tags: [String!]
        priority: Int!
        isActive: Boolean!
        
        # Approval
        requiresApproval: Boolean
        approvalThreshold: Float
        
        createdAt: String
        updatedAt: String
      }
      type BonusTemplateConnection { nodes: [BonusTemplate!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateBonusTemplateResult { success: Boolean! bonusTemplate: BonusTemplate sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateBonusTemplateInput { name: String! code: String! type: String! domain: String! valueType: String! value: Float! currency: String! supportedCurrencies: [String!] maxValue: Float minDeposit: Float turnoverMultiplier: Float! validFrom: String! validUntil: String! eligibleTiers: [String!] minSelections: Int maxSelections: Int priority: Int description: String isActive: Boolean stackable: Boolean requiresApproval: Boolean approvalThreshold: Float }`,
    validateInput: (input) => {
      const result = bonusTemplateSchema(input);
      return validateInput(result) as CreateBonusTemplateInput | { errors: string[] };
    },
    indexes: [
      { fields: { code: 1 }, options: { unique: true } },
      { fields: { type: 1, domain: 1, isActive: 1 } },
      { fields: { currency: 1, isActive: 1 } },
    ],
  },
  saga: bonusTemplateSaga,
  // No transaction needed for template creation (no money involved)
});

// ═══════════════════════════════════════════════════════════════════
// User Bonus Types & Validation
// ═══════════════════════════════════════════════════════════════════

/** Internal input for creating a user bonus via saga */
interface CreateUserBonusSagaInput {
  userId: string;
  tenantId?: string;
  templateCode: string;
  currency: string;                // Currency for the bonus
  depositAmount?: number;
}

type UserBonusCtx = SagaContext<UserBonus, CreateUserBonusSagaInput>;

const claimBonusSchema = type({
  userId: 'string',
  templateCode: 'string',
  currency: 'string',
  'tenantId?': 'string',
  'depositAmount?': 'number',
});

const userBonusSaga = [
  {
    name: 'loadTemplate',
    critical: true,
    execute: async ({ input, data, ...ctx }: UserBonusCtx): Promise<UserBonusCtx> => {
      // Load template by code
      const template = await templatePersistence.findByCode(input.templateCode);
      if (!template) {
        throw createServiceError('bonus', 'TemplateNotFound', { templateCode: input.templateCode });
      }
      if (!template.isActive) {
        throw new Error(`Template ${input.templateCode} is not active`);
      }
      data.template = template;
      data.templateCode = input.templateCode;
      return { ...ctx, input, data };
    },
  },
  {
    name: 'checkEligibility',
    critical: true,
    execute: async ({ input, data, ...ctx }: UserBonusCtx): Promise<UserBonusCtx> => {
      const template = data.template as BonusTemplate;
      if (!template) {
        throw createServiceError('bonus', 'TemplateNotLoaded', {});
      }

      // Get handler for this bonus type
      const handler = getHandler(template.type as any);
      if (!handler) {
        throw new Error(`No handler for bonus type: ${template.type}`);
      }

      // Build context for eligibility check
      const context: BonusContext = {
        userId: input.userId,
        tenantId: input.tenantId || 'default',
        depositAmount: input.depositAmount,
        currency: input.currency as any,
      };

      // Check eligibility with the specific template (not by type lookup)
      // We need to run validators manually since checkEligibility finds templates by type
      // First, run common validators
      const commonResult = await (handler as any).runCommonValidators(template, context);
      if (!commonResult.eligible) {
        throw createServiceError('bonus', 'UserNotEligible', { 
          reason: commonResult.reason || 'User is not eligible for this bonus' 
        });
      }

      // Then run specific validators
      const specificResult = await (handler as any).validateSpecific(template, context);
      if (!specificResult.eligible) {
        throw createServiceError('bonus', 'UserNotEligible', { 
          reason: specificResult.reason || 'User is not eligible for this bonus' 
        });
      }

      // Award bonus using the handler with the specific template
      const result = await handler.award(template, context);
      
      if (!result.success) {
        // If bonus requires approval, embed pendingToken in error message
        // Note: Saga framework converts errors to strings, so we use a structured format
        // Format: "BONUS_REQUIRES_APPROVAL|PENDING_TOKEN:{token}"
        if (result.pendingToken) {
          (data as any).pendingToken = result.pendingToken;
          throw createServiceError('bonus', 'BonusRequiresApproval', { 
            pendingToken: result.pendingToken 
          });
        }
        throw createServiceError('bonus', 'BonusAwardFailed', { 
          error: result.error || 'Bonus award failed' 
        });
      }

      if (!result.bonus) {
        throw createServiceError('bonus', 'BonusAwardFailed', { 
          reason: 'No bonus returned' 
        });
      }

      // Verify the bonus was created with the correct template
      if (result.bonus.templateCode !== input.templateCode && result.bonus.templateId !== template.id) {
        // Delete the incorrectly awarded bonus and throw error
        const repo = data._repository as Repository<UserBonus>;
        await repo.delete(result.bonus.id);
        throw createServiceError('bonus', 'BonusWrongTemplate', {});
      }

      // Store the awarded bonus
      data.awardedBonus = result.bonus;
      return { ...ctx, input, data };
    },
    compensate: async ({ data }: UserBonusCtx) => {
      // If eligibility check fails, no bonus was created, so nothing to compensate
      const awardedBonus = data.awardedBonus as UserBonus | undefined;
      if (awardedBonus) {
        // If bonus was created but saga failed later, delete it
        const repo = data._repository as Repository<UserBonus>;
        try {
          await repo.delete(awardedBonus.id);
        } catch (err) {
          // Ignore errors during compensation
        }
      }
    },
  },
  {
    name: 'createUserBonus',
    critical: true,
    execute: async ({ input, data, ...ctx }: UserBonusCtx): Promise<UserBonusCtx> => {
      const awardedBonus = data.awardedBonus as UserBonus;
      
      if (!awardedBonus) {
        throw createServiceError('bonus', 'BonusNotAwarded', {});
      }

      // Bonus was already created by the engine, just verify and return it
      const repo = data._repository as Repository<UserBonus>;
      const existing = await repo.findById(awardedBonus.id);
      if (!existing) {
        throw createServiceError('bonus', 'AwardedBonusNotFound', {});
      }

      return { ...ctx, input, data, entity: existing };
    },
    compensate: async ({ entity, data }: UserBonusCtx) => {
      if (entity) {
        const repo = data._repository as Repository<UserBonus>;
        await repo.delete(entity.id);
      }
    },
  },
];

export const userBonusService = createService<UserBonus, CreateUserBonusSagaInput>({
  name: 'userBonus',
  entity: {
    name: 'userBonus',
    collection: 'user_bonuses',
    graphqlType: `
      type UserBonus { id: ID! userId: String! templateCode: String! type: String! status: String! currency: String! originalValue: Float! currentValue: Float! turnoverRequired: Float! turnoverProgress: Float! expiresAt: String! }
      type UserBonusConnection { nodes: [UserBonus!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateUserBonusResult { 
        success: Boolean! 
        userBonus: UserBonus 
        sagaId: ID! 
        errors: [String!] 
        executionTimeMs: Int 
        # pendingToken: Exposed when bonus requires approval (requiresApproval=true)
        # Purpose: Allows admins/users to track and approve pending bonus requests
        # Security: Only returned when approval is required, not for successful awards
        # Usage: Admin can use this token with approveBonus/rejectBonus mutations
        pendingToken: String 
      }
    `,
    graphqlInput: `input CreateUserBonusInput { userId: String! templateCode: String! currency: String! tenantId: String depositAmount: Float }`,
    validateInput: (input) => {
      const result = claimBonusSchema(input);
      return validateInput(result) as CreateUserBonusSagaInput | { errors: string[] };
    },
    indexes: [
      { fields: { userId: 1, status: 1 } },
      { fields: { userId: 1, currency: 1, status: 1 } },
      { fields: { templateCode: 1 } },
      { fields: { expiresAt: 1 } },
    ],
  },
  saga: userBonusSaga,
  // Use MongoDB transaction for bonus operations (money involved)
  // Requires MongoDB replica set (default in docker-compose)
  sagaOptions: {
    useTransaction: process.env.MONGO_TRANSACTIONS !== 'false',
    maxRetries: 3,
  },
});

// ═══════════════════════════════════════════════════════════════════
// Bonus Transaction Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateBonusTransactionInput {
  userBonusId: string;
  userId: string;
  type: 'credit' | 'debit' | 'turnover' | 'conversion' | 'forfeit' | 'adjustment';
  currency: string;                // Currency of this transaction
  amount: number;
  originalCurrency?: string;       // If activity in different currency
  originalAmount?: number;
  exchangeRate?: number;
  relatedTransactionId?: string;
  activityCategory?: string;       // Category for contribution calculation
}

type BonusTxCtx = SagaContext<BonusTransaction, CreateBonusTransactionInput>;

const bonusTxSchema = type({
  userBonusId: 'string',
  userId: 'string',
  type: '"credit" | "debit" | "turnover" | "conversion" | "forfeit" | "adjustment"',
  currency: 'string',
  amount: 'number > 0',
  'originalCurrency?': 'string',
  'originalAmount?': 'number',
  'exchangeRate?': 'number',
  'relatedTransactionId?': 'string',
  'activityCategory?': 'string',
});

const bonusTransactionSaga = [
  {
    name: 'createTransaction',
    critical: true,
    execute: async ({ input, data, ...ctx }: BonusTxCtx): Promise<BonusTxCtx> => {
      const repo = data._repository as Repository<BonusTransaction>;
      
      // Repository will automatically generate MongoDB ObjectId
      const transaction: Omit<BonusTransaction, 'id'> = {
        userBonusId: input.userBonusId,
        userId: input.userId,
        tenantId: 'default', // Default tenant
        type: input.type,
        currency: input.currency as any,
        amount: input.amount,
        balanceBefore: 0, // Would be loaded from userBonus
        balanceAfter: input.type === 'credit' ? input.amount : -input.amount,
        // Cross-currency activity support
        originalCurrency: input.originalCurrency as any,
        originalAmount: input.originalAmount,
        exchangeRate: input.exchangeRate,
        // Turnover tracking
        turnoverBefore: 0,
        turnoverAfter: input.type === 'turnover' ? input.amount : 0,
        turnoverContribution: input.type === 'turnover' ? input.amount : undefined,
        relatedTransactionId: input.relatedTransactionId,
        activityCategory: input.activityCategory,
      };
      
      // Repository.create() will generate MongoDB ObjectId automatically
      const created = await repo.create(transaction as BonusTransaction);
      return { ...ctx, input, data, entity: created };
    },
    compensate: async ({ entity, data }: BonusTxCtx) => {
      if (entity) {
        const repo = data._repository as Repository<BonusTransaction>;
        await repo.delete(entity.id);
      }
    },
  },
];

export const bonusTransactionService = createService<BonusTransaction, CreateBonusTransactionInput>({
  name: 'bonusTransaction',
  entity: {
    name: 'bonusTransaction',
    collection: 'bonus_transactions',
    graphqlType: `
      type BonusTransaction { id: ID! userBonusId: String! userId: String! type: String! currency: String! amount: Float! balanceBefore: Float! balanceAfter: Float! originalCurrency: String originalAmount: Float exchangeRate: Float }
      type BonusTransactionConnection { nodes: [BonusTransaction!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateBonusTransactionResult { success: Boolean! bonusTransaction: BonusTransaction sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateBonusTransactionInput { userBonusId: String! userId: String! type: String! currency: String! amount: Float! originalCurrency: String originalAmount: Float exchangeRate: Float relatedTransactionId: String }`,
    validateInput: (input) => {
      const result = bonusTxSchema(input);
      return validateInput(result) as CreateBonusTransactionInput | { errors: string[] };
    },
    indexes: [
      { fields: { userBonusId: 1, createdAt: -1 } },
      { fields: { userId: 1, currency: 1, createdAt: -1 } },
      { fields: { userId: 1, createdAt: -1 } },
    ],
  },
  saga: bonusTransactionSaga,
  // Critical: Use MongoDB transaction for all bonus transactions (money operations)
  // Requires MongoDB replica set (default in docker-compose)
  sagaOptions: {
    useTransaction: process.env.MONGO_TRANSACTIONS !== 'false',
    maxRetries: 3,
  },
});

// ═══════════════════════════════════════════════════════════════════
// Bonus Transfer Helpers (Unified Wallet Operations)
// Architecture: Wallets + Transactions + Transfers
// ═══════════════════════════════════════════════════════════════════

/**
 * Get system user ID from auth database using role-based lookup
 * Uses a user with 'system' role's bonusBalance as the bonus pool
 * This is generic and flexible - supports multiple system users if needed
 * 
 * @param tenantId - Optional tenant ID to filter by (for multi-tenant scenarios)
 * @returns System user ID
 */
async function getSystemUserId(tenantId?: string): Promise<string> {
  
  try {
    // Find user with 'system' role (role-based, not hardcoded email)
    const systemUserId = await findUserIdByRole({
      role: 'system',
      tenantId,
      throwIfNotFound: true,
    });
    
    logger.debug('System user ID resolved for bonus pool', { 
      userId: systemUserId, 
      tenantId,
      method: 'role-based' 
    });
    
    return systemUserId;
  } catch (error) {
    throw createServiceError('bonus', 'FailedToGetSystemUserId', { 
      error: error instanceof Error ? error.message : String(error),
      tenantId 
    });
  }
}

/**
 * Event-Driven Architecture:
 * Bonus service emits events, payment service handles all wallet operations.
 * 
 * Flow:
 * - bonus.awarded → payment service creates transfer (system bonus → user bonus)
 * - bonus.converted → payment service creates transfer (user bonus → user real)
 * - bonus.forfeited → payment service creates transfer (user bonus → system bonus)
 * 
 * Balance checks are handled by payment service when creating transfers.
 * If insufficient balance, payment service will throw an error.
 */
