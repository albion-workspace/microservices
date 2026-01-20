/**
 * Competition & Custom Bonus Handlers
 * 
 * Handles: tournament, leaderboard, custom bonuses
 */

import { getDatabase, logger } from 'core-service';
import type { BonusTemplate, BonusType, UserBonus } from '../../../types.js';
import { BaseBonusHandler } from '../base-handler.js';
import type { BonusContext, EligibilityResult, BonusCalculation } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Tournament Handler
// ═══════════════════════════════════════════════════════════════════

export class TournamentHandler extends BaseBonusHandler {
  readonly type: BonusType = 'tournament';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    const tournamentId = context.metadata?.tournamentId as string;
    const position = context.metadata?.position as number;
    
    if (!tournamentId) {
      return {
        eligible: false,
        reason: 'Tournament ID required',
      };
    }

    if (!position || position < 1) {
      return {
        eligible: false,
        reason: 'Valid tournament position required',
      };
    }

    // Check if tournament bonus already claimed
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'tournament',
      'metadata.tournamentId': tournamentId,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Tournament bonus already claimed',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Tournament value based on position
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const position = (context.metadata?.position as number) || 1;
    const baseValue = template.value;
    
    // Position-based multipliers (configurable via template)
    const positionMultipliers = (template as any).positionMultipliers || {
      1: 1.0,
      2: 0.6,
      3: 0.4,
      4: 0.2,
      5: 0.15,
    };
    
    const multiplier = positionMultipliers[position] || 0.1;
    return Math.floor(baseValue * multiplier);
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      tournamentId: context.metadata?.tournamentId,
      tournamentName: context.metadata?.tournamentName,
      position: context.metadata?.position,
    };
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Leaderboard Handler
// ═══════════════════════════════════════════════════════════════════

export class LeaderboardHandler extends BaseBonusHandler {
  readonly type: BonusType = 'leaderboard';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    const leaderboardId = context.metadata?.leaderboardId as string;
    const period = context.metadata?.period as string; // e.g., "2026-W01" or "2026-01"
    const rank = context.metadata?.rank as number;
    
    if (!leaderboardId || !period) {
      return {
        eligible: false,
        reason: 'Leaderboard ID and period required',
      };
    }

    if (!rank || rank < 1) {
      return {
        eligible: false,
        reason: 'Valid leaderboard rank required',
      };
    }

    // Check if leaderboard bonus already claimed for this period
    const existing = await userBonuses.findOne({
      userId: context.userId,
      type: 'leaderboard',
      'metadata.leaderboardId': leaderboardId,
      'metadata.period': period,
    });

    if (existing) {
      return {
        eligible: false,
        reason: 'Leaderboard bonus already claimed for this period',
      };
    }

    return { eligible: true, template };
  }

  /**
   * Leaderboard value based on rank
   */
  protected calculateValue(template: BonusTemplate, context: BonusContext): number {
    const rank = (context.metadata?.rank as number) || 1;
    const baseValue = template.value;
    
    // Rank-based multipliers
    const rankMultipliers = (template as any).rankMultipliers || {
      1: 1.0,
      2: 0.7,
      3: 0.5,
      4: 0.35,
      5: 0.25,
      10: 0.15,
      20: 0.1,
      50: 0.05,
    };
    
    // Find the closest rank tier
    let multiplier = 0.05; // Default for ranks > 50
    for (const [r, m] of Object.entries(rankMultipliers).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (rank <= Number(r)) {
        multiplier = m as number;
        break;
      }
    }
    
    return Math.floor(baseValue * multiplier);
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      leaderboardId: context.metadata?.leaderboardId,
      leaderboardName: context.metadata?.leaderboardName,
      period: context.metadata?.period,
      rank: context.metadata?.rank,
    };
    return bonus;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Custom Handler (catch-all for admin-defined bonuses)
// ═══════════════════════════════════════════════════════════════════

export class CustomHandler extends BaseBonusHandler {
  readonly type: BonusType = 'custom';

  protected async validateSpecific(
    template: BonusTemplate,
    context: BonusContext
  ): Promise<EligibilityResult> {
    // Custom bonuses are highly flexible - minimal validation
    // Business logic should be defined in template or via external system
    
    const db = getDatabase();
    const userBonuses = db.collection('user_bonuses');

    // Check per-user usage limits
    if (template.maxUsesPerUser) {
      const userUsageCount = await userBonuses.countDocuments({
        userId: context.userId,
        templateId: template.id,
      });

      if (userUsageCount >= template.maxUsesPerUser) {
        return {
          eligible: false,
          reason: `Maximum uses (${template.maxUsesPerUser}) reached for this user`,
        };
      }
    }

    return { eligible: true, template };
  }

  protected buildUserBonus(
    template: BonusTemplate,
    context: BonusContext,
    calculation: BonusCalculation,
    now: Date
  ): Omit<UserBonus, 'id'> {
    const bonus = super.buildUserBonus(template, context, calculation, now);
    // Pass through any custom metadata
    (bonus as any).metadata = {
      ...((bonus as any).metadata || {}),
      ...(context.metadata || {}),
    };
    return bonus;
  }
}

