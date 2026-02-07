/**
 * Base service config loader – loads DefaultServiceConfig-shaped keys from the config store.
 * Services call loadBaseServiceConfig then merge service-specific keys in their loadConfig.
 * Use getBaseServiceConfigDefaults({ port, serviceName }) to get defaults; use configKeyOpts(brand, tenantId) for getServiceConfigKey.
 */

import type { DefaultServiceConfig } from '../../types/index.js';
import { getServiceConfigKey } from './store.js';

export interface BaseServiceConfigDefaults {
  port: number;
  serviceName: string;
  nodeEnv: string;
  corsOrigins: string[];
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret?: string;
    refreshExpiresIn?: string;
  };
  database: { mongoUri?: string; redisUrl?: string };
}

/** Shared default values merged by getBaseServiceConfigDefaults. Override only port/serviceName (and optionally jwt, etc.) per service. */
const SHARED_BASE_DEFAULTS: Omit<BaseServiceConfigDefaults, 'port' | 'serviceName'> = {
  nodeEnv: 'development',
  corsOrigins: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  jwt: { secret: '', expiresIn: '1h', refreshSecret: '', refreshExpiresIn: '7d' },
  database: { mongoUri: '', redisUrl: '' },
};

/** Overrides for getBaseServiceConfigDefaults; jwt and database are merged with shared defaults. */
export type BaseServiceConfigDefaultsOverrides = Pick<BaseServiceConfigDefaults, 'port' | 'serviceName'> & {
  nodeEnv?: string;
  corsOrigins?: string[];
  jwt?: Partial<BaseServiceConfigDefaults['jwt']>;
  database?: Partial<BaseServiceConfigDefaults['database']>;
};

/**
 * Returns base config defaults with overrides applied. Use in loadConfig: loadBaseServiceConfig(SERVICE_NAME, getBaseServiceConfigDefaults({ port: 9004, serviceName: SERVICE_NAME }), { brand, tenantId }).
 * Override at least port and serviceName; optionally jwt (e.g. { expiresIn: '2m' }), nodeEnv, corsOrigins, database.
 */
export function getBaseServiceConfigDefaults(overrides: BaseServiceConfigDefaultsOverrides): BaseServiceConfigDefaults {
  return {
    ...SHARED_BASE_DEFAULTS,
    ...overrides,
    jwt: { ...SHARED_BASE_DEFAULTS.jwt, ...overrides.jwt },
    database: { ...SHARED_BASE_DEFAULTS.database, ...overrides.database },
  };
}

/**
 * Options for getServiceConfigKey when reading service-only keys (no gateway fallback).
 * Use for all service-specific keys in loadConfig; loadBaseServiceConfig uses gateway fallback internally.
 */
export function configKeyOpts(brand?: string, tenantId?: string): { brand?: string; tenantId?: string } {
  return { brand, tenantId };
}

export interface LoadBaseServiceConfigOptions {
  brand?: string;
  tenantId?: string;
}

/**
 * Load base service config (port, serviceName, nodeEnv, corsOrigins, jwt, database).
 * Uses fallbackService: 'gateway' so common keys can be defined once on gateway.
 */
export async function loadBaseServiceConfig(
  serviceName: string,
  defaults: BaseServiceConfigDefaults,
  options?: LoadBaseServiceConfigOptions
): Promise<DefaultServiceConfig> {
  const opts = {
    brand: options?.brand,
    tenantId: options?.tenantId,
    fallbackService: 'gateway' as const,
  };

  const port = await getServiceConfigKey<number>(serviceName, 'port', defaults.port, opts);
  const resolvedServiceName = await getServiceConfigKey<string>(serviceName, 'serviceName', defaults.serviceName, opts);
  const nodeEnv = await getServiceConfigKey<string>(serviceName, 'nodeEnv', defaults.nodeEnv, opts);
  const corsOrigins = await getServiceConfigKey<string[]>(serviceName, 'corsOrigins', defaults.corsOrigins, opts);
  const jwtConfig = await getServiceConfigKey<BaseServiceConfigDefaults['jwt']>(serviceName, 'jwt', defaults.jwt, opts);
  const databaseConfig = await getServiceConfigKey<BaseServiceConfigDefaults['database']>(
    serviceName,
    'database',
    defaults.database,
    opts
  );

  return {
    port: typeof port === 'number' ? port : parseInt(String(port), 10),
    nodeEnv,
    serviceName: resolvedServiceName,
    corsOrigins,
    mongoUri: databaseConfig.mongoUri || undefined,
    redisUrl: databaseConfig.redisUrl || undefined,
    jwtSecret: jwtConfig.secret || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: jwtConfig.expiresIn,
    jwtRefreshSecret: jwtConfig.refreshSecret,
    jwtRefreshExpiresIn: jwtConfig.refreshExpiresIn ?? '7d',
  };
}
