/**
 * Brand and Tenant Store
 * 
 * Manages brands and tenants as collections in core_service database.
 * Provides caching layer for performance.
 */

import { getDatabase, getClient } from './connection.js';
import { getCache, setCache, deleteCache } from '../cache.js';
import { logger } from '../../common/logger.js';
import { CORE_DATABASE_NAME } from './constants.js';
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

const CACHE_TTL = 3600;
const BRAND_CACHE_PREFIX = 'brand:';
const TENANT_CACHE_PREFIX = 'tenant:';
const BRAND_BY_CODE_CACHE_PREFIX = 'brand:code:';
const TENANT_BY_CODE_CACHE_PREFIX = 'tenant:code:';

// ═══════════════════════════════════════════════════════════════════
// Collections
// ═══════════════════════════════════════════════════════════════════

async function getBrandsCollection(): Promise<Collection<Brand>> {
  const client = getClient();
  const coreDb = client.db(CORE_DATABASE_NAME);
  return coreDb.collection<Brand>('brands');
}

async function getTenantsCollection(): Promise<Collection<Tenant>> {
  const client = getClient();
  const coreDb = client.db(CORE_DATABASE_NAME);
  return coreDb.collection<Tenant>('tenants');
}

// ═══════════════════════════════════════════════════════════════════
// Brand Operations
// ═══════════════════════════════════════════════════════════════════

export async function getBrandById(brandId: string): Promise<Brand | null> {
  const cacheKey = `${BRAND_CACHE_PREFIX}${brandId}`;
  const cached = await getCache<Brand>(cacheKey);
  if (cached) return cached;
  
  const collection = await getBrandsCollection();
  const brand = await collection.findOne({ id: brandId, active: true });
  
  if (brand) {
    await setCache(cacheKey, brand, CACHE_TTL);
    return brand;
  }
  return null;
}

export async function getBrandByCode(code: string): Promise<Brand | null> {
  const cacheKey = `${BRAND_BY_CODE_CACHE_PREFIX}${code}`;
  const cached = await getCache<Brand>(cacheKey);
  if (cached) return cached;
  
  const collection = await getBrandsCollection();
  const brand = await collection.findOne({ code, active: true });
  
  if (brand) {
    await setCache(cacheKey, brand, CACHE_TTL);
    await setCache(`${BRAND_CACHE_PREFIX}${brand.id}`, brand, CACHE_TTL);
    return brand;
  }
  return null;
}

export async function getAllBrands(): Promise<Brand[]> {
  const cacheKey = 'brands:all';
  const cached = await getCache<Brand[]>(cacheKey);
  if (cached) return cached;
  
  const collection = await getBrandsCollection();
  const brands = await collection.find({ active: true }).toArray();
  
  await setCache(cacheKey, brands, CACHE_TTL);
  for (const brand of brands) {
    await setCache(`${BRAND_CACHE_PREFIX}${brand.id}`, brand, CACHE_TTL);
    await setCache(`${BRAND_BY_CODE_CACHE_PREFIX}${brand.code}`, brand, CACHE_TTL);
  }
  return brands;
}

export async function invalidateBrandCache(brandId?: string, code?: string): Promise<void> {
  if (brandId) await deleteCache(`${BRAND_CACHE_PREFIX}${brandId}`);
  if (code) await deleteCache(`${BRAND_BY_CODE_CACHE_PREFIX}${code}`);
  await deleteCache('brands:all');
}

// ═══════════════════════════════════════════════════════════════════
// Tenant Operations
// ═══════════════════════════════════════════════════════════════════

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const cacheKey = `${TENANT_CACHE_PREFIX}${tenantId}`;
  const cached = await getCache<Tenant>(cacheKey);
  if (cached) return cached;
  
  const collection = await getTenantsCollection();
  const tenant = await collection.findOne({ id: tenantId, active: true });
  
  if (tenant) {
    await setCache(cacheKey, tenant, CACHE_TTL);
    return tenant;
  }
  return null;
}

export async function getTenantByCode(code: string): Promise<Tenant | null> {
  const cacheKey = `${TENANT_BY_CODE_CACHE_PREFIX}${code}`;
  const cached = await getCache<Tenant>(cacheKey);
  if (cached) return cached;
  
  const collection = await getTenantsCollection();
  const tenant = await collection.findOne({ code, active: true });
  
  if (tenant) {
    await setCache(cacheKey, tenant, CACHE_TTL);
    await setCache(`${TENANT_CACHE_PREFIX}${tenant.id}`, tenant, CACHE_TTL);
    return tenant;
  }
  return null;
}

export async function getTenantsByBrand(brandId: string): Promise<Tenant[]> {
  const cacheKey = `tenants:brand:${brandId}`;
  const cached = await getCache<Tenant[]>(cacheKey);
  if (cached) return cached;
  
  const collection = await getTenantsCollection();
  const tenants = await collection.find({ brandId, active: true }).toArray();
  
  await setCache(cacheKey, tenants, CACHE_TTL);
  for (const tenant of tenants) {
    await setCache(`${TENANT_CACHE_PREFIX}${tenant.id}`, tenant, CACHE_TTL);
    await setCache(`${TENANT_BY_CODE_CACHE_PREFIX}${tenant.code}`, tenant, CACHE_TTL);
  }
  return tenants;
}

export async function getAllTenants(): Promise<Tenant[]> {
  const cacheKey = 'tenants:all';
  const cached = await getCache<Tenant[]>(cacheKey);
  if (cached) return cached;
  
  const collection = await getTenantsCollection();
  const tenants = await collection.find({ active: true }).toArray();
  
  await setCache(cacheKey, tenants, CACHE_TTL);
  for (const tenant of tenants) {
    await setCache(`${TENANT_CACHE_PREFIX}${tenant.id}`, tenant, CACHE_TTL);
    await setCache(`${TENANT_BY_CODE_CACHE_PREFIX}${tenant.code}`, tenant, CACHE_TTL);
  }
  return tenants;
}

export async function invalidateTenantCache(tenantId?: string, code?: string, brandId?: string): Promise<void> {
  if (tenantId) await deleteCache(`${TENANT_CACHE_PREFIX}${tenantId}`);
  if (code) await deleteCache(`${TENANT_BY_CODE_CACHE_PREFIX}${code}`);
  if (brandId) await deleteCache(`tenants:brand:${brandId}`);
  await deleteCache('tenants:all');
}
