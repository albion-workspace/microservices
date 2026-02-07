/**
 * Payment Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * PaymentConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import type { PaymentConfig } from './types.js';
import { logger, loadBaseServiceConfig, getBaseServiceConfigDefaults, getServiceConfigKey, configKeyOpts } from 'core-service';

export type { PaymentConfig } from './types.js';

export const SERVICE_NAME = 'payment-service';

let _useMongoTransactions = true;
export function setUseMongoTransactions(v: boolean): void {
  _useMongoTransactions = v;
}
export function getUseMongoTransactions(): boolean {
  return _useMongoTransactions;
}

export async function loadConfig(brand?: string, tenantId?: string): Promise<PaymentConfig> {
  const base = await loadBaseServiceConfig(SERVICE_NAME, getBaseServiceConfigDefaults({ port: 9002, serviceName: SERVICE_NAME, jwt: { expiresIn: '8h' } }), { brand, tenantId });
  const opts = configKeyOpts(brand, tenantId);
  const exchangeRateConfig = await getServiceConfigKey<{ defaultSource: string; cacheTtl: number; autoUpdateInterval: number; manualRates: Record<string, unknown> }>(
    SERVICE_NAME, 'exchangeRate',
    { defaultSource: 'manual', cacheTtl: 300, autoUpdateInterval: 3600, manualRates: {} },
    opts
  );
  const transactionConfig = await getServiceConfigKey<{ minAmount: number; maxAmount: number; allowNegativeBalance: boolean; useTransactions?: boolean }>(
    SERVICE_NAME, 'transaction',
    { minAmount: 0.01, maxAmount: 1000000, allowNegativeBalance: false, useTransactions: true },
    opts
  );
  const walletConfig = await getServiceConfigKey<{ defaultCurrency: string; supportedCurrencies: string[]; allowNegativeBalance: boolean }>(
    SERVICE_NAME, 'wallet',
    { defaultCurrency: 'USD', supportedCurrencies: ['USD', 'EUR', 'GBP'], allowNegativeBalance: false },
    opts
  );
  const transferConfig = await getServiceConfigKey<{ requireApproval: boolean; maxPendingTransfers: number; approvalTimeout: number }>(
    SERVICE_NAME, 'transfer',
    { requireApproval: false, maxPendingTransfers: 10, approvalTimeout: 3600 },
    opts
  );

  return {
    ...base,
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
