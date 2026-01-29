/**
 * Brand and Tenant Store
 * 
 * Manages brands and tenants as collections in core_service database.
 * Provides caching layer for performance.
 * 
 * Following CODING_STANDARDS.md:
 * - Generic only (no service-specific logic)
 * - Uses abstractions (getDatabase, getCache, setCache)
 * - Static imports
 */

import { getDatabase, getClient } from './mongodb.js';
import { getCache, setCache, deleteCache } from './cache.js';
import { logger } from '../common/logger.js';
import { CORE_DATABASE_NAME } from './core-database.js';
import type { Collection } from 'mongodb';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface Brand {
  id: string;
  code: string;
  name: string;
  active: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tenant {
  id: string;
  code: string;
  name: string;
  brandId?: string;
  active: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════
// Cache Configuration
// ═══════════════════════════════════════════════════════════════════

const CACHE_TTL = 3600; // 1 hour
const BRAND_CACHE_PREFIX = 'brand:';
const TENANT_CACHE_PREFIX = 'tenant:';
const BRAND_BY_CODE_CACHE_PREFIX = 'brand:code:';
const TENANT_BY_CODE_CACHE_PREFIX = 'tenant:code:';

// ═══════════════════════════════════════════════════════════════════
// Collections
// ═══════════════════════════════════════════════════════════════════

async function getBrandsCollection(): Promise<Collection<Brand>> {
  const client = getClient();
  if (!client) {
    throw new Error('MongoDB client not initialized');
  }
  const coreDb = client.db(CORE_DATABASE_NAME);
  return coreDb.collection<Brand>('brands');
}

async function getTenantsCollection(): Promise<Collection<Tenant>> {
  const client = getClient();
  if (!client) {
    throw new Error('MongoDB client not initialized');
  }
  const coreDb = client.db(CORE_DATABASE_NAME);
  return coreDb.collection<Tenant>('tenants');
}

// ═══════════════════════════════════════════════════════════════════
// Brand Operations
// ═══════════════════════════════════════════════════════════════════

/**
 * Get brand by ID (with caching)
 */
export async function getBrandById(brandId: string): Promise<Brand | null> {
  const cacheKey = `${BRAND_CACHE_PREFIX}${brandId}`;
  
  // Try cache first
  const cached = await getCache<Brand>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const collection = await getBrandsCollection();
  const brand = await collection.findOne({ id: brandId, active: true });
  
  if (brand) {
    // Cache result
    await setCache(cacheKey, brand, CACHE_TTL);
    return brand;
  }
  
  return null;
}

/**
 * Get brand by code (with caching)
 */
export async function getBrandByCode(code: string): Promise<Brand | null> {
  const cacheKey = `${BRAND_BY_CODE_CACHE_PREFIX}${code}`;
  
  // Try cache first
  const cached = await getCache<Brand>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const collection = await getBrandsCollection();
  const brand = await collection.findOne({ code, active: true });
  
  if (brand) {
    // Cache result
    await setCache(cacheKey, brand, CACHE_TTL);
    // Also cache by ID
    await setCache(`${BRAND_CACHE_PREFIX}${brand.id}`, brand, CACHE_TTL);
    return brand;
  }
  
  return null;
}

/**
 * Get all active brands (with caching)
 */
export async function getAllBrands(): Promise<Brand[]> {
  const cacheKey = 'brands:all';
  
  // Try cache first
  const cached = await getCache<Brand[]>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const collection = await getBrandsCollection();
  const brands = await collection.find({ active: true }).toArray();
  
  // Cache result
  await setCache(cacheKey, brands, CACHE_TTL);
  
  // Also cache individual brands
  for (const brand of brands) {
    await setCache(`${BRAND_CACHE_PREFIX}${brand.id}`, brand, CACHE_TTL);
    await setCache(`${BRAND_BY_CODE_CACHE_PREFIX}${brand.code}`, brand, CACHE_TTL);
  }
  
  return brands;
}

/**
 * Invalidate brand cache
 */
export async function invalidateBrandCache(brandId?: string, code?: string): Promise<void> {
  if (brandId) {
    await deleteCache(`${BRAND_CACHE_PREFIX}${brandId}`);
  }
  if (code) {
    await deleteCache(`${BRAND_BY_CODE_CACHE_PREFIX}${code}`);
  }
  await deleteCache('brands:all');
}

// ═══════════════════════════════════════════════════════════════════
// Tenant Operations
// ═══════════════════════════════════════════════════════════════════

/**
 * Get tenant by ID (with caching)
 */
export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const cacheKey = `${TENANT_CACHE_PREFIX}${tenantId}`;
  
  // Try cache first
  const cached = await getCache<Tenant>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const collection = await getTenantsCollection();
  const tenant = await collection.findOne({ id: tenantId, active: true });
  
  if (tenant) {
    // Cache result
    await setCache(cacheKey, tenant, CACHE_TTL);
    return tenant;
  }
  
  return null;
}

/**
 * Get tenant by code (with caching)
 */
export async function getTenantByCode(code: string): Promise<Tenant | null> {
  const cacheKey = `${TENANT_BY_CODE_CACHE_PREFIX}${code}`;
  
  // Try cache first
  const cached = await getCache<Tenant>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const collection = await getTenantsCollection();
  const tenant = await collection.findOne({ code, active: true });
  
  if (tenant) {
    // Cache result
    await setCache(cacheKey, tenant, CACHE_TTL);
    // Also cache by ID
    await setCache(`${TENANT_CACHE_PREFIX}${tenant.id}`, tenant, CACHE_TTL);
    return tenant;
  }
  
  return null;
}

/**
 * Get tenants by brand ID (with caching)
 */
export async function getTenantsByBrand(brandId: string): Promise<Tenant[]> {
  const cacheKey = `tenants:brand:${brandId}`;
  
  // Try cache first
  const cached = await getCache<Tenant[]>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const collection = await getTenantsCollection();
  const tenants = await collection.find({ brandId, active: true }).toArray();
  
  // Cache result
  await setCache(cacheKey, tenants, CACHE_TTL);
  
  // Also cache individual tenants
  for (const tenant of tenants) {
    await setCache(`${TENANT_CACHE_PREFIX}${tenant.id}`, tenant, CACHE_TTL);
    await setCache(`${TENANT_BY_CODE_CACHE_PREFIX}${tenant.code}`, tenant, CACHE_TTL);
  }
  
  return tenants;
}

/**
 * Get all active tenants (with caching)
 */
export async function getAllTenants(): Promise<Tenant[]> {
  const cacheKey = 'tenants:all';
  
  // Try cache first
  const cached = await getCache<Tenant[]>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const collection = await getTenantsCollection();
  const tenants = await collection.find({ active: true }).toArray();
  
  // Cache result
  await setCache(cacheKey, tenants, CACHE_TTL);
  
  // Also cache individual tenants
  for (const tenant of tenants) {
    await setCache(`${TENANT_CACHE_PREFIX}${tenant.id}`, tenant, CACHE_TTL);
    await setCache(`${TENANT_BY_CODE_CACHE_PREFIX}${tenant.code}`, tenant, CACHE_TTL);
  }
  
  return tenants;
}

/**
 * Invalidate tenant cache
 */
export async function invalidateTenantCache(tenantId?: string, code?: string, brandId?: string): Promise<void> {
  if (tenantId) {
    await deleteCache(`${TENANT_CACHE_PREFIX}${tenantId}`);
  }
  if (code) {
    await deleteCache(`${TENANT_BY_CODE_CACHE_PREFIX}${code}`);
  }
  if (brandId) {
    await deleteCache(`tenants:brand:${brandId}`);
  }
  await deleteCache('tenants:all');
}
