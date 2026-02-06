/**
 * Payment Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * PaymentConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import type { PaymentConfig } from './types.js';
import { logger, getConfigWithDefault, getServiceConfigKey } from 'core-service';

export type { PaymentConfig } from './types.js';

export const SERVICE_NAME = 'payment-service';

let _useMongoTransactions = true;
export function setUseMongoTransactions(v: boolean): void {
  _useMongoTransactions = v;
}
export function getUseMongoTransactions(): boolean {
  return _useMongoTransactions;
}

const opts = (brand?: string, tenantId?: string) => ({ brand, tenantId, fallbackService: 'gateway' as const });

export async function loadConfig(brand?: string, tenantId?: string): Promise<PaymentConfig> {
  const port = await getServiceConfigKey<number>(SERVICE_NAME, 'port', 9002, opts(brand, tenantId));
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
  const exchangeRateConfig = await getConfigWithDefault<{ defaultSource: string; cacheTtl: number; autoUpdateInterval: number; manualRates: Record<string, unknown> }>(SERVICE_NAME, 'exchangeRate', { brand, tenantId }) ?? {
    defaultSource: 'manual',
    cacheTtl: 300,
    autoUpdateInterval: 3600,
    manualRates: {},
  };
  const transactionConfig = await getConfigWithDefault<{ minAmount: number; maxAmount: number; allowNegativeBalance: boolean; useTransactions?: boolean }>(SERVICE_NAME, 'transaction', { brand, tenantId }) ?? {
    minAmount: 0.01,
    maxAmount: 1000000,
    allowNegativeBalance: false,
    useTransactions: true,
  };
  const walletConfig = await getConfigWithDefault<{ defaultCurrency: string; supportedCurrencies: string[]; allowNegativeBalance: boolean }>(SERVICE_NAME, 'wallet', { brand, tenantId }) ?? {
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD', 'EUR', 'GBP'],
    allowNegativeBalance: false,
  };
  const transferConfig = await getConfigWithDefault<{ requireApproval: boolean; maxPendingTransfers: number; approvalTimeout: number }>(SERVICE_NAME, 'transfer', { brand, tenantId }) ?? {
    requireApproval: false,
    maxPendingTransfers: 10,
    approvalTimeout: 3600,
  };

  const portNum = typeof port === 'number' ? port : parseInt(String(port), 10);

  return {
    port: portNum,
    nodeEnv,
    serviceName,
    mongoUri: databaseConfig.mongoUri || undefined,
    redisUrl: databaseConfig.redisUrl || undefined,
    corsOrigins,
    jwtSecret: jwtConfig.secret || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: jwtConfig.expiresIn,
    jwtRefreshSecret: jwtConfig.refreshSecret,
    jwtRefreshExpiresIn: jwtConfig.refreshExpiresIn,
    exchangeRateDefaultSource: exchangeRateConfig.defaultSource,
    exchangeRateCacheTtl: typeof exchangeRateConfig.cacheTtl === 'number' ? exchangeRateConfig.cacheTtl : 300,
    exchangeRateAutoUpdateInterval: typeof exchangeRateConfig.autoUpdateInterval === 'number' ? exchangeRateConfig.autoUpdateInterval : 3600,
    transactionMinAmount: transactionConfig.minAmount,
    transactionMaxAmount: transactionConfig.maxAmount,
    allowNegativeBalance: transactionConfig.allowNegativeBalance,
    defaultCurrency: walletConfig.defaultCurrency,
    supportedCurrencies: walletConfig.supportedCurrencies,
    transferRequireApproval: transferConfig.requireApproval,
    maxPendingTransfers: transferConfig.maxPendingTransfers,
    approvalTimeout: transferConfig.approvalTimeout,
    useMongoTransactions: transactionConfig.useTransactions !== false,
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: PaymentConfig): void {
  if (!config.port || config.port < 1 || config.port > 65535) {
    throw new Error('Invalid port configuration');
  }
  
  if (!config.jwtSecret || config.jwtSecret.length < 16) {
    logger.warn('JWT secret is too short or missing - using default (not secure for production)');
  }
  
  // Note: mongoUri validation removed - gateway handles defaults
  // See CODING_STANDARDS.md for database access patterns
  
  if (config.transactionMinAmount < 0) {
    throw new Error('Transaction min amount must be >= 0');
  }
  
  if (config.transactionMaxAmount <= config.transactionMinAmount) {
    throw new Error('Transaction max amount must be > min amount');
  }
  
  if (!config.supportedCurrencies || config.supportedCurrencies.length === 0) {
    throw new Error('At least one supported currency is required');
  }
  
  logger.debug('Payment config validated successfully');
}

/**
 * Print configuration summary (without sensitive data)
 */
export function printConfigSummary(config: PaymentConfig): void {
  logger.info('Payment Service Configuration:', {
    port: config.port,
    serviceName: config.serviceName,
    nodeEnv: config.nodeEnv,
    corsOrigins: config.corsOrigins,
    jwtExpiresIn: config.jwtExpiresIn,
    defaultCurrency: config.defaultCurrency,
    supportedCurrencies: config.supportedCurrencies,
    transactionMinAmount: config.transactionMinAmount,
    transactionMaxAmount: config.transactionMaxAmount,
    allowNegativeBalance: config.allowNegativeBalance,
    transferRequireApproval: config.transferRequireApproval,
  });
}
