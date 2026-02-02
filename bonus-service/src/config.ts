/**
 * Bonus Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * BonusConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import type { BonusConfig } from './types.js';
import { logger, getConfigWithDefault } from 'core-service';

export type { BonusConfig } from './types.js';

const SERVICE_NAME = 'bonus-service';

/** Set by index after loadConfig so bonus.ts sagaOptions can read it without process.env */
let _useMongoTransactions = true;
export function setUseMongoTransactions(v: boolean): void {
  _useMongoTransactions = v;
}
export function getUseMongoTransactions(): boolean {
  return _useMongoTransactions;
}

export async function loadConfig(brand?: string, tenantId?: string): Promise<BonusConfig> {
  const port = (await getConfigWithDefault<number>(SERVICE_NAME, 'port', { brand, tenantId })) ?? 9003;
  const serviceName = (await getConfigWithDefault<string>(SERVICE_NAME, 'serviceName', { brand, tenantId })) ?? SERVICE_NAME;
  const nodeEnv = (await getConfigWithDefault<string>(SERVICE_NAME, 'nodeEnv', { brand, tenantId })) ?? (await getConfigWithDefault<string>('gateway', 'nodeEnv', { brand, tenantId })) ?? 'development';
  const corsOrigins = (await getConfigWithDefault<string[]>(SERVICE_NAME, 'corsOrigins', { brand, tenantId })) ?? (await getConfigWithDefault<string[]>('gateway', 'corsOrigins', { brand, tenantId })) ?? [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ];
  const jwtConfig = (await getConfigWithDefault<{ expiresIn: string; secret: string; refreshExpiresIn: string; refreshSecret: string }>(SERVICE_NAME, 'jwt', { brand, tenantId })) ?? (await getConfigWithDefault<{ expiresIn: string; secret: string; refreshExpiresIn: string; refreshSecret: string }>('gateway', 'jwt', { brand, tenantId })) ?? {
    expiresIn: '8h',
    secret: '',
    refreshExpiresIn: '7d',
    refreshSecret: '',
  };
  const databaseConfig = (await getConfigWithDefault<{ mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { brand, tenantId })) ?? (await getConfigWithDefault<{ mongoUri?: string; redisUrl?: string }>('gateway', 'database', { brand, tenantId })) ?? { mongoUri: '', redisUrl: '' };
  const transactionConfig = await getConfigWithDefault<{ useTransactions?: boolean }>(SERVICE_NAME, 'transaction', { brand, tenantId }) ?? { useTransactions: true };

  return {
    port: typeof port === 'number' ? port : parseInt(String(port), 10),
    nodeEnv,
    serviceName,
    mongoUri: databaseConfig.mongoUri || undefined,
    redisUrl: databaseConfig.redisUrl || undefined,
    corsOrigins,
    jwtSecret: jwtConfig.secret || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: jwtConfig.expiresIn,
    jwtRefreshSecret: jwtConfig.refreshSecret,
    jwtRefreshExpiresIn: jwtConfig.refreshExpiresIn,
    useMongoTransactions: transactionConfig.useTransactions !== false,
  };
}

/**
 * Validate required configuration
 */
export function validateConfig(config: BonusConfig): void {
  const errors: string[] = [];
  
  if (!config.port || config.port < 1 || config.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }
  
  // Note: mongoUri validation removed - gateway handles defaults
  // See CODING_STANDARDS.md for database access patterns
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

/**
 * Print configuration summary (for debugging)
 */
export function printConfigSummary(config: BonusConfig): void {
  logger.info('Bonus Service Configuration:', {
    Port: config.port,
    MongoDB: config.mongoUri,
    Redis: config.redisUrl || 'not configured',
    CORS: config.corsOrigins.length + ' origin(s)',
  });
}
