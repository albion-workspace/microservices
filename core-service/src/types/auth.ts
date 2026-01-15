/**
 * Authentication & Authorization Types
 */

// ═══════════════════════════════════════════════════════════════════
// User Context
// ═══════════════════════════════════════════════════════════════════

export interface UserContext {
  userId: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
}

// ═══════════════════════════════════════════════════════════════════
// JWT Configuration
// ═══════════════════════════════════════════════════════════════════

export interface JwtConfig {
  secret: string;
  refreshSecret?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  refreshExpiresIn?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

// ═══════════════════════════════════════════════════════════════════
// Permissions
// ═══════════════════════════════════════════════════════════════════

export interface Permission {
  resource: string;
  resourceId: string;
  action: string;
}

export type PermissionRule = (
  user: UserContext | null,
  args: Record<string, unknown>
) => boolean | Promise<boolean>;

export interface PermissionMap {
  Query?: Record<string, PermissionRule | boolean>;
  Mutation?: Record<string, PermissionRule | boolean>;
}

