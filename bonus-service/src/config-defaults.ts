/**
 * Bonus Service Configuration Defaults
 *
 * Every key read in loadConfig must exist here. Sensitive paths filtered for non-admin users.
 */

export const BONUS_CONFIG_DEFAULTS = {
  port: { value: 9003, description: 'Bonus service port' },
  serviceName: { value: 'bonus-service', description: 'Service name' },
  nodeEnv: { value: 'development', description: 'Node environment' },
  corsOrigins: {
    value: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    description: 'Allowed CORS origins',
  },
  jwt: {
    value: { expiresIn: '8h', secret: '', refreshExpiresIn: '7d', refreshSecret: '' },
    sensitivePaths: ['jwt.secret', 'jwt.refreshSecret'] as string[],
    description: 'JWT configuration',
  },
  database: {
    value: { mongoUri: '', redisUrl: '' },
    sensitivePaths: ['database.mongoUri', 'database.redisUrl'] as string[],
    description: 'MongoDB and Redis URLs (set via config store or deployment)',
  },
  transaction: {
    value: { useTransactions: true },
    description: 'Use MongoDB transactions for bonus operations',
  },
} as const;
