/**
 * Centralized User Configuration and Authentication Utilities
 * 
 * Provides consistent user data and authentication functions across all test scripts.
 * Manages credentials, roles, and permissions for:
 * - 1 system user
 * - 2 provider users (payment-gateway, payment-provider)
 * - 5 end users
 * 
 * Also provides centralized JWT token generation utilities.
 */

import { getAuthDatabase } from './mongodb.js';
import { createHmac } from 'crypto';
import { connectDatabase } from '../../../core-service/src/common/database.js';
import { findUserIdByRole, findUserIdsByRole } from '../../../core-service/src/common/user-utils.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3003/graphql';
export const DEFAULT_TENANT_ID = 'default-tenant';
const JWT_SECRET = process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production';

// ═══════════════════════════════════════════════════════════════════
// Currency Configuration - Shared across all tests
// ═══════════════════════════════════════════════════════════════════

/**
 * Default currency for all tests
 * Can be overridden via TEST_CURRENCY environment variable
 * Payment service uses EUR, Bonus service uses USD
 * Default to EUR to match payment service
 */
export const DEFAULT_CURRENCY = (process.env.TEST_CURRENCY || 'EUR') as 'EUR' | 'USD' | 'GBP';

// ═══════════════════════════════════════════════════════════════════
// User Definitions
// ═══════════════════════════════════════════════════════════════════

export interface UserDefinition {
  email: string;
  password: string;
  roles: string[];
  permissions: Record<string, boolean>;
  description?: string;
}

/**
 * System user - Full access, can go negative
 */
export const SYSTEM_USER: UserDefinition = {
  email: 'system@demo.com',
  password: 'System123!@#',
  roles: ['system'],
  permissions: {
    '*:*:*': true, // Full access
    allowNegative: true,
  },
  description: 'System user with full access and negative balance permission',
};

/**
 * Provider users - Payment gateway and provider roles
 */
export const PROVIDER_USERS: Record<string, UserDefinition> = {
  paymentGateway: {
    email: 'payment-gateway@system.com',
    password: 'Gateway123!@#',
    roles: ['payment-gateway'],
    permissions: {
      allowNegative: true,
      acceptFee: true,
      transaction: true,
      wallet: true,
    },
    description: 'Payment gateway user - can go negative, accepts fees',
  },
  paymentProvider: {
    email: 'payment-provider@system.com',
    password: 'Provider123!@#',
    roles: ['payment-provider'],
    permissions: {
      acceptFee: true,
      transaction: true,
      wallet: true,
    },
    description: 'Payment provider user - accepts fees',
  },
  bonusPool: {
    email: 'bonus-pool@system.com',
    password: 'BonusPool123!@#',
    roles: ['payment-provider'],
    permissions: {
      acceptFee: true,
      transaction: true,
      wallet: true,
    },
    description: 'Bonus pool user - kept for testing multi-user scenarios (services use system user\'s bonusBalance)',
  },
};

/**
 * End users - Regular users for testing
 */
export const END_USERS: Record<string, UserDefinition> = {
  user1: {
    email: 'user1@demo.com',
    password: 'User123!@#',
    roles: ['user'],
    permissions: {},
    description: 'End user 1',
  },
  user2: {
    email: 'user2@demo.com',
    password: 'User123!@#',
    roles: ['user'],
    permissions: {},
    description: 'End user 2',
  },
  user3: {
    email: 'user3@demo.com',
    password: 'User123!@#',
    roles: ['user'],
    permissions: {},
    description: 'End user 3',
  },
  user4: {
    email: 'user4@demo.com',
    password: 'User123!@#',
    roles: ['user'],
    permissions: {},
    description: 'End user 4',
  },
  user5: {
    email: 'user5@demo.com',
    password: 'User123!@#',
    roles: ['user'],
    permissions: {},
    description: 'End user 5',
  },
  user6: {
    email: 'user6@demo.com',
    password: 'User123!@#',
    roles: ['user'],
    permissions: {},
    description: 'End user 6 (fresh user for FTD bonus tests)',
  },
};

