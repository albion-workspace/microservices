/**
 * Role Types
 * 
 * Types for graph-based role system.
 * These types are re-exported from access-engine for consistency.
 */

import type {
  RoleContext as AccessEngineRoleContext,
  UserRole as AccessEngineUserRole,
} from 'access-engine';

// Re-export from access-engine
export type RoleContext = AccessEngineRoleContext;
export type UserRole = AccessEngineUserRole;

// Additional types for role management
export interface RoleGraph {
  roles: Map<string, any>;
  permissions: Map<string, any>;
}

export interface ResolvedPermissions {
  allowed: string[];
  denied: string[];
}

export interface RoleResolutionOptions {
  includeInherited?: boolean;
  includeContext?: boolean;
}

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
