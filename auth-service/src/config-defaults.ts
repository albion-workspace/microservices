/**
 * Auth Service Configuration Defaults
 *
 * These defaults are registered at startup and automatically created in MongoDB
 * if they don't exist. Sensitive paths are filtered for non-admin users.
 *
 * JWT is common across microservices when using a shared strategy (like database).
 * Optional: register GATEWAY_JWT_DEFAULTS so getConfigWithDefault('gateway', 'jwt')
 * can be used as a fallback; gateway config (services.*.json environments.jwtSecret)
 * drives Docker/K8s env and can seed the store.
 */

/** Shared JWT defaults (key 'gateway') – same default everywhere; override via JSON or dynamic config. */
const SHARED_JWT_SECRET_DEFAULT = 'shared-jwt-secret-change-in-production';
export const GATEWAY_JWT_DEFAULTS = {
  jwt: {
    value: { expiresIn: '1h', refreshExpiresIn: '7d', secret: SHARED_JWT_SECRET_DEFAULT, refreshSecret: '' },
    sensitivePaths: ['jwt.secret', 'jwt.refreshSecret'] as string[],
    description: 'Shared JWT (used by all services by default; override per-service in dynamic config)',
  },
} as const;

/** Shared database defaults (key 'gateway') – Docker/bootstrap sets MONGO_URI/REDIS_URL; runtime uses dynamic config. */
export const GATEWAY_DATABASE_DEFAULTS = {
  database: {
    value: { mongoUri: '', redisUrl: '' },
    sensitivePaths: ['database.mongoUri', 'database.redisUrl'] as string[],
    description: 'Shared MongoDB/Redis URLs (bootstrap from env; override per-service in dynamic config)',
  },
} as const;

/** Shared CORS and nodeEnv (key 'gateway') – same pattern as database/JWT. */
export const GATEWAY_COMMON_DEFAULTS = {
  corsOrigins: {
    value: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'] as string[],
    description: 'Shared CORS origins (override per-service in dynamic config)',
  },
  nodeEnv: { value: 'development', description: 'Shared Node environment' },
} as const;

export const AUTH_CONFIG_DEFAULTS = {
  port: { value: 9001, description: 'Auth service port' },
  serviceName: { value: 'auth-service', description: 'Service name' },
  nodeEnv: { value: 'development', description: 'Node environment' },
  database: {
    value: { mongoUri: '', redisUrl: '' },
    sensitivePaths: ['database.mongoUri', 'database.redisUrl'] as string[],
    description: 'MongoDB and Redis URLs (set via config store or deployment)',
  },
  otpLength: {
    value: 6,
    description: 'OTP code length',
  },
  
  otpExpiryMinutes: {
    value: 10,
    description: 'OTP expiration time in minutes',
  },
  
  // Session Configuration
  sessionMaxAge: {
    value: 30,
    description: 'Session max age in days',
  },
  
  maxActiveSessions: {
    value: 5,
    description: 'Maximum active sessions per user',
  },
  
  // Password Policy
  passwordMinLength: {
    value: 8,
    description: 'Minimum password length',
  },
  
  passwordRequireUppercase: {
    value: true,
    description: 'Require uppercase letters in password',
  },
  
  passwordRequireNumbers: {
    value: true,
    description: 'Require numbers in password',
  },
  
  passwordRequireSymbols: {
    value: true,
    description: 'Require symbols in password',
  },
  
  // JWT Configuration (per-service; fallback to gateway key when empty – see loadConfig)
  // For token refresh testing use expiresIn: '2m'; for production use '1h'
  jwt: {
    value: {
      expiresIn: '2m',
      refreshExpiresIn: '7d',
      secret: '',
      refreshSecret: '',
    },
    sensitivePaths: ['jwt.secret', 'jwt.refreshSecret'] as string[],
    description: 'JWT configuration (shared across services when using gateway key)',
  },
  
  // OAuth Configuration
  oauth: {
    value: {
      google: {
        clientId: '',
        clientSecret: '',
        callbackUrl: '',
      },
      facebook: {
        appId: '',
        appSecret: '',
        callbackUrl: '',
      },
      linkedin: {
        clientId: '',
        clientSecret: '',
        callbackUrl: '',
      },
      instagram: {
        clientId: '',
        clientSecret: '',
        callbackUrl: '',
      },
    },
    sensitivePaths: [
      'oauth.google.clientSecret',
      'oauth.facebook.appSecret',
      'oauth.linkedin.clientSecret',
      'oauth.instagram.clientSecret',
    ] as string[],
    description: 'OAuth provider configuration',
  },
  
  // SMTP Configuration
  smtp: {
    value: {
      host: '',
      port: 587,
      user: '',
      password: '',
      from: '',
    },
    sensitivePaths: ['smtp.password'] as string[],
    description: 'SMTP email configuration',
  },
  
  // Twilio Configuration
  twilio: {
    value: {
      accountSid: '',
      authToken: '',
      phoneNumber: '',
    },
    sensitivePaths: ['twilio.authToken'] as string[],
    description: 'Twilio SMS/WhatsApp configuration',
  },
  
  // WhatsApp Configuration
  whatsapp: {
    value: {
      apiKey: '',
    },
    sensitivePaths: ['whatsapp.apiKey'] as string[],
    description: 'WhatsApp API configuration',
  },
  
  // Telegram Configuration
  telegram: {
    value: {
      botToken: '',
    },
    sensitivePaths: ['telegram.botToken'] as string[],
    description: 'Telegram bot configuration',
  },
  
  // URLs Configuration
  urls: {
    value: {
      frontendUrl: 'http://localhost:5173',
      appUrl: 'http://localhost:3000',
      notificationServiceUrl: 'http://localhost:9004/graphql',
      notificationServiceToken: '',
    },
    sensitivePaths: ['urls.notificationServiceToken'] as string[],
    description: 'Application and notification service URLs',
  },
  
  // CORS Configuration
  corsOrigins: {
    value: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    description: 'Allowed CORS origins',
  },
} as const;

/** Type of config default values (per key); derived from AUTH_CONFIG_DEFAULTS for getConfigWithDefault. */
type ConfigDefaultValues<T> = { [K in keyof T]: T[K] extends { value: infer V } ? V : never };
export type AuthConfigDefaults = ConfigDefaultValues<typeof AUTH_CONFIG_DEFAULTS>;
