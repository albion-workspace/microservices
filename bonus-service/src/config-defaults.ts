/**
 * Bonus Service Configuration Defaults
 * 
 * These defaults are registered at startup and automatically created in MongoDB
 * if they don't exist. This provides a single source of truth for configuration.
 * 
 * Sensitive paths are marked so they're filtered for non-admin users.
 */

export const BONUS_CONFIG_DEFAULTS = {
  // NOTE: Database configuration is handled by core-service strategy-config.ts
  // Do NOT define database config here - it uses MONGO_URI/REDIS_URL from environment
  // See CODING_STANDARDS.md for database access patterns
  
  // Service Configuration
  port: {
    value: 9003,
    description: 'Bonus service port',
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
} as const;