/**
 * All users map for easy lookup
 */
export const ALL_USERS: Record<string, UserDefinition> = {
  system: SYSTEM_USER,
  bonusPool: PROVIDER_USERS.bonusPool,
  ...PROVIDER_USERS,
  ...END_USERS,
};

// ═══════════════════════════════════════════════════════════════════
// GraphQL Helpers
// ═══════════════════════════════════════════════════════════════════

async function graphql<T = any>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string
): Promise<T> {
  const response = await fetch(AUTH_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

// ═══════════════════════════════════════════════════════════════════
// Authentication Functions
// ═══════════════════════════════════════════════════════════════════

export interface LoginResult {
  token: string;
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

/**
 * Login as a specific user by user key or email
 * 
 * @example
 * const { token } = await loginAs('system');
 * const { token } = await loginAs('paymentGateway');
 * const { token } = await loginAs('user1');
 * const { token } = await loginAs('system@demo.com');
 */
export async function loginAs(
  userKeyOrEmail: string,
  options: { retry?: boolean; verifyToken?: boolean } = {}
): Promise<LoginResult> {
  const { retry = true, verifyToken = true } = options;

  // Find user definition
  let user: UserDefinition | undefined;
  
  if (ALL_USERS[userKeyOrEmail]) {
    user = ALL_USERS[userKeyOrEmail];
  } else {
    // Try to find by email
    user = Object.values(ALL_USERS).find(u => u.email === userKeyOrEmail);
    if (!user) {
      throw new Error(`User not found: ${userKeyOrEmail}`);
    }
  }

  const loginQuery = `
    mutation Login($input: LoginInput!) {
      login(input: $input) {
        success
        message
        tokens {
          accessToken
          refreshToken
        }
        user {
          id
          email
          roles
          permissions
        }
      }
    }
  `;

  const loginVars = {
    input: {
      tenantId: DEFAULT_TENANT_ID,
      identifier: user.email.toLowerCase().trim(), // Normalize email to match Passport
      password: user.password,
    },
  };

  try {
    const data = await graphql<{ login: { success: boolean; message?: string; tokens?: { accessToken: string }; user?: { id: string; email: string; roles: string[]; permissions: string[] } } }>(
      loginQuery,
      loginVars
    );

    if (!data.login.success || !data.login.tokens?.accessToken) {
      throw new Error(`Login failed: ${data.login.message || 'Unknown error'}`);
    }

    const token = data.login.tokens.accessToken;
    const userData = data.login.user!;

    // Verify token if requested (for system users, verify they can access system queries)
    if (verifyToken && user.roles.includes('system')) {
      try {
        await graphql<{ users: { nodes: any[] } }>(
          `query { users(first: 1) { nodes { id } } }`,
          {},
          token
        );
      } catch (error: any) {
        if (retry) {
          // Wait and retry once
          await new Promise(resolve => setTimeout(resolve, 2000));
          return loginAs(userKeyOrEmail, { retry: false, verifyToken });
        }
        throw new Error(`Token verification failed: ${error.message}`);
      }
    }

    return {
      token,
      userId: userData.id,
      email: userData.email,
      roles: userData.roles || [],
      permissions: userData.permissions || [],
    };
  } catch (error: any) {
    throw new Error(`Failed to login as ${user.email}: ${error.message}`);
  }
}

/**
 * Register/create a user by user key or email
 * Returns existing user if already exists
 * 
 * @example
 * const { userId } = await registerAs('system');
 * const { userId } = await registerAs('paymentGateway');
 */
export interface RegisterResult {
  userId: string;
  email: string;
  created: boolean;
}

export async function registerAs(
  userKeyOrEmail: string,
  options: { updateRoles?: boolean; updatePermissions?: boolean; metadata?: Record<string, any> } = {}
): Promise<RegisterResult> {
  const { updateRoles = true, updatePermissions = true, metadata } = options;

  // Find user definition
  let user: UserDefinition | undefined;
  
  if (ALL_USERS[userKeyOrEmail]) {
    user = ALL_USERS[userKeyOrEmail];
  } else {
    user = Object.values(ALL_USERS).find(u => u.email === userKeyOrEmail);
    if (!user) {
      throw new Error(`User not found: ${userKeyOrEmail}`);
    }
  }

  // Check if user already exists in MongoDB (more reliable)
  // CRITICAL: Check by both email AND tenantId (Passport queries by tenantId)
  // Also normalize email to match Passport's normalization
  const db = await getAuthDatabase();
  const usersCollection = db.collection('users');
  const normalizedEmail = user.email.toLowerCase().trim(); // Match Passport's normalizeEmail
  const existingUser = await usersCollection.findOne({ 
    email: normalizedEmail,
    tenantId: DEFAULT_TENANT_ID 
  });

  if (existingUser) {
    const userId = existingUser._id?.toString() || existingUser.id;
    
    // CRITICAL: Delete and recreate user to ensure password hash is correct
    // This is safer than updating password hash (which requires bcrypt in scripts)
    // Registration service handles password hashing correctly
    await usersCollection.deleteOne({ 
      email: normalizedEmail,
      tenantId: DEFAULT_TENANT_ID 
    });
    
    // Fall through to registration below
  }

  // Try to register via GraphQL
  // NOTE: For testing/system setup, we use autoVerify: true to bypass OTP verification
  // In production, regular users would use the new verification flow:
  //   1. register() returns registrationToken (JWT)
  //   2. OTP is sent to email/phone
  //   3. verifyRegistration(registrationToken, otpCode) creates user and returns tokens
  // System users (system, payment-gateway, payment-provider) can use autoVerify: true
  const isSystemUser = user.roles.includes('system') || 
                       user.roles.includes('payment-gateway') || 
                       user.roles.includes('payment-provider');
  
  const registerQuery = `
    mutation Register($input: RegisterInput!) {
      register(input: $input) {
        success
        message
        user {
          id
          email
          status
        }
        registrationToken
        tokens {
          accessToken
          refreshToken
        }
      }
    }
  `;

  // Use autoVerify for all users in test setup (bypasses OTP verification)
  // In production, only system users would use autoVerify
  const registerVars = {
    input: {
      tenantId: DEFAULT_TENANT_ID,
      email: normalizedEmail, // Use normalized email for consistency
      password: user.password,
      autoVerify: true, // Bypass verification for testing/system setup
      sendOTP: false, // Don't send OTP when autoVerify is true
      ...(metadata && { metadata }),
    },
  };

  try {
    const data = await graphql<{ 
      register: { 
        success: boolean; 
        message?: string; 
        user?: { id: string; email: string; status: string }; 
        registrationToken?: string;
        tokens?: { accessToken: string; refreshToken: string };
      } 
    }>(
      registerQuery,
      registerVars
    );

    // Handle registration response
    if (data.register.success && data.register.user) {
      const userId = data.register.user.id;

      // Update roles and permissions via MongoDB (more reliable)
      // CRITICAL: Update by both email AND tenantId, use normalized email
      // Password hash is already correct (created by registration service)
      await usersCollection.updateOne(
        { email: normalizedEmail, tenantId: DEFAULT_TENANT_ID },
        {
          $set: {
            roles: user.roles,
            permissions: user.permissions,
          },
        }
      );

      return {
        userId,
        email: normalizedEmail, // Return normalized email
        created: true,
      };
    }

    throw new Error(`Registration failed: ${data.register.message || 'Unknown error'}`);
  } catch (error: any) {
    // If registration fails (e.g., user already exists), try to find user
    // CRITICAL: Check by both email AND tenantId, use normalized email
    const foundUser = await usersCollection.findOne({ 
      email: normalizedEmail,
      tenantId: DEFAULT_TENANT_ID 
    });
    if (foundUser) {
      // User exists but registration failed - delete and recreate
      // This ensures password hash is correct (registration service handles hashing)
      await usersCollection.deleteOne({ 
        email: normalizedEmail,
        tenantId: DEFAULT_TENANT_ID 
      });
      
      // Retry registration (will create fresh user with correct password hash)
      return await registerAs(userKeyOrEmail, options);
    }

    throw new Error(`Failed to register ${normalizedEmail}: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// User Lookup Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Get user ID by user key or email
 * Uses MongoDB for reliable lookup
 */
export async function getUserId(userKeyOrEmail: string): Promise<string> {
  // Find user definition
  let user: UserDefinition | undefined;
  
  if (ALL_USERS[userKeyOrEmail]) {
    user = ALL_USERS[userKeyOrEmail];
  } else {
    user = Object.values(ALL_USERS).find(u => u.email === userKeyOrEmail);
    if (!user) {
      throw new Error(`User not found: ${userKeyOrEmail}`);
    }
  }

  const db = await getAuthDatabase();
  const usersCollection = db.collection('users');
  const normalizedEmail = user.email.toLowerCase().trim(); // Match Passport's normalization
  const userDoc = await usersCollection.findOne({ 
    email: normalizedEmail,
    tenantId: DEFAULT_TENANT_ID 
  });

  if (!userDoc) {
    throw new Error(`User not found in database: ${normalizedEmail}`);
  }

  return userDoc._id?.toString() || userDoc.id;
}

/**
 * Get user IDs for multiple users at once
 */
export async function getUserIds(userKeys: string[]): Promise<Record<string, string>> {
  const emails = userKeys.map(key => {
    const user = ALL_USERS[key];
    if (!user) {
      throw new Error(`User not found: ${key}`);
    }
    return user.email;
  });

  const db = await getAuthDatabase();
  const usersCollection = db.collection('users');
  const users = await usersCollection.find({ email: { $in: emails } }).toArray();

  const result: Record<string, string> = {};
  for (const userDoc of users) {
    const email = userDoc.email;
    const userId = userDoc._id?.toString() || userDoc.id;
    
    // Find the key for this email
    const key = Object.keys(ALL_USERS).find(k => ALL_USERS[k].email === email);
    if (key) {
      result[key] = userId;
    }
  }

  return result;
}

/**
 * Get user definition by key or email
 */
export function getUserDefinition(userKeyOrEmail: string): UserDefinition {
  if (ALL_USERS[userKeyOrEmail]) {
    return ALL_USERS[userKeyOrEmail];
  }
  
  const user = Object.values(ALL_USERS).find(u => u.email === userKeyOrEmail);
  if (!user) {
    throw new Error(`User not found: ${userKeyOrEmail}`);
  }
  
  return user;
}

// ═══════════════════════════════════════════════════════════════════
// Convenience Exports
// ═══════════════════════════════════════════════════════════════════

/**
 * Quick access to common users
 */
export const users = {
  system: SYSTEM_USER,
  gateway: PROVIDER_USERS.paymentGateway,
  provider: PROVIDER_USERS.paymentProvider,
  bonusPool: PROVIDER_USERS.bonusPool,
  endUsers: END_USERS,
  all: ALL_USERS,
};

/**
 * Common user keys for type safety
 */
export type UserKey = 'system' | 'paymentGateway' | 'paymentProvider' | 'user1' | 'user2' | 'user3' | 'user4' | 'user5';

// ═══════════════════════════════════════════════════════════════════
// JWT Token Generation Utilities
// ═══════════════════════════════════════════════════════════════════

export interface JWTPayload {
  userId?: string;
  sub?: string;
  tenantId?: string;
  tid?: string;
  roles?: string[];
  permissions?: string[];
  type?: string;
  [key: string]: unknown;
}

/**
 * Create a JWT token with custom payload
 * 
 * @example
 * const token = createJWT({ userId: '123', roles: ['user'] }, '1h');
 * const token = createJWT({ userId: '123', roles: ['user'] }, '30m');
 */
export function createJWT(
  payload: JWTPayload,
  expiresIn: string = '8h',
  secret: string = JWT_SECRET
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  
  // Parse expiration time
  let exp = now + 8 * 60 * 60; // Default 8 hours
  if (expiresIn.endsWith('h')) {
    exp = now + parseInt(expiresIn) * 60 * 60;
  } else if (expiresIn.endsWith('m')) {
    exp = now + parseInt(expiresIn) * 60;
  } else if (expiresIn.endsWith('s')) {
    exp = now + parseInt(expiresIn);
  } else if (expiresIn.endsWith('d')) {
    exp = now + parseInt(expiresIn) * 24 * 60 * 60;
  }
  
  const fullPayload = { ...payload, iat: now, exp };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  
  return `${base64Header}.${base64Payload}.${signature}`;
}

/**
 * Create a JWT token for a specific user by user key
 * Uses the user's roles and permissions from the centralized config
 * 
 * @example
 * const token = createTokenForUser('system');
 * const token = createTokenForUser('paymentGateway', '1h');
 * const token = createTokenForUser('user1', '24h');
 */
export function createTokenForUser(
  userKeyOrEmail: string,
  expiresIn: string = '8h',
  options: { userId?: string; tenantId?: string; includeBearer?: boolean } = {}
): string {
  const user = getUserDefinition(userKeyOrEmail);
  const { userId, tenantId = DEFAULT_TENANT_ID, includeBearer = false } = options;
  
  // Convert permissions object to array
  const permissionsArray = Object.keys(user.permissions).filter(key => user.permissions[key] === true);
  
  const payload: JWTPayload = {
    userId: userId || user.email,
    sub: userId || user.email,
    tenantId,
    tid: tenantId,
    roles: user.roles,
    permissions: permissionsArray.length > 0 ? permissionsArray : [],
    type: 'access',
  };
  
  const token = createJWT(payload, expiresIn);
  return includeBearer ? `Bearer ${token}` : token;
}

/**
 * Create a system token (convenience function)
 * 
 * @example
 * const token = createSystemToken();
 * const token = createSystemToken('1h', true); // with Bearer prefix
 */
export function createSystemToken(
  expiresIn: string = '8h',
  includeBearer: boolean = false
): string {
  return createTokenForUser('system', expiresIn, { includeBearer });
}

/**
 * Create a user token (convenience function)
 * 
 * @example
 * const token = createUserToken('user1');
 * const token = createUserToken('user1', '24h');
 */
export function createUserToken(
  userKey: UserKey,
  expiresIn: string = '8h',
  options: { userId?: string; tenantId?: string } = {}
): string {
  return createTokenForUser(userKey, expiresIn, options);
}

/**
 * Create a provider token (convenience function)
 * 
 * @example
 * const token = createProviderToken('paymentGateway');
 * const token = createProviderToken('paymentProvider', '1h');
 */
export function createProviderToken(
  providerKey: 'paymentGateway' | 'paymentProvider',
  expiresIn: string = '8h',
  options: { userId?: string; tenantId?: string } = {}
): string {
  return createTokenForUser(providerKey, expiresIn, options);
}

/**
 * Decode a JWT token (without verification)
 * Useful for debugging and inspecting token contents
 * 
 * @example
 * const payload = decodeJWT(token);
 * console.log(payload.roles);
 */
export function decodeJWT(token: string): JWTPayload {
  const parts = token.replace(/^Bearer\s+/, '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT token format');
  }
  
  try {
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as JWTPayload;
  } catch (error: any) {
    throw new Error(`Failed to decode JWT: ${error.message}`);
  }
}

/**
 * Pre-generated tokens for common users (for testing without auth service)
 * These are mock tokens - use loginAs() for real tokens from auth service
 */
export function getMockTokens(tenantId: string = DEFAULT_TENANT_ID) {
  return {
    system: createTokenForUser('system', '8h', { tenantId }),
    paymentGateway: createTokenForUser('paymentGateway', '8h', { tenantId }),
    paymentProvider: createTokenForUser('paymentProvider', '8h', { tenantId }),
    user1: createTokenForUser('user1', '8h', { tenantId }),
    user2: createTokenForUser('user2', '8h', { tenantId }),
    user3: createTokenForUser('user3', '8h', { tenantId }),
    user4: createTokenForUser('user4', '8h', { tenantId }),
    user5: createTokenForUser('user5', '8h', { tenantId }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Role-Based User Lookup (uses core-service utilities)
// ═══════════════════════════════════════════════════════════════════

/**
 * Find a user ID by role (role-based lookup)
 * Uses the same approach as bonus-service and payment-service
 * 
 * @example
 * // Find system user
 * const systemUserId = await getUserIdByRole('system');
 * 
 * // Find system user for specific tenant
 * const systemUserId = await getUserIdByRole('system', 'tenant-123');
 * 
 * // Find bonus-pool user (if exists)
 * const bonusPoolUserId = await getUserIdByRole('bonus-pool', undefined, false);
 * 
 * @param role - Role to search for (e.g., 'system', 'payment-provider', 'bonus-pool')
 * @param tenantId - Optional tenant ID to filter by (defaults to DEFAULT_TENANT_ID)
 * @param throwIfNotFound - Whether to throw error if no user found (default: true)
 * @returns User ID (string) or empty string if not found and throwIfNotFound is false
 */
export async function getUserIdByRole(
  role: string,
  tenantId?: string,
  throwIfNotFound: boolean = true
): Promise<string> {
  // Ensure database is connected (required for role-based lookup)
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
  await connectDatabase(mongoUri);
  
  return await findUserIdByRole({
    role,
    tenantId: tenantId || DEFAULT_TENANT_ID,
    throwIfNotFound,
  });
}

/**
 * Find multiple user IDs by role
 * Returns all users with the specified role (useful when multiple system users exist)
 * 
 * @example
 * // Find all system users
 * const systemUserIds = await getUserIdsByRole('system');
 * 
 * // Find all payment providers for a tenant
 * const providerIds = await getUserIdsByRole('payment-provider', 'tenant-123');
 * 
 * @param role - Role to search for
 * @param tenantId - Optional tenant ID to filter by (defaults to DEFAULT_TENANT_ID)
 * @returns Array of user IDs
 */
export async function getUserIdsByRole(
  role: string,
  tenantId?: string
): Promise<string[]> {
  // Ensure database is connected (required for role-based lookup)
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
  await connectDatabase(mongoUri);
  
  return await findUserIdsByRole({
    role,
    tenantId: tenantId || DEFAULT_TENANT_ID,
  });
}

/**
 * Get system user ID using role-based lookup
 * Convenience function that uses the same approach as services
 * 
 * @example
 * const systemUserId = await getSystemUserIdByRole();
 * const systemUserId = await getSystemUserIdByRole('tenant-123');
 * 
 * @param tenantId - Optional tenant ID (defaults to DEFAULT_TENANT_ID)
 * @returns System user ID
 */
export async function getSystemUserIdByRole(tenantId?: string): Promise<string> {
  return await getUserIdByRole('system', tenantId, true);
}

/**
 * Get bonus-pool user ID using role-based lookup (if exists)
 * Note: Services now use system user's bonusBalance, but this function
 * can find a bonus-pool user if one exists for testing/demonstration
 * 
 * @example
 * const bonusPoolUserId = await getBonusPoolUserIdByRole(); // Returns '' if not found
 * 
 * @param tenantId - Optional tenant ID (defaults to DEFAULT_TENANT_ID)
 * @returns Bonus-pool user ID or empty string if not found
 */
export async function getBonusPoolUserIdByRole(tenantId?: string): Promise<string> {
  return await getUserIdByRole('bonus-pool', tenantId, false);
}
