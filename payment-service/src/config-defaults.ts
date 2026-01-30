/**
 * Payment Service Configuration Defaults
 * 
 * These defaults are registered at startup and automatically created in MongoDB
 * if they don't exist. This provides a single source of truth for configuration.
 * 
 * Sensitive paths are marked so they're filtered for non-admin users.
 */

export const PAYMENT_CONFIG_DEFAULTS = {
  // NOTE: Database configuration is handled by core-service strategy-config.ts
  // Do NOT define database config here - it uses MONGO_URI/REDIS_URL from environment
  // See CODING_STANDARDS.md for database access patterns
  
  // Service Configuration
  port: {
    value: 9002,
    description: 'Payment service port',
  },
  
  // CORS Configuration
  corsOrigins: {
    value: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
    ],
    description: 'Allowed CORS origins',
  },
  
  // JWT Configuration
  jwt: {
    value: {
      expiresIn: '8h',
      secret: '',
      refreshExpiresIn: '7d',
      refreshSecret: '',
    },
    sensitivePaths: ['jwt.secret', 'jwt.refreshSecret'] as string[],
    description: 'JWT configuration',
  },
  
  // Exchange Rate Configuration
  exchangeRate: {
    value: {
      defaultSource: 'manual',
      cacheTtl: 300,
      autoUpdateInterval: 3600,
      manualRates: {},
    },
    description: 'Exchange rate configuration',
  },
  
  // Transaction Configuration
  transaction: {
    value: {
      minAmount: 0.01,
      maxAmount: 1000000,
      allowNegativeBalance: false,
    },
    description: 'Transaction limits and rules',
  },
  
  // Wallet Configuration
  wallet: {
    value: {
      defaultCurrency: 'USD',
      supportedCurrencies: ['USD', 'EUR', 'GBP'],
      allowNegativeBalance: false,
    },
    description: 'Wallet configuration',
  },
  
  // Transfer Configuration
  transfer: {
    value: {
      requireApproval: false,
      maxPendingTransfers: 10,
      approvalTimeout: 3600,
    },
    description: 'Transfer approval configuration',
  },
} as const;
