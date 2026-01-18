/**
 * Authentication Service Types
 * 
 * This file re-exports types from the new modular type system.
 */

// ═══════════════════════════════════════════════════════════════════
// Re-export from new type system
// ═══════════════════════════════════════════════════════════════════

export type {
  IdentifierType,
  AccountStatus,
  AuthProvider,
  User,
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

// Role types are now imported from access-engine
export type {
  RoleContext,
  UserRole,
  ResolvedPermissions,
  RoleResolutionOptions,
  Role,
} from 'access-engine';

// Auth-service specific types
export interface AssignRoleInput {
  userId: string;
  tenantId: string;
  role: string;
  context?: string;
  expiresAt?: Date;
  assignedBy?: string;
  metadata?: Record<string, any>;
}

export interface RevokeRoleInput {
  userId: string;
  tenantId: string;
  role: string;
  context?: string;
  revokedBy?: string;
  reason?: string;
}

// SocialProfile is exported from user-types.ts

// ═══════════════════════════════════════════════════════════════════
// Session Types
// ═══════════════════════════════════════════════════════════════════

export interface Session {
  sessionId: string; // Renamed from 'id' to avoid confusion with user.id
  userId: string;
  tenantId: string;
  
  // Token reference
  refreshTokenId: string;
  
  // Session info
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: DeviceInfo;
  
  // Lifecycle
  createdAt: Date;
  expiresAt: Date;
  lastAccessedAt: Date;
  
  // Security
  isValid: boolean;
  invalidatedAt?: Date;
  invalidatedReason?: string;
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
  id: string;
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

export interface RefreshToken {
  id: string;
  userId: string;
  tenantId: string;
  
  // Token
  token: string;
  tokenHash: string;
  
  // Device/Session info
  deviceId?: string;
  deviceInfo?: DeviceInfo;
  
  // Lifecycle
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt?: Date;
  
  // Security
  isValid: boolean;
  revokedAt?: Date;
  revokedReason?: string;
}

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
  identifierType?: IdentifierType;
  
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
  provider: AuthProvider;
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
  token: string;
  newPassword: string;
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

// ═══════════════════════════════════════════════════════════════════
// Response Types
// ═══════════════════════════════════════════════════════════════════

export interface AuthResponse {
  success: boolean;
  message?: string;
  user?: User;
  tokens?: TokenPair;
  requiresOTP?: boolean;
  otpSentTo?: string;
  otpChannel?: OTPChannel;
}

export interface OTPResponse {
  success: boolean;
  message: string;
  otpSentTo?: string;
  channel?: OTPChannel;
  expiresIn?: number;
}

export interface TwoFactorSetupResponse {
  success: boolean;
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
  maxLoginAttempts: number;
  lockoutDuration: number; // minutes
  
  // OTP
  otpLength: number;
  otpExpiryMinutes: number;
  otpMaxAttempts: number;
  
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
