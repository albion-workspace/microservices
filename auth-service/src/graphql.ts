/**
 * GraphQL Schema and Resolvers for Auth Service
 */

import type { ResolverContext, UserContext } from 'core-service';
import { 
  requireAuth, 
  getUserId, 
  getTenantId, 
  logger,
  findById,
  extractDocumentId,
  normalizeDocument,
  findOneAndUpdateById,
  paginateCollection,
  scanKeysIterator,
  createPendingOperationStore,
  GraphQLError,
  type CursorPaginationOptions,
  type CursorPaginationResult,
} from 'core-service';
import { db } from './database.js';
import { redis } from './redis.js';
import { AUTH_ERRORS } from './error-codes.js';
import { matchAnyUrn, hasAnyRole } from 'core-service/access';
import { checkSystemOrPermission } from 'core-service';
import { 
  rolesToArray, 
  normalizeUser, 
  normalizeUsers, 
  permissionsToArray,
  extractToken,
  extractOperationTypeFromKey,
  buildPendingOperationPatterns,
  keyMatchesToken,
} from './utils.js';
import type { 
  RegisterInput, 
  LoginInput, 
  SendOTPInput, 
  VerifyOTPInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
  Enable2FAInput,
  Verify2FAInput,
  RefreshTokenInput,
} from './types.js';

// GraphQL Type Definitions
export const authGraphQLTypes = `
  # ═══════════════════════════════════════════════════════════════
  # Types
  # ═══════════════════════════════════════════════════════════════
  
  type User {
    id: ID!
    tenantId: String!
    username: String
    email: String
    phone: String
    status: String!
    emailVerified: Boolean!
    phoneVerified: Boolean!
    twoFactorEnabled: Boolean!
    roles: [String!]!
    permissions: [String!]!
    metadata: JSON
    createdAt: String!
    updatedAt: String!
    lastLoginAt: String
  }
  
  type TokenPair {
    accessToken: String!
    refreshToken: String!
    expiresIn: Int!
    refreshExpiresIn: Int!
  }
  
  type AuthResponse {
    success: Boolean!
    message: String
    user: User
    tokens: TokenPair
    requiresOTP: Boolean
    otpSentTo: String
    otpChannel: String
    registrationToken: String  # JWT token for unverified registration (expires in 24h)
  }
  
  type ForgotPasswordResponse {
    success: Boolean!
    message: String!
    channel: String
    resetToken: String  # JWT token for password reset (expires in 30m) - for testing/debugging
  }
  
  type OTPResponse {
    success: Boolean!
    message: String!
    otpSentTo: String
    channel: String
    expiresIn: Int
    otpToken: String  # JWT token with OTP embedded (for verification)
  }
  
  type TwoFactorSetup {
    success: Boolean!
    message: String
    secret: String
    qrCode: String
    backupCodes: [String!]
  }
  
  type BackupCodesResponse {
    success: Boolean!
    backupCodes: [String!]
    message: String
  }
  
  type Session {
    sessionId: ID!
    deviceInfo: JSON
    createdAt: String!
    lastAccessedAt: String!
    isValid: Boolean!
  }
  
  type LogoutAllResponse {
    success: Boolean!
    count: Int!
  }
  
  type PendingOperation {
    token: String!
    operationType: String!
    recipient: String
    channel: String
    purpose: String
    createdAt: String!
    expiresAt: String
    expiresIn: Int  # seconds until expiration
    metadata: JSON
    # Note: Sensitive data (OTP codes, passwords) is NOT exposed
  }
  
  type PendingOperationConnection {
    nodes: [PendingOperation!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }
  
  # Note: BasicResponse and PageInfo are defined in core-service base schema
  
  # ═══════════════════════════════════════════════════════════════
  # Inputs
  # ═══════════════════════════════════════════════════════════════
  
  input RegisterInput {
    tenantId: String!
    username: String
    email: String
    phone: String
    password: String
    metadata: JSON
    autoVerify: Boolean
    sendOTP: Boolean
  }
  
  input LoginInput {
    tenantId: String!
    identifier: String!
    identifierType: String
    password: String!
    twoFactorCode: String
    deviceId: String
    ipAddress: String
    userAgent: String
  }
  
  input SendOTPInput {
    tenantId: String!
    recipient: String!
    channel: String!
    purpose: String!
    userId: String
  }
  
  input VerifyOTPInput {
    tenantId: String!
    code: String!
    otpToken: String!  # JWT token from sendOTP response (required)
  }
  
  input ForgotPasswordInput {
    tenantId: String!
    identifier: String!
  }
  
  input ResetPasswordInput {
    tenantId: String!
    token: String!  # JWT reset token (from forgotPassword)
    newPassword: String!
    otpCode: String  # Optional: OTP code for SMS/WhatsApp-based reset
  }
  
  input ChangePasswordInput {
    userId: String!
    tenantId: String!
    currentPassword: String!
    newPassword: String!
  }
  
  input Enable2FAInput {
    userId: String
    tenantId: String
    password: String!
  }
  
  input Verify2FAInput {
    userId: String
    tenantId: String
    token: String!
  }
  
  input RefreshTokenInput {
    refreshToken: String!
    tenantId: String!
  }
  
  input VerifyRegistrationInput {
    registrationToken: String!
    otpCode: String!
    tenantId: String!
  }
  
  input UpdateUserRolesInput {
    userId: ID!
    tenantId: String!
    roles: [String!]!
  }
  
  input UpdateUserPermissionsInput {
    userId: ID!
    tenantId: String!
    permissions: [String!]!
  }
  
  input UpdateUserStatusInput {
    userId: ID!
    tenantId: String!
    status: String!
  }
  
  # ═══════════════════════════════════════════════════════════════
  # Queries
  # ═══════════════════════════════════════════════════════════════
  
  extend type Query {
    # Get current user (requires authentication)
    me: User
    
    # Get user by ID (system only)
    getUser(id: ID!, tenantId: String!): User
    
    # List all users (system only) - cursor-based pagination
    users(tenantId: String, first: Int, after: String, last: Int, before: String): UserConnection!
    
    # Get users by role (system only) - cursor-based pagination
    usersByRole(role: String!, tenantId: String, first: Int, after: String, last: Int, before: String): UserConnection!
    
    # Get user's active sessions
    mySessions: [Session!]!
    
    # Health check
    authHealth: String!
    
    # List pending operations (Redis-based only)
    # Users see only their own operations, admins see all
    pendingOperations(
      operationType: String
      recipient: String
      first: Int
      after: String
    ): PendingOperationConnection!
    
    # Get specific pending operation by token
    # Works for both JWT and Redis-based operations
    pendingOperation(
      token: String!
      operationType: String
    ): PendingOperation
    
    # Get all distinct operation types from Redis
    # Returns all operation types that exist in Redis (regardless of whether operations exist)
    pendingOperationTypes: [String!]!
    
    # Get raw pending operation data (generic - works for any operation type)
    # Returns complete raw data including metadata, TTL, and full payload
    pendingOperationRawData(
      token: String!
      operationType: String
    ): JSON
  }
  
  type UserConnection {
    nodes: [User!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }
  
  # ═══════════════════════════════════════════════════════════════
  # Mutations
  # ═══════════════════════════════════════════════════════════════
  
  extend type Mutation {
    # Registration
    register(input: RegisterInput!): AuthResponse!
    verifyRegistration(input: VerifyRegistrationInput!): AuthResponse!
    
    # Authentication
    login(input: LoginInput!): AuthResponse!
    logout(refreshToken: String!): BasicResponse!
    logoutAll: LogoutAllResponse!
    refreshToken(input: RefreshTokenInput!): AuthResponse!
    
    # OTP
    sendOTP(input: SendOTPInput!): OTPResponse!
    verifyOTP(input: VerifyOTPInput!): OTPResponse!
      resendOTP(recipient: String!, purpose: String!, tenantId: String!, otpToken: String!): OTPResponse!
    
    # Password Management
    forgotPassword(input: ForgotPasswordInput!): ForgotPasswordResponse!
    resetPassword(input: ResetPasswordInput!): BasicResponse!
    changePassword(input: ChangePasswordInput!): BasicResponse!
    
    # Two-Factor Authentication
    enable2FA(input: Enable2FAInput!): TwoFactorSetup!
    verify2FA(input: Verify2FAInput!): BasicResponse!
    disable2FA(password: String!): BasicResponse!
    regenerateBackupCodes(password: String!): BackupCodesResponse!
    
    # User Management (system only)
    updateUserRoles(input: UpdateUserRolesInput!): User!
    updateUserPermissions(input: UpdateUserPermissionsInput!): User!
    updateUserStatus(input: UpdateUserStatusInput!): User!
  }
`;

