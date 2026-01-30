/**
 * Auth Service Configuration Defaults
 * 
 * These defaults are registered at startup and automatically created in MongoDB
 * if they don't exist. This provides a single source of truth for configuration.
 * 
 * Sensitive paths are marked so they're filtered for non-admin users.
 */

export const AUTH_CONFIG_DEFAULTS = {
  // NOTE: Database configuration is handled by core-service strategy-config.ts
  // auth-service uses 'shared' strategy (core_service database) - see strategy-config.ts
  // Do NOT define database config here - it uses MONGO_URI/REDIS_URL from environment
  // See CODING_STANDARDS.md for database access patterns
  
  // OTP Configuration
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
  
  // JWT Configuration
  // NOTE: For testing token refresh, set expiresIn to '2m' (2 minutes)
  // For production, use '1h' (1 hour) or appropriate value
  jwt: {
    value: {
      expiresIn: '2m', // TESTING: 2 minutes for token refresh testing (change to '1h' for production)
      refreshExpiresIn: '7d',
      secret: '', // Will be set via env var or admin
      refreshSecret: '', // Will be set via env var or admin
    },
    sensitivePaths: ['jwt.secret', 'jwt.refreshSecret'] as string[],
    description: 'JWT configuration',
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
    },
    description: 'Application URLs',
  },
  
  // CORS Configuration
  corsOrigins: {
    value: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    description: 'Allowed CORS origins',
  },
} as const;

/**
 * Type-safe interface for auth config defaults
 * Used for type inference when loading configs
 */
export interface AuthConfigDefaults {
  otpLength: number;
  otpExpiryMinutes: number;
  sessionMaxAge: number;
  maxActiveSessions: number;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  jwt: {
    expiresIn: string;
    refreshExpiresIn: string;
    secret: string;
    refreshSecret: string;
  };
  oauth: {
    google: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
    };
    facebook: {
      appId: string;
      appSecret: string;
      callbackUrl: string;
    };
    linkedin: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
    };
    instagram: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
    };
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
  };
  twilio: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
  };
  whatsapp: {
    apiKey: string;
  };
  telegram: {
    botToken: string;
  };
  urls: {
    frontendUrl: string;
    appUrl: string;
  };
  corsOrigins: string[];
}
