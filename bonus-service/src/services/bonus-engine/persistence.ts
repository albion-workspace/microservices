/**
 * Persistence Layer for Bonus Engine
 * 
 * This module provides an abstraction over data persistence,
 * using direct MongoDB access for optimized reads/writes.
 * 
 * Referrals are tracked via UserBonus with type 'referral' or 'referee':
 * - UserBonus.refereeId: who was referred (for referrer bonuses)
 * - UserBonus.referrerId: who referred (for referee bonuses)
 */

import { logger, findOneById, updateOneById, normalizeDocument, normalizeDocuments, deleteOneById, generateMongoId, resolveDatabase, type DatabaseResolutionOptions, type Collection, type Db } from 'core-service';
import type { 
  BonusTemplate, 
  UserBonus, 
  BonusTransaction, 
  BonusStatus,
  BonusType,
  BonusHistoryEntry,
  ReferralSummary,
  Currency,
} from '../../types.js';

// ═══════════════════════════════════════════════════════════════════
// Persistence Options
// ═══════════════════════════════════════════════════════════════════

export interface BonusPersistenceOptions extends DatabaseResolutionOptions {
  // Can extend with bonus-specific options if needed
}

// ═══════════════════════════════════════════════════════════════════
// Collection Access Helpers
// ═══════════════════════════════════════════════════════════════════

// Helper to resolve database (requires database strategy - no fallback per coding standards)
async function resolveBonusDatabase(options: BonusPersistenceOptions, tenantId?: string): Promise<Db> {
  if (!options.databaseStrategy && !options.database) {
    throw new Error('BonusPersistence requires database or databaseStrategy in options. Ensure persistence is created with proper database configuration.');
  }
  return await resolveDatabase(options, 'bonus-service', tenantId);
}

async function getTemplateCollection(options: BonusPersistenceOptions, tenantId?: string): Promise<Collection> {
  const db = await resolveBonusDatabase(options, tenantId);
  return db.collection('bonus_templates');
}

async function getUserBonusCollection(options: BonusPersistenceOptions, tenantId?: string): Promise<Collection> {
  const db = await resolveBonusDatabase(options, tenantId);
  return db.collection('user_bonuses');
}

async function getTransactionCollection(options: BonusPersistenceOptions, tenantId?: string): Promise<Collection> {
  const db = await resolveBonusDatabase(options, tenantId);
  return db.collection('bonus_transactions');
}

// ═══════════════════════════════════════════════════════════════════
// Template Operations
// ═══════════════════════════════════════════════════════════════════