import type { Resolvers } from 'core-service';

/**
 * Create resolvers with service instances
 */
export function createAuthResolvers(
  registrationService: any,
  authenticationService: any,
  otpService: any,
  passwordService: any,
  twoFactorService: any,
  authConfig?: { jwtSecret?: string }
): Resolvers & Record<string, any> {
  return {
    User: {
      /**
       * Normalize roles field: extract role names from UserRole[] format
       */
      roles: (parent: any) => rolesToArray(parent.roles),
      /**
       * Normalize permissions field: convert object to array if needed
       */
      permissions: (parent: any) => permissionsToArray(parent.permissions),
    },
    Query: {
      /**
       * Get current authenticated user
       * 
       * NOTE: This query MUST throw UserNotFound error if the user no longer exists in DB
       * (e.g., user was deleted while token is still valid). This allows the frontend
       * to detect the scenario and clear auth state, forcing re-login.
       */
      me: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const database = await db.getDb();
        const userId = getUserId(ctx);
        const tenantId = getTenantId(ctx);
        
        // Use generic helper function for document lookup with automatic ObjectId handling
        const user = await findById(database.collection('users'), userId, { tenantId });
        
        // IMPORTANT: If user has valid token but user doesn't exist in DB (e.g., deleted),
        // throw UserNotFound error so frontend can detect and clear auth
        if (!user) {
          logger.warn('Authenticated user not found in database (may have been deleted)', { 
            userId, 
            tenantId 
          });
          throw new GraphQLError(AUTH_ERRORS.UserNotFound, { 
            userId, 
            tenantId,
            reason: 'User authenticated but not found in database - user may have been deleted'
          });
        }
        
        return normalizeUser(user);
      },
      
      /**
       * Get user by ID (system or user:read permission)
       */
      getUser: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const requestedUserId = (args as any).id;
        const isOwnProfile = ctx.user!.userId === requestedUserId;
        
        // Check permissions: system, user:read permission, or own profile
        // Using access-engine URN format: user:read:* or user:read:own
        const hasAccess = 
          checkSystemOrPermission(ctx.user, 'user', 'read', '*') ||
          (isOwnProfile && checkSystemOrPermission(ctx.user, 'user', 'read', 'own'));
        
        if (!hasAccess) {
          logger.warn('Unauthorized getUser attempt', { 
            userId: ctx.user!.userId,
            requestedUserId,
            isOwnProfile
          });
          throw new GraphQLError(AUTH_ERRORS.InsufficientPermissions, { 
            action: 'read user',
            requestedUserId 
          });
        }
        
        const database = await db.getDb();
        const userId = (args as any).id;
        const tenantId = (args as any).tenantId;
        
        if (!userId) {
          throw new GraphQLError(AUTH_ERRORS.UserIdRequired, {});
        }
        
        if (!tenantId) {
          throw new GraphQLError(AUTH_ERRORS.TenantIdRequired, {});
        }
        
        // Use generic helper function for document lookup with automatic ObjectId handling
        const user = await findById(database.collection('users'), userId, { tenantId });
        
        if (!user) {
          logger.debug('User not found', { userId, tenantId });
          return null;
        }
        
        return normalizeUser(user);
      },
      
      /**
       * List all users (system or user:list permission)
       * Uses cursor-based pagination for better performance and sharding compatibility
       */
      users: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        // Check permissions: system or user:list permission
        if (!checkSystemOrPermission(ctx.user, 'user', 'list', '*')) {
          logger.warn('Unauthorized users query attempt', { userId: ctx.user!.userId });
          throw new GraphQLError(AUTH_ERRORS.InsufficientPermissions, { 
            action: 'list users' 
          });
        }
        
        const database = await db.getDb();
        const { tenantId, first, after, last, before } = args as any;
        
        const filter: Record<string, unknown> = {};
        if (tenantId) {
          filter.tenantId = tenantId;
        }
        
        try {
          // Use cursor-based pagination (performance-optimized, sharding-friendly)
          const result = await paginateCollection(
            database.collection('users'),
            {
              first: first ? Math.min(Math.max(1, first), 100) : undefined, // Max 100 per page
              after,
              last: last ? Math.min(Math.max(1, last), 100) : undefined,
              before,
              filter,
              sortField: 'createdAt',
              sortDirection: 'desc',
            }
          );
          
          // Normalize users from edges
          const normalizedNodes = result.edges.map(edge => normalizeUser(edge.node));
          
          // Ensure totalCount is always a number (GraphQL requires Int!)
          // If filters are present, paginateCollection may return undefined, so count manually
          let totalCount = result.totalCount;
          if (totalCount === undefined || totalCount === null) {
            totalCount = await database.collection('users').countDocuments(filter);
          }
          
          return {
            nodes: normalizedNodes,
            totalCount: totalCount || 0, // Ensure it's never null/undefined
            pageInfo: result.pageInfo,
          };
        } catch (error) {
          throw new GraphQLError(AUTH_ERRORS.FailedToFetchUsers, { 
            tenantId,
            originalError: error instanceof Error ? error.message : String(error),
          });
        }
      },
      
      /**
       * Get users by role (system or user:list permission)
       * Uses cursor-based pagination for better performance and sharding compatibility
       */
      usersByRole: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        // Check permissions: system or user:list permission
        if (!checkSystemOrPermission(ctx.user, 'user', 'list', '*')) {
          logger.warn('Unauthorized usersByRole query attempt', { 
            userId: ctx.user!.userId,
            requestedRole: (args as any).role 
          });
          throw new GraphQLError(AUTH_ERRORS.InsufficientPermissions, { 
            action: 'list users by role' 
          });
        }
        
        const database = await db.getDb();
        const { role, tenantId, first, after, last, before } = args as any;
        
        if (!role || typeof role !== 'string') {
          throw new GraphQLError(AUTH_ERRORS.RoleRequired, {});
        }
        
        const finalTenantId = tenantId || 'default-tenant';
        
        // MongoDB query: roles array contains the role
        // Handle both UserRole[] objects and string[] arrays
        const filter: Record<string, unknown> = {
          $or: [
            // Match UserRole[] objects: { role: "system", active: true, ... }
            { roles: { $elemMatch: { role: role, active: { $ne: false } } } },
            // Match string[] arrays: ["system", "user"] - MongoDB handles { roles: "role" } for arrays
            { roles: role },
          ],
          tenantId: finalTenantId,
        };
        
        logger.debug('Querying users by role', { role, tenantId: finalTenantId });
        
        try {
          // Use cursor-based pagination (performance-optimized, sharding-friendly)
          const result = await paginateCollection(
            database.collection('users'),
            {
              first: first ? Math.min(Math.max(1, first), 100) : undefined, // Max 100 per page
              after,
              last: last ? Math.min(Math.max(1, last), 100) : undefined,
              before,
              filter,
              sortField: 'createdAt',
              sortDirection: 'desc',
            }
          );
          
          // Normalize users from edges
          const normalizedNodes = result.edges.map(edge => normalizeUser(edge.node));
          
          // Ensure totalCount is always a number (GraphQL requires Int!)
          // If filters are present, paginateCollection may return undefined, so count manually
          let totalCount = result.totalCount;
          if (totalCount === undefined || totalCount === null) {
            totalCount = await database.collection('users').countDocuments(filter);
          }
          
          return {
            nodes: normalizedNodes,
            totalCount: totalCount || 0, // Ensure it's never null/undefined
            pageInfo: result.pageInfo,
          };
        } catch (error) {
          throw new GraphQLError(AUTH_ERRORS.FailedToFetchUsersByRole, { 
            role,
            tenantId: finalTenantId,
            originalError: error instanceof Error ? error.message : String(error),
          });
        }
      },
      
      /**
       * Get user's active sessions
       */
      mySessions: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const database = await db.getDb();
        const sessions = await database.collection('sessions')
          .find({
            userId: getUserId(ctx),
            tenantId: getTenantId(ctx),
            isValid: true,
          })
          .sort({ lastAccessedAt: -1 })
          .toArray();
        
        // Normalize sessions and map to GraphQL Session type
        return sessions
          .map((session: any) => {
            // Extract session ID using helper function
            const sessionId = extractDocumentId(session);
            
            // Skip sessions without an ID
            if (!sessionId) {
              logger.warn('Session missing ID field', { userId: getUserId(ctx), session });
              return null;
            }
            
            // Normalize the session document
            const normalized = normalizeDocument(session);
            
            // Map id to sessionId for GraphQL schema
            // Remove tokenHash and other sensitive fields
            const { tokenHash, token, _id, id, ...safeSession } = (normalized || session) as any;
            
            return {
              ...safeSession,
              sessionId, // Use extracted sessionId
            };
          })
          .filter(Boolean); // Remove any null entries
      },
      
      /**
       * Health check
       */
      authHealth: (args: Record<string, unknown>, ctx: ResolverContext) => 'Auth service is healthy',
    },
    
    Mutation: {
      /**
       * Register new user
       * 
       * Flow:
       * - If autoVerify=true: Creates user immediately in DB, returns user + tokens
       * - If sendOTP=true, autoVerify=false: Uses pending operation store (JWT), returns registrationToken
       * 
       * NOTE: OAuth registration bypasses this - OAuth providers already verify users,
       * so OAuth users are created directly with status='active' (see handleSocialAuth)
       */
      register: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        return await registrationService.register((args as any).input);
      },
      
      /**
       * Verify registration and create user in DB
       * 
       * Called after OTP verification:
       * - Verifies registrationToken (JWT from pending operation store)
       * - Verifies OTP code
       * - Creates user in DB with status='pending' (activated on first login)
       * - Returns user + tokens
       * 
       * NOTE: OAuth doesn't use this - OAuth users are created directly (see handleSocialAuth)
       */
      verifyRegistration: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        const input = (args as any).input;
        return await registrationService.verifyRegistration(
          input.registrationToken,
          input.otpCode,
          input.tenantId
        );
      },
      
      /**
       * Login user
       */
      login: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        return await authenticationService.login((args as any).input);
      },
      
      /**
       * Logout user
       */
      logout: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        return await authenticationService.logout(getUserId(ctx), (args as any).refreshToken);
      },
      
      /**
       * Logout from all devices
       */
      logoutAll: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        return await authenticationService.logoutAll(getUserId(ctx), getTenantId(ctx));
      },
      
      /**
       * Refresh access token
       */
      refreshToken: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        const input = (args as any).input;
        return await authenticationService.refreshToken(input.refreshToken, input.tenantId);
      },
      
      /**
       * Send OTP
       */
      sendOTP: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        const result = await otpService.sendOTP((args as any).input);
        return {
          success: result.success,
          message: result.message,
          otpSentTo: result.otpSentTo,
          channel: result.channel,
          expiresIn: result.expiresIn,
          otpToken: result.otpToken, // JWT token with OTP embedded
        };
      },
      
      /**
       * Verify OTP
       */
      verifyOTP: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        return await otpService.verifyOTP((args as any).input);
      },
      
      /**
       * Resend OTP
       */
      resendOTP: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        const { recipient, purpose, tenantId, otpToken } = args as any;
        const result = await otpService.resendOTP(recipient, purpose, tenantId, otpToken);
        return {
          success: result.success,
          message: result.message,
          otpSentTo: result.otpSentTo,
          channel: result.channel,
          expiresIn: result.expiresIn,
          otpToken: result.otpToken, // Return new otpToken
        };
      },
      
      /**
       * Forgot password
       * Returns resetToken (JWT) for testing/debugging
       * In production, you may want to remove resetToken from response
       */
      forgotPassword: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        const result = await passwordService.forgotPassword((args as any).input);
        return {
          success: result.success,
          message: result.message,
          channel: result.channel,
          resetToken: result.resetToken, // JWT token (for testing - remove in production if needed)
        };
      },
      
      /**
       * Reset password
       */
      resetPassword: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        return await passwordService.resetPassword((args as any).input);
      },
      
      /**
       * Change password
       */
      changePassword: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        return await passwordService.changePassword({
          ...(args as any).input,
          userId: getUserId(ctx),
          tenantId: getTenantId(ctx),
        });
      },
      
      /**
       * Enable 2FA
       */
      enable2FA: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        return await twoFactorService.enable2FA({
          ...(args as any).input,
          userId: getUserId(ctx),
          tenantId: getTenantId(ctx),
        });
      },
      
      /**
       * Verify 2FA
       */
      verify2FA: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        return await twoFactorService.verify2FA({
          ...(args as any).input,
          userId: getUserId(ctx),
          tenantId: getTenantId(ctx),
        });
      },
      
      /**
       * Disable 2FA
       */
      disable2FA: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        return await twoFactorService.disable2FA(getUserId(ctx), getTenantId(ctx), (args as any).password);
      },
      
      /**
       * Regenerate backup codes
       */
      regenerateBackupCodes: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        return await twoFactorService.regenerateBackupCodes({
          userId: getUserId(ctx),
          tenantId: getTenantId(ctx),
          password: (args as any).password,
        });
      },
      
      /**
       * Update user roles (system or user:update permission)
       */
      updateUserRoles: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const targetUserId = (args as any).input?.userId;
        
        // Check permissions: system or user:update permission
        if (!checkSystemOrPermission(ctx.user, 'user', 'update', '*')) {
          logger.warn('Unauthorized updateUserRoles attempt', { 
            userId: ctx.user!.userId,
            targetUserId
          });
          throw new GraphQLError(AUTH_ERRORS.InsufficientPermissions, { 
            action: 'update user roles' 
          });
        }
        
        const database = await db.getDb();
        const { userId, tenantId, roles } = (args as any).input;
        
        if (!userId) {
          throw new GraphQLError(AUTH_ERRORS.UserIdRequired, {});
        }
        
        if (!tenantId) {
          throw new GraphQLError(AUTH_ERRORS.TenantIdRequired, {});
        }
        
        if (!Array.isArray(roles)) {
          throw new GraphQLError(AUTH_ERRORS.RolesMustBeArray, {});
        }
        
        try {
          // Use optimized helper function for findOneAndUpdate (performance-optimized)
          const result = await findOneAndUpdateById(
            database.collection('users'),
            userId,
            { 
              $set: { 
                roles,
                updatedAt: new Date(),
              } 
            },
            { tenantId },
            { returnDocument: 'after' }
          );
          
          if (!result || !result.value) {
            logger.warn('User not found for role update', { userId, tenantId });
            throw new GraphQLError(AUTH_ERRORS.UserNotFound, { userId, tenantId });
          }
          
          logger.info('User roles updated', { 
            userId, 
            tenantId,
            updatedBy: ctx.user!.userId,
            roles 
          });
          
          return normalizeUser(result.value);
        } catch (error) {
          throw new GraphQLError(AUTH_ERRORS.FailedToUpdateUserRoles, { 
            userId,
            tenantId,
            originalError: error instanceof Error ? error.message : String(error),
          });
        }
      },
      
      /**
       * Update user permissions (system or user:update permission)
       */
      updateUserPermissions: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const targetUserId = (args as any).input?.userId;
        
        // Check permissions: system or user:update permission
        if (!checkSystemOrPermission(ctx.user, 'user', 'update', '*')) {
          logger.warn('Unauthorized updateUserPermissions attempt', { 
            userId: ctx.user!.userId,
            targetUserId
          });
          throw new GraphQLError(AUTH_ERRORS.InsufficientPermissions, { 
            action: 'update user permissions' 
          });
        }
        
        const database = await db.getDb();
        const { userId, tenantId, permissions } = (args as any).input;
        
        if (!userId) {
          throw new GraphQLError(AUTH_ERRORS.UserIdRequired, {});
        }
        
        if (!tenantId) {
          throw new GraphQLError(AUTH_ERRORS.TenantIdRequired, {});
        }
        
        if (!Array.isArray(permissions)) {
          throw new GraphQLError(AUTH_ERRORS.PermissionsMustBeArray, {});
        }
        
        try {
          // Use optimized helper function for findOneAndUpdate (performance-optimized)
          const result = await findOneAndUpdateById(
            database.collection('users'),
            userId,
            { 
              $set: { 
                permissions,
                updatedAt: new Date(),
              } 
            },
            { tenantId },
            { returnDocument: 'after' }
          );
          
          if (!result) {
            logger.warn('User not found for permission update', { userId, tenantId });
            throw new GraphQLError(AUTH_ERRORS.UserNotFound, { userId, tenantId });
          }
          
          logger.info('User permissions updated', { 
            userId, 
            tenantId,
            updatedBy: ctx.user!.userId,
            permissionsCount: permissions.length 
          });
          
          return normalizeUser(result);
        } catch (error) {
          throw new GraphQLError(AUTH_ERRORS.FailedToUpdateUserPermissions, { 
            userId,
            tenantId,
            originalError: error instanceof Error ? error.message : String(error),
          });
        }
      },
      
      /**
       * Update user status (system or user:update permission)
       */
      updateUserStatus: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const targetUserId = (args as any).input?.userId;
        
        // Check permissions: system or user:update permission
        if (!checkSystemOrPermission(ctx.user, 'user', 'update', '*')) {
          logger.warn('Unauthorized updateUserStatus attempt', { 
            userId: ctx.user!.userId,
            targetUserId
          });
          throw new Error('Unauthorized: Insufficient permissions to update user status');
        }
        
        const database = await db.getDb();
        const { userId, tenantId, status } = (args as any).input;
        
        if (!userId) {
          throw new Error('User ID is required');
        }
        
        if (!tenantId) {
          throw new Error('Tenant ID is required');
        }
        
        if (!status || typeof status !== 'string') {
          throw new Error('Status is required and must be a string');
        }
        
        const validStatuses = ['active', 'pending', 'suspended', 'locked'];
        if (!validStatuses.includes(status)) {
          throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
        
        try {
          // Use optimized helper function for findOneAndUpdate (performance-optimized)
          const result = await findOneAndUpdateById(
            database.collection('users'),
            userId,
            { 
              $set: { 
                status,
                updatedAt: new Date(),
              } 
            },
            { tenantId },
            { returnDocument: 'after' }
          );
          
          if (!result) {
            logger.warn('User not found for status update', { userId, tenantId });
            throw new GraphQLError(AUTH_ERRORS.UserNotFound, { userId, tenantId });
          }
          
          logger.info('User status updated', { 
            userId, 
            tenantId,
            updatedBy: ctx.user!.userId,
            status 
          });
          
          return normalizeUser(result);
        } catch (error) {
          throw new GraphQLError(AUTH_ERRORS.FailedToUpdateUserStatus, { 
            userId,
            tenantId,
            status,
            originalError: error instanceof Error ? error.message : String(error),
          });
        }
      },
      
      /**
       * List pending operations (Redis-based only)
       * Users see only their own operations, admins/system see all
       */
      pendingOperations: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const userId = getUserId(ctx);
        const tenantId = getTenantId(ctx);
        const user = ctx.user!;
        
        // Check if user is admin/system (can see all operations)
        const isAdmin = checkSystemOrPermission(user, 'user', 'read', '*') || 
                        hasAnyRole(['system', 'admin'])(user);
        
        if (!redis.isInitialized()) {
          logger.debug('Redis not available for pending operations query');
          return {
            nodes: [],
            totalCount: 0,
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: null,
              endCursor: null,
            },
          };
        }
        
        const redisClient = redis.getClient();
        const operationType = (args as any).operationType as string | undefined;
        const recipientFilter = (args as any).recipient as string | undefined;
        
        // Fetch user details if not admin (for filtering)
        let userEmail: string | undefined;
        let userPhone: string | undefined;
        if (!isAdmin) {
          const database = await db.getDb();
          const userDoc = await findById(database.collection('users'), userId, { tenantId });
          userEmail = userDoc?.email?.toLowerCase();
          userPhone = userDoc?.phone;
        }
        
        // Build Redis key pattern
        const pattern = operationType 
          ? `pending:${operationType}:*`
          : 'pending:*';
        
        const operations: Array<{
          token: string;
          operationType: string;
          recipient?: string;
          channel?: string;
          purpose?: string;
          createdAt: string;
          expiresAt: string | null;
          expiresIn: number;
          metadata: Record<string, unknown>;
        }> = [];
        
        // Scan Redis keys
        for await (const key of scanKeysIterator({ pattern, maxKeys: 1000 })) {
          try {
            const value = await redisClient.get(key);
            if (!value || typeof value !== 'string') continue;
            
            const payload = JSON.parse(value);
            const operationData = payload.data || {};
            
            // Extract token from key (format: pending:{operationType}:{token})
            const token = extractToken(key);
            
            // Filter by recipient if not admin
            if (!isAdmin) {
              const operationRecipient = operationData.recipient?.toLowerCase();
              
              // Skip if doesn't match user's email or phone
              if (operationRecipient !== userEmail?.toLowerCase() && 
                  operationRecipient !== userPhone) {
                continue;
              }
            }
            
            // Apply recipient filter if provided
            if (recipientFilter) {
              const operationRecipient = operationData.recipient?.toLowerCase();
              if (operationRecipient !== recipientFilter.toLowerCase()) {
                continue;
              }
            }
            
            // Get TTL (time to live in seconds)
            const ttl = await redisClient.ttl(key);
            
            // Sanitize metadata (remove sensitive data)
            const sanitizedMetadata = sanitizePendingOperationMetadata(operationData);
            
            operations.push({
              token,
              operationType: payload.operationType || 'unknown',
              recipient: operationData.recipient,
              channel: operationData.channel || operationData.otp?.channel,
              purpose: operationData.purpose || operationData.otp?.purpose,
              createdAt: new Date(payload.createdAt || Date.now()).toISOString(),
              expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
              expiresIn: ttl,
              metadata: sanitizedMetadata,
            });
          } catch (error) {
            logger.warn('Error parsing pending operation', { key, error });
            continue;
          }
        }
        
        // Sort by createdAt (newest first)
        operations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        // Apply pagination (simple offset-based for now, can be enhanced with cursor-based)
        const first = (args as any).first as number | undefined;
        const after = (args as any).after as string | undefined;
        
        let paginatedOps = operations;
        if (first) {
          const offset = after ? parseInt(Buffer.from(after, 'base64').toString()) || 0 : 0;
          paginatedOps = operations.slice(offset, offset + first);
        }
        
        return {
          nodes: paginatedOps,
          totalCount: operations.length,
          pageInfo: {
            hasNextPage: first ? paginatedOps.length === first && operations.length > (after ? parseInt(Buffer.from(after, 'base64').toString()) || 0 : 0) + first : false,
            hasPreviousPage: after ? parseInt(Buffer.from(after, 'base64').toString()) > 0 : false,
            startCursor: paginatedOps.length > 0 ? Buffer.from('0').toString('base64') : null,
            endCursor: paginatedOps.length > 0 ? Buffer.from(String(operations.indexOf(paginatedOps[paginatedOps.length - 1]))).toString('base64') : null,
          },
        };
      },
      
      /**
       * Get specific pending operation by token
       * Works for both JWT and Redis-based operations
       */
      pendingOperation: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const token = (args as any).token as string;
        const operationType = (args as any).operationType as string | undefined;
        
        if (!token) {
          throw new GraphQLError(AUTH_ERRORS.TokenRequired, {});
        }
        
        const jwtSecret = authConfig?.jwtSecret || 'shared-jwt-secret-change-in-production';
        
        // Try Redis first
        if (redis.isInitialized()) {
          const redisClient = redis.getClient();
          // Try to find in Redis
          const patterns = operationType 
            ? [`pending:${operationType}:${token}`]
            : [`pending:*:${token}`];
          
          for (const pattern of patterns) {
            // For exact match, try direct key lookup first
            const key = pattern.includes('*') 
              ? (await scanKeysIterator({ pattern, maxKeys: 1 }).next()).value
              : pattern;
            
            if (key && !key.includes('*')) {
              const value = await redisClient.get(key);
              if (value && typeof value === 'string') {
                try {
                  const payload = JSON.parse(value);
                  const operationData = payload.data || {};
                  const ttl = await redisClient.ttl(key);
                  
                  return {
                    token,
                    operationType: payload.operationType || 'unknown',
                    recipient: operationData.recipient,
                    channel: operationData.channel || operationData.otp?.channel,
                    purpose: operationData.purpose || operationData.otp?.purpose,
                    createdAt: new Date(payload.createdAt || Date.now()).toISOString(),
                    expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
                    expiresIn: ttl,
                    metadata: sanitizePendingOperationMetadata(operationData),
                  };
                } catch (error) {
                  logger.warn('Error parsing Redis pending operation', { key, error });
                }
              }
            }
          }
        }
        
        // Try JWT-based operation
        try {
          const store = createPendingOperationStore({ 
            backend: 'jwt', // Explicitly use JWT backend for checking JWT-based operations
            jwtSecret 
          });
          const exists = await store.exists(token, operationType || '');
          
          if (exists) {
            // For JWT, decode without consuming (for metadata only)
            // Note: We can't decode JWT without verification, so we'll use a different approach
            // Try to verify (but don't consume) - this is tricky with JWT
            
            // For now, return basic info - full implementation would require JWT decode utility
            // that doesn't consume the token
            return {
              token,
              operationType: operationType || 'unknown',
              recipient: null,
              channel: null,
              purpose: null,
              createdAt: new Date().toISOString(),
              expiresAt: null,
              expiresIn: null,
              metadata: {},
            };
          }
        } catch (error) {
          logger.debug('Error checking JWT pending operation', { error });
        }
        
        return null;
      },
      
      /**
       * Get all distinct operation types from Redis
       * Scans Redis keys to find all unique operation types
       */
      pendingOperationTypes: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        if (!redis.isInitialized()) {
          logger.debug('Redis not available for pending operation types query');
          return [];
        }
        
        const operationTypes = new Set<string>();
        
        // Scan all pending operation keys
        // Key pattern: pending:{operationType}:{token}
        const pattern = 'pending:*';
        
        try {
          for await (const key of scanKeysIterator({ pattern, maxKeys: 10000 })) {
            // Extract operation type from key: pending:{operationType}:{token}
            if (key.startsWith('pending:')) {
              const operationType = extractOperationTypeFromKey(key);
              if (operationType && operationType !== 'unknown') {
                operationTypes.add(operationType);
              }
            }
          }
        } catch (error) {
          return [];
        }
        
        // Return sorted array of unique operation types
        return Array.from(operationTypes).sort();
      },
      
      /**
       * Get raw pending operation data (generic - works for any operation type)
       * Returns complete raw data including metadata, TTL, and full payload
       */
      pendingOperationRawData: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const user = ctx.user!;
        const isAdmin = hasAnyRole(['system', 'admin'])(user);
        
        if (!isAdmin) {
          throw new GraphQLError(AUTH_ERRORS.SystemOrAdminAccessRequired, {});
        }
        
        const originalToken = args.token as string;
        const operationType = args.operationType as string | undefined;
        const token = extractToken(originalToken);
        
        if (!redis.isInitialized()) {
          throw new GraphQLError(AUTH_ERRORS.RedisNotAvailable, {});
        }
        
        const redisClient = redis.getClient();
        
        // Determine if this is an approval operation
        const isApprovalOperation = operationType === 'approval' || 
          (!operationType && originalToken.includes('approval'));
        
        const patterns = buildPendingOperationPatterns(
          token,
          isApprovalOperation ? 'approval' : operationType
        );
        
        logger.debug('Searching for pending operation raw data', {
          originalToken,
          extractedToken: token,
          operationType,
          patterns,
        });
        
        // Try direct key lookups first (no wildcards) - most efficient
        const directResult = await tryDirectKeyLookups(redisClient, patterns, token, originalToken, operationType);
        if (directResult) {
          return directResult;
        }
        
        // If direct lookups failed, try scanning with wildcards
        const scanResult = await tryWildcardScan(redisClient, patterns, token, originalToken, operationType);
        if (scanResult) {
          return scanResult;
        }
        
        logger.warn('Pending operation not found', {
          originalToken,
          extractedToken: token,
          operationType,
          patternsTried: patterns,
        });
        
        return null;
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions for Pending Operations
// ═══════════════════════════════════════════════════════════════════

