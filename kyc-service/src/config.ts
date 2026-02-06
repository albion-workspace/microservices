/**
 * KYC Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * KYCConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import type { KYCConfig } from './types.js';
import { getServiceConfigKey } from 'core-service';

const opts = (brand?: string, tenantId?: string) => ({ brand, tenantId, fallbackService: 'gateway' as const });

export type { KYCConfig } from './types.js';

export const SERVICE_NAME = 'kyc-service';

export async function loadConfig(brand?: string, tenantId?: string): Promise<KYCConfig> {
  const port = await getServiceConfigKey<number>(SERVICE_NAME, 'port', 9005, opts(brand, tenantId));
  const serviceName = await getServiceConfigKey<string>(SERVICE_NAME, 'serviceName', SERVICE_NAME, opts(brand, tenantId));
  const nodeEnv = await getServiceConfigKey<string>(SERVICE_NAME, 'nodeEnv', 'development', opts(brand, tenantId));
  const corsOrigins = await getServiceConfigKey<string[]>(SERVICE_NAME, 'corsOrigins', [
    'http://localhost:3000',
    'http://localhost:5173',
  ], opts(brand, tenantId));
  const jwtConfig = await getServiceConfigKey<{ secret: string; expiresIn: string; refreshSecret?: string; refreshExpiresIn?: string }>(SERVICE_NAME, 'jwt', {
    secret: '',
    expiresIn: '1h',
    refreshSecret: '',
    refreshExpiresIn: '7d',
  }, opts(brand, tenantId));
  const databaseConfig = await getServiceConfigKey<{ mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { mongoUri: '', redisUrl: '' }, opts(brand, tenantId));

  return {
    port: typeof port === 'number' ? port : parseInt(String(port), 10),
    nodeEnv,
    serviceName,
    corsOrigins,
    mongoUri: databaseConfig.mongoUri || undefined,
    redisUrl: databaseConfig.redisUrl || undefined,
    jwtSecret: jwtConfig.secret || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: jwtConfig.expiresIn,
    jwtRefreshSecret: jwtConfig.refreshSecret,
    jwtRefreshExpiresIn: jwtConfig.refreshExpiresIn ?? '7d',
  };
}

export function validateConfig(config: KYCConfig): void {
  if (!config.jwtSecret || config.jwtSecret === 'shared-jwt-secret-change-in-production') {
    console.warn('JWT secret should be set in config store for production');
  }
}

export function printConfigSummary(config: KYCConfig): void {
  console.log('Config:', { port: config.port, serviceName: config.serviceName });
}
