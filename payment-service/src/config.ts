/**
 * Payment Service Configuration
 * 
 * Centralized configuration management with dynamic MongoDB-based config store.
 * Supports multi-brand/tenant configurations with permission-based access.
 * 
 * Priority order:
 * 1. Environment variables (highest priority - overrides everything)
 * 2. MongoDB config store (dynamic, multi-brand/tenant) - stored in core_service
 * 3. Registered defaults (auto-created if missing)
 * 
 * NOTE: Config is always stored in core_service.service_configs (central)
 * because you need to read the database strategy before connecting to service DB.
 */

import { 
  logger, 
  getConfigWithDefault,
} from 'core-service';

/**
 * PaymentConfig with service-specific settings
 */
export interface PaymentConfig {
  // Service
  port: number;
  nodeEnv: string;
  serviceName: string;
  
  // Database - optional, gateway handles defaults from environment
  mongoUri?: string;
  redisUrl?: string;
  
  // CORS
  corsOrigins: string[];
  
  // JWT
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret?: string;
  jwtRefreshExpiresIn?: string;
  
  // Exchange Rate
  exchangeRateDefaultSource: string;
  exchangeRateCacheTtl: number;
  exchangeRateAutoUpdateInterval: number;
  
  // Transaction
  transactionMinAmount: number;
  transactionMaxAmount: number;
  allowNegativeBalance: boolean;
  
  // Wallet
  defaultCurrency: string;
  supportedCurrencies: string[];
  
  // Transfer
  transferRequireApproval: boolean;
  maxPendingTransfers: number;
  approvalTimeout: number;
}

// Service name constant
const SERVICE_NAME = 'payment-service';

/**
 * Load configuration from MongoDB config store with environment variable overrides
 */
export async function loadConfig(brand?: string, tenantId?: string): Promise<PaymentConfig> {
  const port = parseInt(process.env.PORT || '9002');
  
  // Load from MongoDB config store (core_service.service_configs) with automatic default creation
  const corsOrigins = await getConfigWithDefault<string[]>(SERVICE_NAME, 'corsOrigins', { brand, tenantId }) ?? [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ];
  
  const jwtConfig = await getConfigWithDefault<{ expiresIn: string; secret: string; refreshExpiresIn: string; refreshSecret: string }>(SERVICE_NAME, 'jwt', { brand, tenantId }) ?? {
    expiresIn: '8h',
    secret: '',
    refreshExpiresIn: '7d',
    refreshSecret: '',
  };
  
  const exchangeRateConfig = await getConfigWithDefault<{ defaultSource: string; cacheTtl: number; autoUpdateInterval: number; manualRates: Record<string, unknown> }>(SERVICE_NAME, 'exchangeRate', { brand, tenantId }) ?? {
    defaultSource: 'manual',
    cacheTtl: 300,
    autoUpdateInterval: 3600,
    manualRates: {},
  };
  
  const transactionConfig = await getConfigWithDefault<{ minAmount: number; maxAmount: number; allowNegativeBalance: boolean }>(SERVICE_NAME, 'transaction', { brand, tenantId }) ?? {
    minAmount: 0.01,
    maxAmount: 1000000,
    allowNegativeBalance: false,
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
  
  // NOTE: Database config is handled by core-service strategy-config.ts
  // Uses MONGO_URI and REDIS_URL from environment variables
  // See CODING_STANDARDS.md for database access patterns
  
  // MongoDB URI and Redis URL come from environment
  // The gateway scripts (docker/k8s) set these based on services.*.json config
  const mongoUri = process.env.MONGO_URI;
  const redisUrl = process.env.REDIS_URL;
  
  // Build config object (env vars override MongoDB configs)
  return {
    // Service
    port: parseInt(process.env.PORT || String(port)),
    nodeEnv: process.env.NODE_ENV || 'development',
    serviceName: process.env.SERVICE_NAME || SERVICE_NAME,
    
    // Database - Fully configurable from MongoDB config store
    mongoUri,
    redisUrl,
    
    // CORS - Env vars override MongoDB configs
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || corsOrigins,
    
    // JWT - Env vars override MongoDB configs
    jwtSecret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || jwtConfig.secret || 'shared-jwt-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || jwtConfig.expiresIn,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || jwtConfig.refreshSecret || 'shared-jwt-secret-change-in-production',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || jwtConfig.refreshExpiresIn,
    
    // Exchange Rate - Env vars override MongoDB configs
    exchangeRateDefaultSource: process.env.EXCHANGE_RATE_SOURCE || exchangeRateConfig.defaultSource,
    exchangeRateCacheTtl: parseInt(process.env.EXCHANGE_RATE_CACHE_TTL || String(exchangeRateConfig.cacheTtl)),
    exchangeRateAutoUpdateInterval: parseInt(process.env.EXCHANGE_RATE_AUTO_UPDATE_INTERVAL || String(exchangeRateConfig.autoUpdateInterval)),
    
    // Transaction - Env vars override MongoDB configs
    transactionMinAmount: parseFloat(process.env.TRANSACTION_MIN_AMOUNT || String(transactionConfig.minAmount)),
    transactionMaxAmount: parseFloat(process.env.TRANSACTION_MAX_AMOUNT || String(transactionConfig.maxAmount)),
    allowNegativeBalance: process.env.ALLOW_NEGATIVE_BALANCE === 'true' ? transactionConfig.allowNegativeBalance : false,
    
    // Wallet - Env vars override MongoDB configs
    defaultCurrency: process.env.DEFAULT_CURRENCY || walletConfig.defaultCurrency,
    supportedCurrencies: process.env.SUPPORTED_CURRENCIES?.split(',') || walletConfig.supportedCurrencies,
    
    // Transfer - Env vars override MongoDB configs
    transferRequireApproval: process.env.TRANSFER_REQUIRE_APPROVAL === 'true' ? transferConfig.requireApproval : false,
    maxPendingTransfers: parseInt(process.env.MAX_PENDING_TRANSFERS || String(transferConfig.maxPendingTransfers)),
    approvalTimeout: parseInt(process.env.APPROVAL_TIMEOUT || String(transferConfig.approvalTimeout)),
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