interface RawOperationData {
  token: string;
  operationType: string;
  data: unknown;
  metadata: Record<string, unknown>;
  expiresAt: number;
  ttlSeconds: number;
  createdAt?: number;
}

// Redis client type - using ReturnType to avoid importing redis package directly
type RedisClient = ReturnType<typeof redis.getClient>;

/**
 * Try direct Redis key lookups (no wildcards) - most efficient approach
 * 
 * @param redis - Redis client instance
 * @param patterns - Array of key patterns to try (non-wildcard patterns only)
 * @param token - Extracted token (without prefixes)
 * @param originalToken - Original token as passed by user
 * @param operationType - Optional operation type hint
 * @returns Raw operation data if found, null otherwise
 */
async function tryDirectKeyLookups(
  redis: RedisClient,
  patterns: readonly string[],
  token: string,
  originalToken: string,
  operationType?: string
): Promise<RawOperationData | null> {
  if (!redis) return null;
  
  for (const pattern of patterns) {
    if (pattern.includes('*')) continue; // Skip wildcard patterns
    
    const value = await redis.get(pattern);
    if (!value) continue;
    
    try {
      return await parseRedisPayload(pattern, value, originalToken, operationType, redis);
    } catch (error) {
      logger.warn('Error parsing Redis raw data', { pattern, error });
    }
  }
  
  return null;
}

