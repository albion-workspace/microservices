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

import { getDatabase, logger } from 'core-service';
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
// Collection Access
// ═══════════════════════════════════════════════════════════════════

function getTemplateCollection() {
  return getDatabase().collection('bonus_templates');
}

function getUserBonusCollection() {
  return getDatabase().collection('user_bonuses');
}

function getTransactionCollection() {
  return getDatabase().collection('bonus_transactions');
}

// ═══════════════════════════════════════════════════════════════════
// Template Operations
// ═══════════════════════════════════════════════════════════════════

export const templatePersistence = {
  async findById(id: string): Promise<BonusTemplate | null> {
    const doc = await getTemplateCollection().findOne({ id });
    return doc as unknown as BonusTemplate | null;
  },

  async findByCode(code: string): Promise<BonusTemplate | null> {
    const doc = await getTemplateCollection().findOne({ code });
    return doc as unknown as BonusTemplate | null;
  },

  async findByType(type: BonusType): Promise<BonusTemplate[]> {
    const now = new Date();
    const docs = await getTemplateCollection().find({
      type,
      isActive: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    }).toArray();
    return docs as unknown as BonusTemplate[];
  },

  async findByTypes(types: BonusType[]): Promise<BonusTemplate[]> {
    const now = new Date();
    const docs = await getTemplateCollection().find({
      type: { $in: types },
      isActive: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    }).toArray();
    return docs as unknown as BonusTemplate[];
  },

  async findActive(filter?: Record<string, unknown>): Promise<BonusTemplate[]> {
    const now = new Date();
    const docs = await getTemplateCollection().find({
      ...filter,
      isActive: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    }).toArray();
    return docs as unknown as BonusTemplate[];
  },

  async findReferralTemplates(): Promise<{ referrer?: BonusTemplate; referee?: BonusTemplate }> {
    const now = new Date();
    const docs = await getTemplateCollection().find({
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

  async incrementUsage(templateId: string): Promise<void> {
    await getTemplateCollection().updateOne(
      { id: templateId },
      { $inc: { currentUsesTotal: 1 } }
    );
  },
};

// ═══════════════════════════════════════════════════════════════════
// User Bonus Operations
// ═══════════════════════════════════════════════════════════════════

export const userBonusPersistence = {
  async findById(id: string): Promise<UserBonus | null> {
    const doc = await getUserBonusCollection().findOne({ id });
    return doc as unknown as UserBonus | null;
  },

  async findByUserId(userId: string, filter?: Record<string, unknown>): Promise<UserBonus[]> {
    const docs = await getUserBonusCollection().find({ userId, ...filter }).toArray();
    return docs as unknown as UserBonus[];
  },

  async findActiveByUserId(userId: string): Promise<UserBonus[]> {
    const docs = await getUserBonusCollection().find({
      userId,
      status: { $in: ['active', 'in_progress', 'pending'] },
    }).toArray();
    return docs as unknown as UserBonus[];
  },

  async countByTemplate(userId: string, templateId: string): Promise<number> {
    return getUserBonusCollection().countDocuments({ userId, templateId });
  },

  async countByType(userId: string, types: BonusType[]): Promise<number> {
    return getUserBonusCollection().countDocuments({ 
      userId, 
      type: { $in: types } 
    });
  },

  /**
   * Count referrals made by a user
   */
  async countReferralsByUser(referrerId: string): Promise<number> {
    return getUserBonusCollection().countDocuments({
      type: 'referral',
      refereeId: { $exists: true },
      userId: referrerId,
      status: { $in: ['active', 'converted', 'claimed'] },
    });
  },

  /**
   * Check if user was already referred
   */
  async isUserReferred(userId: string): Promise<boolean> {
    const count = await getUserBonusCollection().countDocuments({
      type: 'referee',
      userId,
    });
    return count > 0;
  },

  /**
   * Create a user bonus
   */
  async create(bonus: UserBonus): Promise<UserBonus> {
    const now = new Date();
    const bonusWithTimestamps = {
      ...bonus,
      createdAt: now,
      updatedAt: now,
    };
    await getUserBonusCollection().insertOne(bonusWithTimestamps as any);
    return bonusWithTimestamps;
  },

  /**
   * Update bonus status with history entry
   */
  async updateStatus(
    bonusId: string, 
    newStatus: BonusStatus, 
    historyEntry: BonusHistoryEntry,
    additionalFields?: Record<string, unknown>
  ): Promise<void> {
    await getUserBonusCollection().updateOne(
      { id: bonusId },
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
    historyEntry: BonusHistoryEntry
  ): Promise<void> {
    await getUserBonusCollection().updateOne(
      { id: bonusId },
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
   * Find bonuses expiring soon (for cron job)
   */
  async findExpiring(): Promise<UserBonus[]> {
    const docs = await getUserBonusCollection().find({
      status: { $in: ['pending', 'active', 'in_progress'] },
      expiresAt: { $lt: new Date() },
    }).toArray();
    return docs as unknown as UserBonus[];
  },

  /**
   * Get referral summary for a user
   */
  async getReferralSummary(userId: string, currency: Currency = 'USD'): Promise<ReferralSummary> {
    // Get all referral bonuses for this user (where they are the referrer)
    const docs = await getUserBonusCollection().find({
      userId,
      type: 'referral',
    }).toArray();
    const referralBonuses = docs as unknown as UserBonus[];
    
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

// ═══════════════════════════════════════════════════════════════════
// Transaction Operations
// ═══════════════════════════════════════════════════════════════════

export const transactionPersistence = {
  async findById(id: string): Promise<BonusTransaction | null> {
    const doc = await getTransactionCollection().findOne({ id });
    return doc as unknown as BonusTransaction | null;
  },

  async findByBonusId(userBonusId: string): Promise<BonusTransaction[]> {
    const docs = await getTransactionCollection().find({ userBonusId }).toArray();
    return docs as unknown as BonusTransaction[];
  },

  async findByUserId(userId: string): Promise<BonusTransaction[]> {
    const docs = await getTransactionCollection().find({ userId }).toArray();
    return docs as unknown as BonusTransaction[];
  },

  /**
   * Create transaction
   */
  async create(transaction: BonusTransaction): Promise<BonusTransaction> {
    const now = new Date();
    const txWithTimestamps = {
      ...transaction,
      createdAt: now,
      updatedAt: now,
    };
    await getTransactionCollection().insertOne(txWithTimestamps as any);
    return txWithTimestamps;
  },

  /**
   * Get total turnover for a bonus
   */
  async getTotalTurnover(userBonusId: string): Promise<number> {
    const docs = await getTransactionCollection().find({
      userBonusId,
      type: 'turnover',
    }).toArray();
    const transactions = docs as unknown as BonusTransaction[];
    return transactions.reduce((sum, t) => sum + (t.turnoverContribution || 0), 0);
  },
};

// ═══════════════════════════════════════════════════════════════════
// Export all persistence modules
// ═══════════════════════════════════════════════════════════════════

export const persistence = {
  template: templatePersistence,
  userBonus: userBonusPersistence,
  transaction: transactionPersistence,
};

export default persistence;
