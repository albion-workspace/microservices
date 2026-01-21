/**
 * Authentication Service Types
 * 
 * This file re-exports types from the new modular type system.
 */

// ═══════════════════════════════════════════════════════════════════
// Re-export from new type system (import first to avoid circular dependencies)
// ═══════════════════════════════════════════════════════════════════

import type {
  IdentifierType as UserIdentifierType,
  AccountStatus,
  AuthProvider as UserAuthProvider,
  User as UserType,
  SocialProfile,
  UserFilter,
  UserQueryOptions,
  UpdateUserInput,
  UpdateUserMetadataInput,
  BankingMetadata,
  CryptoMetadata,
  ForexMetadata,
  BettingMetadata,
} from './types/user-types.js';

// Re-export with original names
export type {
  UserIdentifierType as IdentifierType,
  AccountStatus,
  UserAuthProvider as AuthProvider,
  UserType as User,
  SocialProfile,
  UserFilter,
  UserQueryOptions,
  UpdateUserInput,
  UpdateUserMetadataInput,
  BankingMetadata,
  CryptoMetadata,
  ForexMetadata,
  BettingMetadata,
};

// Role types from role-types module
export type {
  RoleContext,
  UserRole,
  RoleGraph,
  ResolvedPermissions,
  RoleResolutionOptions,
  AssignRoleInput,
  RevokeRoleInput,
} from './types/role-types.js';

// Role type from access-engine
export type { Role } from 'access-engine';

// SocialProfile is exported from user-types.ts

// ═══════════════════════════════════════════════════════════════════
// Session Types (Unified - combines refresh token and session data)
// ═══════════════════════════════════════════════════════════════════

export interface Session {
  id?: string; // MongoDB _id as string
  userId: string;
  tenantId: string;
  
  // Refresh Token (embedded, not separate collection)
  token: string; // Plain token (only stored temporarily during creation, not persisted)
  tokenHash: string; // Hashed token for lookups
  refreshTokenExpiresAt: Date; // Refresh token expiration (e.g., 7 days)
  
  // Device & Session Info
  deviceId: string;
  deviceInfo?: DeviceInfo;
  ipAddress?: string;
  userAgent?: string;
  
  // Lifecycle
  createdAt: Date;
  lastAccessedAt: Date; // Updated on each access
  lastUsedAt?: Date; // Updated when refresh token is used
  sessionExpiresAt: Date; // Session expiration (e.g., 30 days)
  
  // Security
  isValid: boolean;
  revokedAt?: Date;
  revokedReason?: string; // 'logout', 'logout_all', 'expired', 'password_reset', etc.
}

export interface DeviceInfo {
  deviceId?: string;
  deviceType?: 'web' | 'mobile' | 'tablet' | 'desktop';
  os?: string;
  browser?: string;
  location?: GeoLocation;
}

export interface GeoLocation {
  country?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}

// ═══════════════════════════════════════════════════════════════════
// OTP Types
// ═══════════════════════════════════════════════════════════════════

export type OTPChannel = 'email' | 'sms' | 'whatsapp' | 'telegram';

export type OTPPurpose = 'registration' | 'login' | 'password_reset' | 'email_verification' | 'phone_verification' | '2fa';

export interface OTP {
  id?: string; // MongoDB will automatically generate _id, which we map to id
  userId?: string; // Optional for registration
  tenantId: string;
  
  // OTP details
  code: string;
  hashedCode: string;
  
  // Delivery
  channel: OTPChannel;
  recipient: string; // email or phone number
  purpose: OTPPurpose;
  
  // Lifecycle
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
  usedAt?: Date;
  
  // Expiry
  createdAt: Date;
  expiresAt: Date;
  
  // Metadata
  metadata?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════
// Token Types
// ═══════════════════════════════════════════════════════════════════

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tenantId: string;
  token: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  isUsed: boolean;
  usedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Input Types (GraphQL/API)
// ═══════════════════════════════════════════════════════════════════

export interface RegisterInput {
  tenantId: string;
  
  // At least one identifier required
  username?: string;
  email?: string;
  phone?: string;
  
  // Password (required for local auth)
  password?: string;
  