/**
 * Try scanning Redis with wildcard patterns - fallback when direct lookup fails
 * 
 * @param redis - Redis client instance
 * @param patterns - Array of key patterns to scan (wildcard patterns only)
 * @param token - Extracted token (without prefixes)
 * @param originalToken - Original token as passed by user
 * @param operationType - Optional operation type hint
 * @returns Raw operation data if found, null otherwise
 */
async function tryWildcardScan(
  redis: RedisClient,
  patterns: readonly string[],
  token: string,
  originalToken: string,
  operationType?: string
): Promise<RawOperationData | null> {
  if (!redis) return null;
  
  for (const pattern of patterns) {
    if (!pattern.includes('*')) continue; // Skip non-wildcard patterns
    
    logger.debug('Scanning Redis with pattern', { pattern });
    
    for await (const key of scanKeysIterator({ pattern, maxKeys: 100 })) {
      if (!keyMatchesToken(key, token)) continue;
      
      logger.debug('Found matching key via scan', { key, token });
      
      const value = await redis.get(key);
      if (!value) continue;
      
      try {
        return await parseRedisPayload(key, value, originalToken, operationType, redis);
      } catch (error) {
        logger.warn('Error parsing Redis raw data', { key, error });
      }
    }
  }
  
  return null;
}

/**
 * Parse Redis payload and extract operation data
 * 
 * @param key - Redis key where the data was found
 * @param value - Raw JSON string from Redis
 * @param originalToken - Original token as passed by user
 * @param operationType - Optional operation type hint (fallback if not in key)
 * @returns Parsed and structured operation data
 * @throws Error if Redis is unavailable or payload is invalid
 */
