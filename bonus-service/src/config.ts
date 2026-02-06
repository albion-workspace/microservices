/**
 * Bonus Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * BonusConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import type { BonusConfig } from './types.js';
import { logger, getServiceConfigKey } from 'core-service';

const opts = (brand?: string, tenantId?: string) => ({ brand, tenantId, fallbackService: 'gateway' as const });

export type { BonusConfig } from './types.js';

export const SERVICE_NAME = 'bonus-service';

/** Set by index after loadConfig so bonus.ts sagaOptions can read it without process.env */
let _useMongoTransactions = true;
export function setUseMongoTransactions(v: boolean): void {
  _useMongoTransactions = v;
}
export function getUseMongoTransactions(): boolean {
  return _useMongoTransactions;
}

export async function loadConfig(brand?: string, tenantId?: string): Promise<BonusConfig> {
  const port = await getServiceConfigKey<number>(SERVICE_NAME, 'port', 9003, opts(brand, tenantId));
  const serviceName = await getServiceConfigKey<string>(SERVICE_NAME, 'serviceName', SERVICE_NAME, opts(brand, tenantId));
  const nodeEnv = await getServiceConfigKey<string>(SERVICE_NAME, 'nodeEnv', 'development', opts(brand, tenantId));
  const corsOrigins = await getServiceConfigKey<string[]>(SERVICE_NAME, 'corsOrigins', [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ], opts(brand, tenantId));
  const jwtConfig = await getServiceConfigKey<{ expiresIn: string; secret: string; refreshExpiresIn: string; refreshSecret: string }>(SERVICE_NAME, 'jwt', {
    expiresIn: '8h',
    secret: '',
    refreshExpiresIn: '7d',
    refreshSecret: '',
  }, opts(brand, tenantId));
  const databaseConfig = await getServiceConfigKey<{ mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { mongoUri: '', redisUrl: '' }, opts(brand, tenantId));
  const transactionConfig = await getServiceConfigKey<{ useTransactions?: boolean }>(SERVICE_NAME, 'transaction', { useTransactions: true }, { brand, tenantId });

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
