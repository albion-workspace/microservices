/**
 * Auth Service Error Codes
 * 
 * Complete list of all error codes used by auth-service.
 * Used for GraphQL error discovery and i18n key generation.
 * 
 * Usage: Import constants and use directly with GraphQLError
 * ```typescript
 * import { GraphQLError } from 'core-service';
 * import { AUTH_ERRORS } from './error-codes.js';
 * 
 * throw new GraphQLError(AUTH_ERRORS.UserNotFound, { userId: _id });
 * ```
 * 
 * Constants are the single source of truth - array is derived from them
 */
export const AUTH_ERRORS = {
  InsufficientPermissions: 'MSAuthInsufficientPermissions',
  UserIdRequired: 'MSAuthUserIdRequired',
  TenantIdRequired: 'MSAuthTenantIdRequired',
  FailedToFetchUsers: 'MSAuthFailedToFetchUsers',
  RoleRequired: 'MSAuthRoleRequired',
  FailedToFetchUsersByRole: 'MSAuthFailedToFetchUsersByRole',
  RolesMustBeArray: 'MSAuthRolesMustBeArray',
  UserNotFound: 'MSAuthUserNotFound',
  FailedToUpdateUserRoles: 'MSAuthFailedToUpdateUserRoles',
  PermissionsMustBeArray: 'MSAuthPermissionsMustBeArray',
  FailedToUpdateUserPermissions: 'MSAuthFailedToUpdateUserPermissions',
  StatusRequired: 'MSAuthStatusRequired',
  InvalidStatus: 'MSAuthInvalidStatus',
  FailedToUpdateUserStatus: 'MSAuthFailedToUpdateUserStatus',
  TokenRequired: 'MSAuthTokenRequired',
  SystemOrAdminAccessRequired: 'MSAuthSystemOrAdminAccessRequired',
  RedisNotAvailable: 'MSAuthRedisNotAvailable',
  SessionMissingId: 'MSAuthSessionMissingId',
  SessionNotFound: 'MSAuthSessionNotFound',
  RoleNotFound: 'MSAuthRoleNotFound',
  EmailAndIdRequiredForPasswordReset: 'MSAuthEmailAndIdRequiredForPasswordReset',
  PhoneAndIdRequiredForPasswordReset: 'MSAuthPhoneAndIdRequiredForPasswordReset',
} as const;

/**
 * Array derived from constants - no duplication, automatically synced
 * Used for GraphQL error discovery query registration
 */
export const AUTH_ERROR_CODES = Object.values(AUTH_ERRORS) as readonly string[];

export type AuthErrorCode = typeof AUTH_ERRORS[keyof typeof AUTH_ERRORS];