async function parseRedisPayload(
  key: string,
  value: string,
  originalToken: string,
  operationType?: string,
  redisClient?: RedisClient
): Promise<RawOperationData> {
  const payload = JSON.parse(value);
  
  if (!redisClient && !redis.isInitialized()) {
    throw new Error('Redis not available');
  }
  
  const client = redisClient || redis.getClient();
  const ttl = await client.ttl(key);
  const expiresAt = Date.now() + (ttl > 0 ? ttl * 1000 : 0);
  const extractedOperationType = extractOperationTypeFromKey(key);
  
  return {
    token: originalToken,
    operationType: extractedOperationType || operationType || 'unknown',
    data: payload.data || payload,
    metadata: payload.metadata || {},
    expiresAt,
    ttlSeconds: ttl,
    createdAt: payload.createdAt,
  };
}

/**
 * Sanitize pending operation metadata to remove sensitive data
 */
function sanitizePendingOperationMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  // Copy safe fields
  const safeFields = ['tenantId', 'userId', 'deviceInfo', 'ipAddress', 'userAgent'];
  for (const field of safeFields) {
    if (data[field] !== undefined) {
      sanitized[field] = data[field];
    }
  }
  
  // Sanitize OTP data (remove hashed codes)
  if (data.otp && typeof data.otp === 'object') {
    const otp = data.otp as Record<string, unknown>;
    sanitized.otp = {
      channel: otp.channel,
      recipient: otp.recipient,
      purpose: otp.purpose,
      createdAt: otp.createdAt,
      expiresIn: otp.expiresIn,
      // Explicitly exclude: hashedCode, code
    };
  }
  
  // Explicitly exclude sensitive fields
  const excludedFields = [
    'passwordHash',
    'password',
    'hashedCode',
    'code',
    'otpCode',
    'resetToken',
    'secret',
  ];
  
  for (const field of excludedFields) {
    if (data[field] !== undefined) {
      // Don't include in sanitized output
    }
  }
  
  return sanitized;
}
