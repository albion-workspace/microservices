/**
 * Context Resolver Utilities
 * 
 * Resolves brand and tenantId dynamically from:
 * 1. User context (if authenticated)
 * 2. MongoDB collections (brands/tenants)
 * 3. Environment variables (fallback)
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Uses abstractions (getDatabase, getConfigWithDefault)
 * - Static imports
 */

import { getBrandByCode, getTenantByCode } from '../databases/brand-tenant-store.js';
import { getConfigWithDefault } from './config-store.js';
import { logger } from './logger.js';
import type { UserContext } from '../types/index.js';

/**
 * Resolve brand and tenantId from context
 * 
 * Priority:
 * 1. User context (user.brand, user.tenantId) - if authenticated
 * 2. MongoDB config store (system-level brand/tenant config)
 * 3. Environment variables (BRAND_ID, TENANT_ID) - fallback
 * 
 * @param user - User context (optional, from JWT)
 * @param options - Additional options
 * @returns Resolved brand and tenantId
 */
export async function resolveContext(
  user?: UserContext | null,
  options?: {
    /** Force brand (overrides all) */
    brand?: string;
    /** Force tenantId (overrides all) */
    tenantId?: string;
  }
): Promise<{ brand?: string; tenantId?: string }> {
  // Priority 1: Explicit options (highest priority)
  if (options?.brand || options?.tenantId) {
    return {
      brand: options.brand,
      tenantId: options.tenantId,
    };
  }

  // Priority 2: User context (if authenticated)
  if (user) {
    const userBrand = (user as any).brand as string | undefined;
    const userTenantId = user.tenantId;
    
    if (userBrand || userTenantId) {
      return {
        brand: userBrand,
        tenantId: userTenantId,
      };
    }
  }

  // Priority 3: Brand/Tenant collections (from core_service database)
  try {
    // Try to resolve brand/tenant from collections if provided as codes
    // This allows lookup by code (e.g., 'brand-a' -> brand object -> brand.id)
    const brandCode = process.env.BRAND_ID;
    const tenantCode = process.env.TENANT_ID;
    
    let resolvedBrand: string | undefined;
    let resolvedTenant: string | undefined;
    
    if (brandCode) {
      const brand = await getBrandByCode(brandCode);
      if (brand) {
        resolvedBrand = brand.id;
      } else {
        // If not found in collection, use code as-is (backward compatibility)
        resolvedBrand = brandCode;
      }
    }
    
    if (tenantCode) {
      const tenant = await getTenantByCode(tenantCode);
      if (tenant) {
        resolvedTenant = tenant.id;
      } else {
        // If not found in collection, use code as-is (backward compatibility)
        resolvedTenant = tenantCode;
      }
    }
    
    if (resolvedBrand || resolvedTenant) {
      return {
        brand: resolvedBrand,
        tenantId: resolvedTenant,
      };
    }
  } catch (error) {
    logger.debug('Failed to load brand/tenant from collections', { error });
    // Continue to fallback
  }

  // Priority 4: MongoDB config store (system-level defaults)
  try {
    const systemBrand = await getConfigWithDefault<string>('core-service', 'defaultBrand');
    const systemTenantId = await getConfigWithDefault<string>('core-service', 'defaultTenantId');
    
    if (systemBrand || systemTenantId) {
      return {
        brand: systemBrand || undefined,
        tenantId: systemTenantId || undefined,
      };
    }
  } catch (error) {
    logger.debug('Failed to load system defaults from config store', { error });
    // Continue to fallback
  }

  // Priority 5: Environment variables (fallback)
  return {
    brand: process.env.BRAND_ID,
    tenantId: process.env.TENANT_ID,
  };
}

/**
 * Get brand from user context or config
 * Shorthand for resolveContext when only brand is needed
 */
export async function getBrand(user?: UserContext | null, forceBrand?: string): Promise<string | undefined> {
  const context = await resolveContext(user, { brand: forceBrand });
  return context.brand;
}

/**
 * Get tenantId from user context or config
 * Shorthand for resolveContext when only tenantId is needed
 */
export async function getTenantId(user?: UserContext | null, forceTenantId?: string): Promise<string | undefined> {
  const context = await resolveContext(user, { tenantId: forceTenantId });
  return context.tenantId;
}
