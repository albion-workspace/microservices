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
  normalizeDocument,
  findOneAndUpdateById,
  paginateCollection,
  type CursorPaginationOptions,
  type CursorPaginationResult,
} from 'core-service';
import { rolesToArray } from './utils.js';
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
  }
  
  type OTPResponse {
    success: Boolean!
    message: String!
    otpSentTo: String
    channel: String
    expiresIn: Int
  }
  
  type TwoFactorSetup {
    success: Boolean!
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
    recipient: String!
    code: String!
    purpose: String!
  }
  
  input ForgotPasswordInput {
    tenantId: String!
    identifier: String!
  }
  
  input ResetPasswordInput {
    tenantId: String!
    token: String!
    newPassword: String!
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
    
    # Authentication
    login(input: LoginInput!): AuthResponse!
    logout(refreshToken: String!): BasicResponse!
    logoutAll: LogoutAllResponse!
    refreshToken(input: RefreshTokenInput!): AuthResponse!
    
    # OTP
    sendOTP(input: SendOTPInput!): OTPResponse!
    verifyOTP(input: VerifyOTPInput!): OTPResponse!
    resendOTP(recipient: String!, purpose: String!, tenantId: String!): OTPResponse!
    
    # Password Management
    forgotPassword(input: ForgotPasswordInput!): BasicResponse!
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
 * Normalize roles: convert UserRole[] objects to string[] array
 * Handles both UserRole[] format ({ role: string, active: boolean, ... }) and string[] format
 */
function normalizeRoles(roles: any): string[] {
  if (!roles) {
    return [];
  }
  
  // Use utility function to convert roles to string array
  return rolesToArray(roles);
}

/**
 * Check if user has system role or specific permission
 * Helper function for resolver permission checks
 * Uses access-engine URN format: resource:action:target (e.g., 'user:read:*', 'user:read:own')
 * 
 * NOTE: Only 'system' role has full access. 'admin' and other roles use permissions.
 */
function checkSystemOrPermission(
  user: UserContext | null,
  resource: string,
  action: string,
  target: string = '*'
): boolean {
  if (!user) return false;
  
  // Check system role (only role with full access)
  if (user.roles?.includes('system')) return true;
  
  // Check wildcard permission
  if (user.permissions?.some(p => p === '*:*:*' || p === '*')) return true;
  
  // Check specific permission using access-engine URN format: resource:action:target
  const requiredUrn = `${resource}:${action}:${target}`;
  return user.permissions?.some(p => {
    // URN matching with wildcard support (access-engine format: resource:action:target)
    const parts = p.split(':');
    const reqParts = requiredUrn.split(':');
    if (parts.length !== 3 || reqParts.length !== 3) return false;
    
    // Match: resource, action, target (allowing wildcards)
    return (
      (parts[0] === '*' || parts[0] === reqParts[0]) &&
      (parts[1] === '*' || parts[1] === reqParts[1]) &&
      (parts[2] === '*' || parts[2] === reqParts[2])
    );
  }) ?? false;
}

/**
 * Normalize user object: map _id to id, normalize permissions and roles
 * Uses core-service helper for document normalization
 */
function normalizeUser(user: any): any {
  if (!user) {
    return null;
  }
  
  // Use core-service helper to ensure id field exists from _id
  const normalized = normalizeDocument(user);
  if (!normalized) return null;
  
  // Normalize permissions (object → array)
  if (normalized.permissions && !Array.isArray(normalized.permissions)) {
    normalized.permissions = Object.keys(normalized.permissions).filter(key => normalized.permissions[key] === true);
  } else if (!normalized.permissions) {
    normalized.permissions = [];
  }
  
  // Normalize roles using helper function
  normalized.roles = normalizeRoles(normalized.roles);
  
  return normalized;
}

/**
 * Normalize multiple user objects
 * Helper function to reduce code duplication
 */
function normalizeUsers(users: any[]): any[] {
  return users.map(user => normalizeUser(user)).filter(Boolean);
}

/**
 * Create resolvers with service instances
 */
export function createAuthResolvers(
  registrationService: any,
  authenticationService: any,
  otpService: any,
  passwordService: any,
  twoFactorService: any
): Resolvers & Record<string, any> {
  return {
    User: {
      /**
       * Normalize roles field: extract role names from UserRole[] format
       */
      roles: (parent: any) => normalizeRoles(parent.roles),
      /**
       * Normalize permissions field: convert object to array if needed
       */
      permissions: (parent: any) => {
        if (!parent.permissions) {
          return [];
        }
        // If permissions is an array, return as-is
        if (Array.isArray(parent.permissions)) {
          return parent.permissions;
        }
        // If permissions is an object, convert to array of keys where value is true
        if (typeof parent.permissions === 'object') {
          return Object.keys(parent.permissions).filter(key => parent.permissions[key] === true);
        }
        // Fallback: return empty array
        return [];
      },
    },
    Query: {
      /**
       * Get current authenticated user
       */
      me: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const userId = getUserId(ctx);
        const tenantId = getTenantId(ctx);
        
        // Use generic helper function for document lookup with automatic ObjectId handling
        const user = await findById(db.collection('users'), userId, { tenantId });
        
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
          throw new Error('Unauthorized: Insufficient permissions to read user');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const userId = (args as any).id;
        const tenantId = (args as any).tenantId;
        
        if (!userId) {
          throw new Error('User ID is required');
        }
        
        if (!tenantId) {
          throw new Error('Tenant ID is required');
        }
        
        // Use generic helper function for document lookup with automatic ObjectId handling
        const user = await findById(db.collection('users'), userId, { tenantId });
        
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
          throw new Error('Unauthorized: Insufficient permissions to list users');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { tenantId, first, after, last, before } = args as any;
        
        const filter: Record<string, unknown> = {};
        if (tenantId) {
          filter.tenantId = tenantId;
        }
        
        try {
          // Use cursor-based pagination (performance-optimized, sharding-friendly)
          const result = await paginateCollection(
            db.collection('users'),
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
          
          return {
            nodes: normalizedNodes,
            totalCount: result.totalCount,
            pageInfo: result.pageInfo,
          };
        } catch (error) {
          logger.error('Error fetching users', { error, tenantId });
          throw new Error('Failed to fetch users');
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
          throw new Error('Unauthorized: Insufficient permissions to list users by role');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { role, tenantId, first, after, last, before } = args as any;
        
        if (!role || typeof role !== 'string') {
          throw new Error('Role parameter is required and must be a string');
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
            db.collection('users'),
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
          
          return {
            nodes: normalizedNodes,
            totalCount: result.totalCount,
            pageInfo: result.pageInfo,
          };
        } catch (error) {
          logger.error('Error fetching users by role', { error, role, tenantId: finalTenantId });
          throw new Error('Failed to fetch users by role');
        }
      },
      
      /**
       * Get user's active sessions
       */
      mySessions: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        requireAuth(ctx);
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const sessions = await db.collection('sessions')
          .find({
            userId: getUserId(ctx),
            tenantId: getTenantId(ctx),
            isValid: true,
          })
          .sort({ lastAccessedAt: -1 })
          .toArray();
        
        return sessions;
      },
      
      /**
       * Health check
       */
      authHealth: (args: Record<string, unknown>, ctx: ResolverContext) => 'Auth service is healthy',
    },
    
    Mutation: {
      /**
       * Register new user
       */
      register: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        return await registrationService.register((args as any).input);
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
        
        return await authenticationService.logoutAll(getUserId(ctx));
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
        return await otpService.sendOTP((args as any).input);
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
        const { recipient, purpose, tenantId } = args as any;
        return await otpService.resendOTP(recipient, purpose, tenantId);
      },
      
      /**
       * Forgot password
       */
      forgotPassword: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        return await passwordService.forgotPassword((args as any).input);
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
          throw new Error('Unauthorized: Insufficient permissions to update user roles');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { userId, tenantId, roles } = (args as any).input;
        
        if (!userId) {
          throw new Error('User ID is required');
        }
        
        if (!tenantId) {
          throw new Error('Tenant ID is required');
        }
        
        if (!Array.isArray(roles)) {
          throw new Error('Roles must be an array');
        }
        
        try {
          // Use optimized helper function for findOneAndUpdate (performance-optimized)
          const result = await findOneAndUpdateById(
            db.collection('users'),
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
            throw new Error('User not found');
          }
          
          logger.info('User roles updated', { 
            userId, 
            tenantId,
            updatedBy: ctx.user!.userId,
            roles 
          });
          
          return normalizeUser(result.value);
        } catch (error) {
          logger.error('Error updating user roles', { error, userId, tenantId });
          throw error instanceof Error ? error : new Error('Failed to update user roles');
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
          throw new Error('Unauthorized: Insufficient permissions to update user permissions');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { userId, tenantId, permissions } = (args as any).input;
        
        if (!userId) {
          throw new Error('User ID is required');
        }
        
        if (!tenantId) {
          throw new Error('Tenant ID is required');
        }
        
        if (!Array.isArray(permissions)) {
          throw new Error('Permissions must be an array');
        }
        
        try {
          // Use optimized helper function for findOneAndUpdate (performance-optimized)
          const result = await findOneAndUpdateById(
            db.collection('users'),
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
            throw new Error('User not found');
          }
          
          logger.info('User permissions updated', { 
            userId, 
            tenantId,
            updatedBy: ctx.user!.userId,
            permissionsCount: permissions.length 
          });
          
          return normalizeUser(result);
        } catch (error) {
          logger.error('Error updating user permissions', { error, userId, tenantId });
          throw error instanceof Error ? error : new Error('Failed to update user permissions');
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
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
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
            db.collection('users'),
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
            throw new Error('User not found');
          }
          
          logger.info('User status updated', { 
            userId, 
            tenantId,
            updatedBy: ctx.user!.userId,
            status 
          });
          
          return normalizeUser(result);
        } catch (error) {
          logger.error('Error updating user status', { error, userId, tenantId, status });
          throw error instanceof Error ? error : new Error('Failed to update user status');
        }
      },
    },
  };
}
