/**
 * Bonus Service - Saga-based bonus management
 */

import { createService, generateId, type, type Repository, type SagaContext } from 'core-service';
import type { BonusTemplate, UserBonus, BonusTransaction, BonusStatus } from '../types.js';

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
      const id = (data._generateId as typeof generateId)();
      
      const template: BonusTemplate = {
        id,
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
        stackable: true,
        priority: 0,
        isActive: true,
      } as BonusTemplate;
      
      await repo.create(template);
      return { ...ctx, input, data, entity: template };
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
        createdAt: String
        updatedAt: String
      }
      type BonusTemplateConnection { nodes: [BonusTemplate!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateBonusTemplateResult { success: Boolean! bonusTemplate: BonusTemplate sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateBonusTemplateInput { name: String! code: String! type: String! domain: String! valueType: String! value: Float! currency: String! supportedCurrencies: [String!] maxValue: Float minDeposit: Float turnoverMultiplier: Float! validFrom: String! validUntil: String! eligibleTiers: [String!] minSelections: Int maxSelections: Int priority: Int }`,
    validateInput: (input) => {
      const result = bonusTemplateSchema(input);
      if (result instanceof type.errors) return { errors: [result.summary] };
      return result as CreateBonusTemplateInput;
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
      // In real impl, this would search by code - simplified for example
      data.templateCode = input.templateCode;
      return { ...ctx, input, data };
    },
  },
  {
    name: 'createUserBonus',
    critical: true,
    execute: async ({ input, data, ...ctx }: UserBonusCtx): Promise<UserBonusCtx> => {
      const repo = data._repository as Repository<UserBonus>;
      const id = (data._generateId as typeof generateId)();
      
      const bonusValue = input.depositAmount || 100; // Simplified
      const turnoverRequired = bonusValue * 30; // 30x turnover requirement
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      const userBonus: UserBonus = {
        id,
        userId: input.userId,
        tenantId: input.tenantId || 'default',
        templateId: 'template-id', // Would come from loaded template
        templateCode: input.templateCode,
        type: 'first_deposit',
        domain: 'universal', // Generic domain
        status: 'active' as BonusStatus,
        currency: input.currency as any,
        originalValue: bonusValue,
        currentValue: bonusValue,
        turnoverRequired,
        turnoverProgress: 0,
        depositId: undefined,
        referrerId: undefined,
        qualifiedAt: new Date(),
        claimedAt: new Date(),
        activatedAt: new Date(),
        expiresAt,
        history: [{
          timestamp: new Date(),
          action: 'claimed',
          newStatus: 'active' as BonusStatus,
          amount: bonusValue,
          triggeredBy: 'user',
        }],
      } as UserBonus;
      
      await repo.create(userBonus);
      return { ...ctx, input, data, entity: userBonus };
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
      type CreateUserBonusResult { success: Boolean! userBonus: UserBonus sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateUserBonusInput { userId: String! templateCode: String! currency: String! tenantId: String depositAmount: Float }`,
    validateInput: (input) => {
      const result = claimBonusSchema(input);
      if (result instanceof type.errors) return { errors: [result.summary] };
      return result as CreateUserBonusSagaInput;
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
      const id = (data._generateId as typeof generateId)();
      
      const transaction: BonusTransaction = {
        id,
        userBonusId: input.userBonusId,
        userId: input.userId,
        tenantId: 'default',
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
      } as BonusTransaction;
      
      await repo.create(transaction);
      return { ...ctx, input, data, entity: transaction };
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
      if (result instanceof type.errors) return { errors: [result.summary] };
      return result as CreateBonusTransactionInput;
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