  // Optional metadata (dynamic fields)
  metadata?: Record<string, any>;
  
  // Registration options
  autoVerify?: boolean; // Skip verification (for testing)
  sendOTP?: boolean; // Send OTP for verification
}

export interface LoginInput {
  tenantId: string;
  
  // Identifier (one required)
  identifier: string; // can be username, email, or phone
  identifierType?: UserIdentifierType;
  
  // Credentials
  password: string;
  
  // Optional 2FA
  twoFactorCode?: string;
  
  // Device info
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SocialAuthInput {
  tenantId: string;
  provider: UserAuthProvider;
  accessToken: string;
  
  // Optional metadata for new users
  metadata?: Record<string, any>;
}

export interface VerifyOTPInput {
  tenantId: string;
  recipient: string; // email or phone
  code: string;
  purpose: OTPPurpose;
}

export interface SendOTPInput {
  tenantId: string;
  recipient: string;
  channel: OTPChannel;
  purpose: OTPPurpose;
  userId?: string;
}

export interface ForgotPasswordInput {
  tenantId: string;
  identifier: string; // email or phone
}

export interface ResetPasswordInput {
  tenantId: string;
  token: string; // JWT reset token (from forgotPassword)
  newPassword: string;
  otpCode?: string; // Optional: OTP code for SMS/WhatsApp-based reset
}

export interface ChangePasswordInput {
  userId: string;
  tenantId: string;
  currentPassword: string;
  newPassword: string;
}

export interface Enable2FAInput {
  userId?: string;
  tenantId?: string;
  password: string;
}

export interface Verify2FAInput {
  userId?: string;
  tenantId?: string;
  token: string;
}

export interface RefreshTokenInput {
  refreshToken: string;
  tenantId: string;
}

export interface VerifyRegistrationInput {
  registrationToken: string;
  otpCode: string;
  tenantId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Response Types
// ═══════════════════════════════════════════════════════════════════

export interface AuthResponse {
  success: boolean;
  message?: string;
  user?: UserType;
  tokens?: TokenPair;
  requiresOTP?: boolean;
  otpSentTo?: string;
  otpChannel?: OTPChannel;
  registrationToken?: string; // JWT token for unverified registration
}

export interface OTPResponse {
  success: boolean;
  message: string;
  otpSentTo?: string;
  channel?: OTPChannel;
  expiresIn?: number;
  otpToken?: string; // JWT token with OTP embedded (for verification)
}

export interface TwoFactorSetupResponse {
  success: boolean;
  message?: string;
  secret?: string;
  qrCode?: string;
  backupCodes?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Service Configuration
// ═══════════════════════════════════════════════════════════════════

export interface AuthConfig {
  // JWT
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret?: string;
  jwtRefreshExpiresIn: string;
  
  // Security
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  
  // OTP
  otpLength: number;
  otpExpiryMinutes: number;
  
  // Session
  sessionMaxAge: number; // days
  maxActiveSessions: number;
  
  // Social providers
  googleClientId?: string;
  googleClientSecret?: string;
  googleCallbackUrl: string;
  
  facebookAppId?: string;
  facebookAppSecret?: string;
  facebookCallbackUrl: string;
  
  linkedinClientId?: string;
  linkedinClientSecret?: string;
  linkedinCallbackUrl: string;
  
  instagramClientId?: string;
  instagramClientSecret?: string;
  instagramCallbackUrl: string;
  
  // Communication providers
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  
  whatsappApiKey?: string;
  telegramBotToken?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════

export type AuthEventType = 
  | 'user.registered'
  | 'user.login'
  | 'user.logout'
  | 'user.email_verified'
  | 'user.phone_verified'
  | 'user.password_changed'
  | 'user.password_reset'
  | 'user.2fa_enabled'
  | 'user.2fa_disabled'
  | 'user.locked'
  | 'user.unlocked'
  | 'user.suspended'
  | 'user.deleted'
  | 'session.created'
  | 'session.expired'
  | 'session.revoked'
  | 'social.connected'
  | 'social.disconnected';

export interface AuthEvent {
  type: AuthEventType;
  userId: string;
  tenantId: string;
  data: Record<string, any>;
  timestamp: Date;
}
