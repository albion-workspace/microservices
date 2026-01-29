/**
 * Bonus Approval Service
 * 
 * Handles bonus approval workflow using the generic pending operation approval service.
 * High-value bonuses require admin approval before being awarded.
 */

import { logger } from 'core-service';
import type { BonusTemplate } from '../types.js';
import type { BonusContext, BonusCalculation } from './bonus-engine/types.js';
import { getInitializedPersistence } from './bonus-engine/persistence-singleton.js';
import {
  createPendingOperationApprovalService,
  type PendingOperationData,
  type ApprovalContext,
  type RejectionContext,
  type ApprovalResult,
} from './pending-operation-approval.js';

export interface PendingBonusData extends PendingOperationData {
  userId: string;
  tenantId: string;
  templateId: string;
  templateCode: string;
  bonusType: string;
  calculatedValue: number;
  currency: string;
  depositAmount?: number;
  context: BonusContext;
  calculation: BonusCalculation;
  requestedBy?: string;
  reason?: string;
}

export interface BonusApprovalResult extends ApprovalResult {
  bonusId?: string;
}

// Create generic approval service for bonuses
const approvalService = createPendingOperationApprovalService<PendingBonusData>({
  operationType: 'bonus',
  redisKeyPrefix: 'pending:bonus:',
  defaultExpiration: '24h',
});

// Register bonus-specific approval handler
approvalService.registerApprovalHandler(async (data, context) => {
  const persistence = await getInitializedPersistence();
  const template = await persistence.template.findByCode(data.templateCode);
  
  if (!template) {
    return { success: false, error: 'Template not found' };
  }

  // Lazy import to avoid circular dependency
  const { getHandler } = await import('./bonus-engine/index.js');
  const handler = getHandler(template.type as any);
  if (!handler) {
    return { success: false, error: `No handler for bonus type: ${template.type}` };
  }

  const result = await handler.award(template, data.context, true);
  
  if (!result.success || !result.bonus) {
    return { success: false, error: result.error || 'Failed to award bonus' };
  }

  logger.info('Pending bonus approved and awarded', {
    bonusId: result.bonus.id,
    userId: data.userId,
    approvedBy: context.approvedBy,
    approvedByUserId: context.approvedByUserId,
    value: data.calculatedValue,
  });

  return { success: true, resultId: result.bonus.id };
});

/**
 * Check if bonus requires approval
 */
export function requiresApproval(
  template: BonusTemplate,
  calculatedValue: number
): boolean {
  if (!template.requiresApproval) {
    return false;
  }
  
  if (template.approvalThreshold) {
    return calculatedValue >= template.approvalThreshold;
  }
  
  return true;
}

/**
 * Create pending bonus approval request
 */
export async function createPendingBonus(
  template: BonusTemplate,
  context: BonusContext,
  calculation: BonusCalculation,
  requestedBy?: string,
  reason?: string
): Promise<string> {
  const data: PendingBonusData = {
    userId: context.userId,
    tenantId: context.tenantId || 'default',
    templateId: template.id,
    templateCode: template.code,
    bonusType: template.type,
    calculatedValue: calculation.bonusValue,
    currency: context.currency || 'USD',
    depositAmount: context.depositAmount,
    context,
    calculation,
    requestedAt: Date.now(),
    requestedBy,
    reason,
  };

  const token = await approvalService.createPendingOperation(data, {
    templateName: template.name,
    bonusType: template.type,
    value: calculation.bonusValue,
    currency: context.currency || 'USD',
  });

  logger.info('Pending bonus approval created', {
    token,
    userId: context.userId,
    templateCode: template.code,
    value: calculation.bonusValue,
  });

  return token;
}

/**
 * Approve pending bonus
 */
export async function approvePendingBonus(
  token: string,
  approvedBy: string,
  approvedByUserId: string
): Promise<BonusApprovalResult> {
  const result = await approvalService.approvePendingOperation(token, {
    approvedBy,
    approvedByUserId,
  });

  return {
    success: result.success,
    bonusId: result.resultId,
    error: result.error,
  };
}

/**
 * Reject pending bonus
 */
export async function rejectPendingBonus(
  token: string,
  rejectedBy: string,
  rejectedByUserId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  return await approvalService.rejectPendingOperation(token, {
    rejectedBy,
    rejectedByUserId,
    reason,
  });
}

/**
 * List all pending bonus approvals
 */
export async function listPendingBonuses(
  filter?: { userId?: string; templateCode?: string }
): Promise<Array<{ token: string; data: PendingBonusData; expiresAt: number }>> {
  return await approvalService.listPendingOperations(filter);
}

/**
 * Get pending bonus by token
 */
export async function getPendingBonus(
  token: string
): Promise<PendingBonusData | null> {
  return await approvalService.getPendingOperation(token);
}

/**
 * Get raw pending bonus data including metadata, TTL, and full payload
 * Useful for debugging and admin inspection
 */
export async function getPendingBonusRawData(
  token: string
): Promise<{
  token: string;
  data: PendingBonusData;
  metadata?: Record<string, unknown>;
  expiresAt: number;
  ttlSeconds: number;
  createdAt?: number;
} | null> {
  return await approvalService.getPendingOperationRawData(token);
}
