/**
 * Notification Service Configuration Defaults
 * 
 * These defaults are registered at startup and automatically created in MongoDB
 * if they don't exist. This provides a single source of truth for configuration.
 * 
 * Sensitive paths are marked so they're filtered for non-admin users.
 */

export const NOTIFICATION_CONFIG_DEFAULTS = {
  // NOTE: Database configuration is handled by core-service strategy-config.ts
  // Do NOT define database config here - it uses MONGO_URI/REDIS_URL from environment
  // See CODING_STANDARDS.md for database access patterns
  
  // Service Configuration
  port: {
    value: 9004,
    description: 'Notification service port',
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
  
  // SMTP Configuration
  smtp: {
    value: {
      host: '',
      port: 587,
      user: '',
      password: '',
      from: 'noreply@example.com',
      secure: false,
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
      whatsappNumber: '',
    },
    sensitivePaths: ['twilio.authToken'] as string[],
    description: 'Twilio SMS/WhatsApp configuration',
  },
  
  // Push Notifications Configuration
  push: {
    value: {
      apiKey: '',
      projectId: '',
    },
    sensitivePaths: ['push.apiKey'] as string[],
    description: 'Push notification provider configuration',
  },
  
  // Queue Configuration
  queue: {
    value: {
      concurrency: 5,
      maxRetries: 3,
      retryDelay: 5000,
    },
    description: 'Notification queue configuration',
  },
  
  // Real-time Configuration
  realtime: {
    value: {
      sseHeartbeatInterval: 30000,
      socketNamespace: '/notifications',
    },
    description: 'Real-time notification configuration',
  },
} as const;