export function createTemplatePersistence(options: BonusPersistenceOptions) {
  return {
    async findById(id: string, tenantId?: string): Promise<BonusTemplate | null> {
      // Use optimized findOneById utility (performance-optimized)
      const collection = await getTemplateCollection(options, tenantId);
      const doc = await findOneById<BonusTemplate>(collection, id, {});
      return doc;
    },

    async findByCode(code: string, tenantId?: string): Promise<BonusTemplate | null> {
      // findByCode uses code field (not id), so keep manual query
      const collection = await getTemplateCollection(options, tenantId);
      const doc = await collection.findOne({ code });
      return doc as unknown as BonusTemplate | null;
    },

    async findByType(type: BonusType, tenantId?: string): Promise<BonusTemplate[]> {
      const now = new Date();
      const collection = await getTemplateCollection(options, tenantId);
      const docs = await collection.find({
        type,
        isActive: true,
        validFrom: { $lte: now },
        validUntil: { $gte: now },
      }).toArray();
      return docs as unknown as BonusTemplate[];
    },

    async findByTypes(types: BonusType[], tenantId?: string): Promise<BonusTemplate[]> {
      const now = new Date();
      const collection = await getTemplateCollection(options, tenantId);
      const docs = await collection.find({
        type: { $in: types },
        isActive: true,
        validFrom: { $lte: now },
        validUntil: { $gte: now },
      }).toArray();
      return docs as unknown as BonusTemplate[];
    },

    async findActive(filter?: Record<string, unknown>, tenantId?: string): Promise<BonusTemplate[]> {
      const now = new Date();
      const collection = await getTemplateCollection(options, tenantId);
      const docs = await collection.find({
        ...filter,
        isActive: true,
        validFrom: { $lte: now },
        validUntil: { $gte: now },
      }).toArray();
      return docs as unknown as BonusTemplate[];
    },

    async findReferralTemplates(tenantId?: string): Promise<{ referrer?: BonusTemplate; referee?: BonusTemplate }> {
      const now = new Date();
      const collection = await getTemplateCollection(options, tenantId);
      const docs = await collection.find({
        type: { $in: ['referral', 'referee'] },
        isActive: true,
        validFrom: { $lte: now },
        validUntil: { $gte: now },
      }).toArray();
      const templates = docs as unknown as BonusTemplate[];
      
      return {
        referrer: templates.find(t => t.type === 'referral'),
        referee: templates.find(t => t.type === 'referee'),
      };
    },

    async incrementUsage(templateId: string, tenantId?: string): Promise<void> {
      // Use optimized updateOneById utility (performance-optimized)
      const collection = await getTemplateCollection(options, tenantId);
      await updateOneById(
        collection,
        templateId,
        { $inc: { currentUsesTotal: 1 } }
      );
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// User Bonus Operations
// ═══════════════════════════════════════════════════════════════════

export function createUserBonusPersistence(options: BonusPersistenceOptions) {
  return {
    async findById(id: string, tenantId?: string): Promise<UserBonus | null> {
      // Use optimized findOneById utility (performance-optimized)
      const collection = await getUserBonusCollection(options, tenantId);
      const doc = await findOneById<UserBonus>(collection, id, {});
      return normalizeDocument(doc);
    },

    async findByUserId(userId: string, filter?: Record<string, unknown>, tenantId?: string): Promise<UserBonus[]> {
      const collection = await getUserBonusCollection(options, tenantId);
      const docs = await collection.find({ userId, ...filter }).toArray();
      // Normalize all documents to map _id to id
      return normalizeDocuments(docs as any[]) as UserBonus[];
    },

    async findActiveByUserId(userId: string, tenantId?: string): Promise<UserBonus[]> {
      const collection = await getUserBonusCollection(options, tenantId);
      const docs = await collection.find({
        userId,
        status: { $in: ['active', 'in_progress', 'pending'] },
      }).toArray();
      // Normalize all documents to map _id to id
      return normalizeDocuments(docs as any[]) as UserBonus[];
    },

    async countByTemplate(userId: string, templateId: string, tenantId?: string): Promise<number> {
      const collection = await getUserBonusCollection(options, tenantId);
      return collection.countDocuments({ userId, templateId });
    },

    async countByType(userId: string, types: BonusType[], tenantId?: string): Promise<number> {
      const collection = await getUserBonusCollection(options, tenantId);
      return collection.countDocuments({ 
        userId, 
        type: { $in: types } 
      });
    },

    /**
     * Count referrals made by a user
     */
    async countReferralsByUser(referrerId: string, tenantId?: string): Promise<number> {
      const collection = await getUserBonusCollection(options, tenantId);
      return collection.countDocuments({
        type: 'referral',
        refereeId: { $exists: true },
        userId: referrerId,
        status: { $in: ['active', 'converted', 'claimed'] },
      });
    },

    /**
     * Check if user was already referred
     */
    async isUserReferred(userId: string, tenantId?: string): Promise<boolean> {
      const collection = await getUserBonusCollection(options, tenantId);
      const count = await collection.countDocuments({
        type: 'referee',
        userId,
      });
      return count > 0;
    },

    /**
     * Create a user bonus
     * Uses MongoDB ObjectId for performant single-insert operation
     */
    async create(bonus: Omit<UserBonus, 'id'>, tenantId?: string): Promise<UserBonus> {
      const now = new Date();
      // Generate MongoDB ObjectId for performant single-insert operation
      const { objectId, idString } = generateMongoId();
      const bonusWithTimestamps = {
        _id: objectId,
        id: idString,
        ...bonus,
        createdAt: now,
        updatedAt: now,
      };
      const collection = await getUserBonusCollection(options, tenantId);
      await collection.insertOne(bonusWithTimestamps as any);
      return bonusWithTimestamps as UserBonus;
    },

    /**
     * Update bonus status with history entry
     */
    async updateStatus(
      bonusId: string, 
      newStatus: BonusStatus, 
      historyEntry: BonusHistoryEntry,
      additionalFields?: Record<string, unknown>,
      tenantId?: string
    ): Promise<void> {
      // Use optimized updateOneById utility (performance-optimized)
      const collection = await getUserBonusCollection(options, tenantId);
      await updateOneById(
        collection,
        bonusId,
        {
          $set: {
            status: newStatus,
            updatedAt: new Date(),
            ...additionalFields,
          },
          $push: { history: historyEntry as any },
        }
      );
    },

    /**
     * Update turnover progress
     */
    async updateTurnover(
      bonusId: string,
      turnoverProgress: number,
      newStatus: BonusStatus,
      historyEntry: BonusHistoryEntry,
      tenantId?: string
    ): Promise<void> {
      // Use optimized updateOneById utility (performance-optimized)
      const collection = await getUserBonusCollection(options, tenantId);
      await updateOneById(
        collection,
        bonusId,
        {
          $set: {
            turnoverProgress,
            status: newStatus,
            updatedAt: new Date(),
          },
          $push: { history: historyEntry as any },
        }
      );
    },

    /**
     * Delete a user bonus by ID
     */
    async delete(bonusId: string, tenantId?: string): Promise<void> {
      // Use optimized deleteOneById utility (performance-optimized)
      const collection = await getUserBonusCollection(options, tenantId);
      await deleteOneById(collection, bonusId);
    },

    /**
     * Find bonuses expiring soon (for cron job)
     */
    async findExpiring(tenantId?: string): Promise<UserBonus[]> {
      const collection = await getUserBonusCollection(options, tenantId);
      const docs = await collection.find({
        status: { $in: ['pending', 'active', 'in_progress'] },
        expiresAt: { $lt: new Date() },
      }).toArray();
      // Normalize all documents to map _id to id
      return normalizeDocuments(docs as any[]) as UserBonus[];
    },

    /**
     * Get referral summary for a user
     */
    async getReferralSummary(userId: string, currency: Currency = 'USD', tenantId?: string): Promise<ReferralSummary> {
      // Get all referral bonuses for this user (where they are the referrer)
      const collection = await getUserBonusCollection(options, tenantId);
      const docs = await collection.find({
        userId,
        type: 'referral',
      }).toArray();
      // Normalize all documents to map _id to id
      const referralBonuses = normalizeDocuments(docs as any[]) as UserBonus[];
      
      const qualified = referralBonuses.filter(b => 
        ['active', 'in_progress', 'converted', 'claimed'].includes(b.status)
      );
      
      const totalEarnings = qualified.reduce((sum, b) => sum + b.originalValue, 0);
      
      // Build referees list
      const referees = referralBonuses.map(b => ({
        refereeId: b.refereeId!,
        status: (['active', 'in_progress', 'converted', 'claimed'].includes(b.status) 
          ? 'rewarded' 
          : b.status === 'pending' ? 'pending' : 'qualified'
        ) as 'pending' | 'qualified' | 'rewarded',
        bonusId: b.id,
        earnedAmount: b.originalValue,
        qualifiedAt: b.qualifiedAt,
      }));
      
      return {
        userId,
        referralCode: `REF-${userId.substring(0, 8).toUpperCase()}`, // Generate code
        totalReferrals: referralBonuses.length,
        qualifiedReferrals: qualified.length,
        totalEarnings,
        currency,
        referees,
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Transaction Operations
// ═══════════════════════════════════════════════════════════════════

export function createTransactionPersistence(options: BonusPersistenceOptions) {
  return {
    async findById(id: string, tenantId?: string): Promise<BonusTransaction | null> {
      // Use optimized findOneById utility (performance-optimized)
      const collection = await getTransactionCollection(options, tenantId);
      const doc = await findOneById<BonusTransaction>(collection, id, {});
      return normalizeDocument(doc);
    },

    async findByBonusId(userBonusId: string, tenantId?: string): Promise<BonusTransaction[]> {
      const collection = await getTransactionCollection(options, tenantId);
      const docs = await collection.find({ userBonusId }).toArray();
      // Normalize all documents to map _id to id
      return normalizeDocuments(docs as any[]) as BonusTransaction[];
    },

    async findByUserId(userId: string, tenantId?: string): Promise<BonusTransaction[]> {
      const collection = await getTransactionCollection(options, tenantId);
      const docs = await collection.find({ userId }).toArray();
      // Normalize all documents to map _id to id
      return normalizeDocuments(docs as any[]) as BonusTransaction[];
    },

    /**
     * Create transaction
     * Uses MongoDB ObjectId for performant single-insert operation
     */
    async create(transaction: Omit<BonusTransaction, 'id'>, tenantId?: string): Promise<BonusTransaction> {
      const now = new Date();
      // Generate MongoDB ObjectId for performant single-insert operation
      const { objectId, idString } = generateMongoId();
      const txWithTimestamps = {
        _id: objectId,
        id: idString,
        ...transaction,
        createdAt: now,
        updatedAt: now,
      };
      const collection = await getTransactionCollection(options, tenantId);
      await collection.insertOne(txWithTimestamps as any);
      return txWithTimestamps as BonusTransaction;
    },

    /**
     * Get total turnover for a bonus
     */
    async getTotalTurnover(userBonusId: string, tenantId?: string): Promise<number> {
      const collection = await getTransactionCollection(options, tenantId);
      const docs = await collection.find({
        userBonusId,
        type: 'turnover',
      }).toArray();
      const transactions = docs as unknown as BonusTransaction[];
      return transactions.reduce((sum, t) => sum + (t.turnoverContribution || 0), 0);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Main Factory Function
// ═══════════════════════════════════════════════════════════════════

/**
 * Create all persistence modules with database strategy support
 * 
 * @example
 * ```typescript
 * const persistence = createBonusPersistence({
 *   databaseStrategy: myStrategy,
 *   defaultContext: { service: 'bonus-service' }
 * });
 * 
 * const template = await persistence.template.findByCode('WELCOME');
 * ```
 */
export function createBonusPersistence(options: BonusPersistenceOptions) {
  return {
    template: createTemplatePersistence(options),
    userBonus: createUserBonusPersistence(options),
    transaction: createTransactionPersistence(options),
  };
}

