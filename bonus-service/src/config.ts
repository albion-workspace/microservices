/**
 * Bonus Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * BonusConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import type { BonusConfig } from './types.js';
import { logger, loadBaseServiceConfig, getBaseServiceConfigDefaults, getServiceConfigKey, configKeyOpts } from 'core-service';

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
  const base = await loadBaseServiceConfig(SERVICE_NAME, getBaseServiceConfigDefaults({ port: 9003, serviceName: SERVICE_NAME, jwt: { expiresIn: '8h' } }), { brand, tenantId });
  const transactionConfig = await getServiceConfigKey<{ useTransactions?: boolean }>(
    SERVICE_NAME,
    'transaction',
    { useTransactions: true },
    configKeyOpts(brand, tenantId)
  );
  return {
    ...base,
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
