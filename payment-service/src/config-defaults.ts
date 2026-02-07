/**
 * Payment Service Configuration Defaults
 *
 * Every key read in loadConfig (and by domain code) must exist here.
 * Pass to registerServiceConfigDefaults('payment-service', PAYMENT_CONFIG_DEFAULTS) in index.ts.
 * No process.env; no registration logic in this file (CODING_STANDARDS / service generator).
 */

export const PAYMENT_CONFIG_DEFAULTS = {
  port: { value: 9002, description: 'Payment service port' },
  serviceName: { value: 'payment-service', description: 'Service name' },
  nodeEnv: { value: 'development', description: 'Node environment' },
  database: {
    value: { mongoUri: '', redisUrl: '' },
    sensitivePaths: ['database.mongoUri', 'database.redisUrl'] as string[],
    description: 'MongoDB and Redis URLs (set via config store or deployment)',
  },
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
      useTransactions: true,
    },
    description: 'Transaction limits and rules; useTransactions for MongoDB transactions',
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
