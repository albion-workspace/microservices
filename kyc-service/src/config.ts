/**
 * KYC Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 */

import type { DefaultServiceConfig } from 'core-service';
import { getConfigWithDefault } from 'core-service';

const SERVICE_NAME = 'kyc-service';

export interface KYCConfig extends DefaultServiceConfig {}

export async function loadConfig(brand?: string, tenantId?: string): Promise<KYCConfig> {
  const port = (await getConfigWithDefault<number>(SERVICE_NAME, 'port', { brand, tenantId })) ?? 9005;
  const serviceName = (await getConfigWithDefault<string>(SERVICE_NAME, 'serviceName', { brand, tenantId })) ?? SERVICE_NAME;
  const nodeEnv = (await getConfigWithDefault<string>(SERVICE_NAME, 'nodeEnv', { brand, tenantId })) ?? (await getConfigWithDefault<string>('gateway', 'nodeEnv', { brand, tenantId })) ?? 'development';
  const corsOrigins = (await getConfigWithDefault<string[]>(SERVICE_NAME, 'corsOrigins', { brand, tenantId })) ?? (await getConfigWithDefault<string[]>('gateway', 'corsOrigins', { brand, tenantId })) ?? [
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  const jwtConfig = (await getConfigWithDefault<{ secret: string; expiresIn: string; refreshSecret?: string; refreshExpiresIn?: string }>(SERVICE_NAME, 'jwt', { brand, tenantId })) ?? (await getConfigWithDefault<{ secret: string; expiresIn: string; refreshSecret?: string; refreshExpiresIn?: string }>('gateway', 'jwt', { brand, tenantId })) ?? {
    secret: '',
    expiresIn: '1h',
    refreshSecret: '',
    refreshExpiresIn: '7d',
  };
  const databaseConfig = (await getConfigWithDefault<{ mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { brand, tenantId })) ?? (await getConfigWithDefault<{ mongoUri?: string; redisUrl?: string }>('gateway', 'database', { brand, tenantId })) ?? { mongoUri: '', redisUrl: '' };

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
