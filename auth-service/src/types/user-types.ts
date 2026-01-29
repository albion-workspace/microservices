/**
 * Enhanced User Types
 * 
 * Generic and flexible user structure supporting:
 * - Multi-identifier authentication (username/email/phone)
 * - Context-based roles (graph-based role system)
 * - Flexible metadata for different use cases (bank, crypto, forex, betting)
 * - Multi-tenant support
 */

import type { UserRole, RoleContext } from './role-types.js';

// ═══════════════════════════════════════════════════════════════════
// Core User Types
// ═══════════════════════════════════════════════════════════════════

export type IdentifierType = 'email' | 'phone' | 'username';

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'locked' | 'deleted';

export type AuthProvider = 'local' | 'google' | 'facebook' | 'linkedin' | 'instagram';

/**
 * Enhanced User interface with graph-based roles
 */
export interface User {
  /** MongoDB ObjectId (primary key, auto-generated) */
  _id?: any;
  
  /** User ID (derived from _id.toString() for convenience) */
  id?: string;
  
  /** Tenant identifier for multi-tenant isolation */
  tenantId: string;
  
  // ═══════════════════════════════════════════════════════════════
  // Primary Identifiers (at least one required)
  // ═══════════════════════════════════════════════════════════════
  
  username?: string;
  email?: string;
  phone?: string;
  
  // ═══════════════════════════════════════════════════════════════
  // Authentication
  // ═══════════════════════════════════════════════════════════════
  
  /** Password hash (only for local auth) */
  passwordHash?: string;
  
  /** Social authentication profiles */
  socialProfiles?: SocialProfile[];
  
  // ═══════════════════════════════════════════════════════════════
  // Account Status
  // ═══════════════════════════════════════════════════════════════
  
  status: AccountStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  
  // ═══════════════════════════════════════════════════════════════
  // Security
  // ═══════════════════════════════════════════════════════════════
  
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  failedLoginAttempts: number;
  lastFailedLoginAt?: Date;
  lockedUntil?: Date;
  passwordChangedAt?: Date;
  
  // ═══════════════════════════════════════════════════════════════
  // Roles & Permissions (Graph-Based)
  // ═══════════════════════════════════════════════════════════════
  
  /** Context-based role assignments */
  roles: UserRole[];
  
  /** Direct permissions (not inherited from roles) */
  permissions: string[];
  
  // ═══════════════════════════════════════════════════════════════
  // Flexible Metadata (Use Case Specific)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Flexible metadata for different use cases:
   * 
   * Banking:
   *   - accountNumber, branchId, accountType, kycStatus, etc.
   * 
   * Crypto Wallet:
   *   - walletAddresses, walletType, blockchain, kycLevel, etc.
   * 
   * Foreign Exchange:
   *   - tradingAccountId, brokerId, accountType, leverage, etc.
   * 
   * Betting Platform:
   *   - playerId, agentId, commissionRate, bettingLimits, etc.
   */
  metadata: Record<string, any>;
  
  // ═══════════════════════════════════════════════════════════════
  // Audit & Tracking
  // ═══════════════════════════════════════════════════════════════
  
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  lastActiveAt?: Date;
  deletedAt?: Date;
}

/**
 * Social authentication profile
 */
export interface SocialProfile {
  provider: AuthProvider;
  providerId: string;
  email?: string;
  displayName?: string;
  photoUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  connectedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// User Metadata Schemas (Type-Safe Helpers)
// ═══════════════════════════════════════════════════════════════════

/**
 * Banking-specific metadata
 */
export interface BankingMetadata {
  accountNumber?: string;
  branchId?: string;
  accountType?: 'checking' | 'savings' | 'business' | 'corporate';
  kycStatus?: 'pending' | 'verified' | 'rejected' | 'expired';
  kycLevel?: number;
  accountManagerId?: string;
  [key: string]: any;
}

/**
 * Crypto wallet-specific metadata
 */
export interface CryptoMetadata {
  walletAddresses?: string[];
  walletType?: 'hot' | 'cold' | 'hardware' | 'paper';
  blockchain?: string[];
  kycLevel?: 'tier1' | 'tier2' | 'tier3';
  tradingEnabled?: boolean;
  withdrawalEnabled?: boolean;
  [key: string]: any;
}

/**
 * Foreign exchange-specific metadata
 */
export interface ForexMetadata {
  tradingAccountId?: string;
  brokerId?: string;
  accountType?: 'standard' | 'premium' | 'vip' | 'institutional';
  leverage?: number;
  baseCurrency?: string;
  marginLevel?: number;
  [key: string]: any;
}

/**
 * Betting platform-specific metadata
 */
export interface BettingMetadata {
  playerId?: string;
  agentId?: string;
  commissionRate?: number;
  bettingLimits?: {
    daily?: number;
    weekly?: number;
    monthly?: number;
  };
  playerType?: 'regular' | 'vip' | 'whale';
  [key: string]: any;
}

// ═══════════════════════════════════════════════════════════════════
// User Query & Filter Types
// ═══════════════════════════════════════════════════════════════════

export interface UserFilter {
  tenantId?: string;
  status?: AccountStatus | AccountStatus[];
  roles?: string[];
  context?: RoleContext;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  twoFactorEnabled?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  metadata?: Record<string, any>;
}

export interface UserQueryOptions {
  filter?: UserFilter;
  sort?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  // Cursor-based pagination (O(1) performance, sharding-friendly)
  pagination?: {
    first?: number;
    after?: string;
    last?: number;
    before?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// User Update Types
// ═══════════════════════════════════════════════════════════════════

export interface UpdateUserInput {
  userId: string;
  tenantId: string;
  username?: string;
  email?: string;
  phone?: string;
  status?: AccountStatus;
  metadata?: Record<string, any>;
}

export interface UpdateUserMetadataInput {
  userId: string;
  tenantId: string;
  metadata: Record<string, any>;
  merge?: boolean; // If true, merge with existing metadata; if false, replace
}
