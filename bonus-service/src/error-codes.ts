/**
 * Bonus Service Error Codes
 * 
 * Complete list of all error codes used by bonus-service.
 * Used for GraphQL error discovery and i18n key generation.
 * 
 * Usage: Import constants and use directly with GraphQLError
 * ```typescript
 * import { GraphQLError } from 'core-service';
 * import { BONUS_ERRORS } from './error-codes.js';
 * 
 * throw new GraphQLError(BONUS_ERRORS.TemplateNotFound, { templateCode });
 * ```
 * 
 * Constants are the single source of truth - array is derived from them
 */
export const BONUS_ERRORS = {
  FailedToUpdateTemplate: 'MSBonusFailedToUpdateTemplate',
  TemplateNotFound: 'MSBonusTemplateNotFound',
  TemplateNotLoaded: 'MSBonusTemplateNotLoaded',
  UserNotEligible: 'MSBonusUserNotEligible',
  BonusRequiresApproval: 'MSBonusBonusRequiresApproval',
  BonusAwardFailed: 'MSBonusBonusAwardFailed',
  BonusWrongTemplate: 'MSBonusBonusWrongTemplate',
  BonusNotAwarded: 'MSBonusBonusNotAwarded',
  AwardedBonusNotFound: 'MSBonusAwardedBonusNotFound',
  FailedToGetSystemUserId: 'MSBonusFailedToGetSystemUserId',
  ResolverNotFound: 'MSBonusResolverNotFound',
  SystemOrAdminAccessRequired: 'MSBonusSystemOrAdminAccessRequired',
  RedisNotAvailable: 'MSBonusRedisNotAvailable',
  TemplateNotActive: 'MSBonusTemplateNotActive',
  NoHandlerForBonusType: 'MSBonusNoHandlerForBonusType',
} as const;

/**
 * Array derived from constants - no duplication, automatically synced
 * Used for GraphQL error discovery query registration
 */
export const BONUS_ERROR_CODES = Object.values(BONUS_ERRORS) as readonly string[];

export type BonusErrorCode = typeof BONUS_ERRORS[keyof typeof BONUS_ERRORS];
