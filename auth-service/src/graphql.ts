/**
 * GraphQL Schema and Resolvers for Auth Service
 */

import type { ResolverContext } from 'core-service';
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
    id: ID!
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
    
    # Get user by ID (admin only)
    getUser(id: ID!, tenantId: String!): User
    
    # List all users (admin only)
    users(tenantId: String, first: Int, skip: Int): UserConnection!
    
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
    
    # User Management (admin only)
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
  twoFactorService: any
): Resolvers {
  return {
    Query: {
      /**
       * Get current authenticated user
       */
      me: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        return await db.collection('users').findOne({
          id: ctx.user.userId,
          tenantId: ctx.user.tenantId,
        });
      },
      
      /**
       * Get user by ID (admin only)
       */
      getUser: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        // Check if user is admin
        if (!ctx.user.roles.includes('admin')) {
          throw new Error('Unauthorized');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        return await db.collection('users').findOne({
          id: (args as any).id,
          tenantId: (args as any).tenantId,
        });
      },
      
      /**
       * List all users (admin only)
       */
      users: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        // Check if user is admin
        if (!ctx.user.roles.includes('admin')) {
          throw new Error('Unauthorized');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { tenantId, first = 50, skip = 0 } = args as any;
        
        const query: Record<string, unknown> = {};
        if (tenantId) {
          query.tenantId = tenantId;
        }
        
        const [items, total] = await Promise.all([
          db.collection('users')
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(first)
            .toArray(),
          db.collection('users').countDocuments(query),
        ]);
        
        return {
          nodes: items,
          totalCount: total,
          pageInfo: {
            hasNextPage: skip + first < total,
            hasPreviousPage: skip > 0,
          },
        };
      },
      
      /**
       * Get user's active sessions
       */
      mySessions: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const sessions = await db.collection('sessions')
          .find({
            userId: ctx.user.userId,
            tenantId: ctx.user.tenantId,
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
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        return await authenticationService.logout(ctx.user.userId, (args as any).refreshToken);
      },
      
      /**
       * Logout from all devices
       */
      logoutAll: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        return await authenticationService.logoutAll(ctx.user.userId);
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
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        return await passwordService.changePassword({
          ...(args as any).input,
          userId: ctx.user.userId,
          tenantId: ctx.user.tenantId,
        });
      },
      
      /**
       * Enable 2FA
       */
      enable2FA: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        return await twoFactorService.enable2FA({
          ...(args as any).input,
          userId: ctx.user.userId,
          tenantId: ctx.user.tenantId,
        });
      },
      
      /**
       * Verify 2FA
       */
      verify2FA: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        return await twoFactorService.verify2FA({
          ...(args as any).input,
          userId: ctx.user.userId,
          tenantId: ctx.user.tenantId,
        });
      },
      
      /**
       * Disable 2FA
       */
      disable2FA: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        return await twoFactorService.disable2FA(ctx.user.userId, ctx.user.tenantId, (args as any).password);
      },
      
      /**
       * Regenerate backup codes
       */
      regenerateBackupCodes: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        return await twoFactorService.regenerateBackupCodes({
          userId: ctx.user.userId,
          tenantId: ctx.user.tenantId,
          password: (args as any).password,
        });
      },
      
      /**
       * Update user roles (admin only)
       */
      updateUserRoles: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        if (!ctx.user.roles.includes('admin')) {
          throw new Error('Unauthorized');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { userId, tenantId, roles } = (args as any).input;
        
        const result = await db.collection('users').findOneAndUpdate(
          { id: userId, tenantId },
          { 
            $set: { 
              roles,
              updatedAt: new Date(),
            } 
          },
          { returnDocument: 'after' }
        );
        
        if (!result || !result.value) {
          throw new Error('User not found');
        }
        
        return result.value;
      },
      
      /**
       * Update user permissions (admin only)
       */
      updateUserPermissions: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        if (!ctx.user.roles.includes('admin')) {
          throw new Error('Unauthorized');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { userId, tenantId, permissions } = (args as any).input;
        
        const result = await db.collection('users').findOneAndUpdate(
          { id: userId, tenantId },
          { 
            $set: { 
              permissions,
              updatedAt: new Date(),
            } 
          },
          { returnDocument: 'after' }
        );
        
        if (!result || !result.value) {
          throw new Error('User not found');
        }
        
        return result.value;
      },
      
      /**
       * Update user status (admin only)
       */
      updateUserStatus: async (args: Record<string, unknown>, ctx: ResolverContext) => {
        if (!ctx.user) {
          throw new Error('Not authenticated');
        }
        
        if (!ctx.user.roles.includes('admin')) {
          throw new Error('Unauthorized');
        }
        
        const { getDatabase } = await import('core-service');
        const db = getDatabase();
        const { userId, tenantId, status } = (args as any).input;
        
        const validStatuses = ['active', 'pending', 'suspended', 'locked'];
        if (!validStatuses.includes(status)) {
          throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
        
        const result = await db.collection('users').findOneAndUpdate(
          { id: userId, tenantId },
          { 
            $set: { 
              status,
              updatedAt: new Date(),
            } 
          },
          { returnDocument: 'after' }
        );
        
        if (!result || !result.value) {
          throw new Error('User not found');
        }
        
        return result.value;
      },
    },
  };
}
