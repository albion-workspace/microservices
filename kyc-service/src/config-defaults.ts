/**
 * KYC Service Configuration Defaults
 *
 * Every key read in loadConfig (and by domain code) must exist here.
 * Pass to registerServiceConfigDefaults('kyc-service', KYC_CONFIG_DEFAULTS) in index.ts.
 * No process.env; no registration logic in this file (CODING_STANDARDS / service generator).
 */

// Common (key-by-key in config.ts)
export const KYC_CONFIG_DEFAULTS = {
  port: { value: 9005, description: 'HTTP port' },
    serviceName: { value: 'kyc-service', description: 'Service name' },
    nodeEnv: { value: 'development', description: 'Node environment' },
    corsOrigins: {
      value: ['http://localhost:3000', 'http://localhost:5173'],
      description: 'Allowed CORS origins',
    },
    jwt: {
      value: { secret: '', expiresIn: '1h', refreshSecret: '', refreshExpiresIn: '7d' },
      sensitivePaths: ['jwt.secret', 'jwt.refreshSecret'] as string[],
      description: 'JWT configuration',
    },
    database: {
      value: { mongoUri: '', redisUrl: '' },
      sensitivePaths: ['database.mongoUri', 'database.redisUrl'] as string[],
      description: 'MongoDB and Redis URLs (set via config store or deployment)',
    },
    // Provider Configuration (single-JSON)
    providers: {
      value: {
        defaultProvider: 'mock', // Use 'onfido', 'sumsub', etc. in production
        providers: {
          mock: {
            enabled: true,
            apiUrl: '',
            apiKey: '',
          },
          onfido: {
            enabled: false,
            apiUrl: 'https://api.onfido.com/v3.6',
            apiKey: '',
            webhookSecret: '',
          },
          sumsub: {
            enabled: false,
            apiUrl: 'https://api.sumsub.com',
            apiKey: '',
            apiSecret: '',
            webhookSecret: '',
          },
        },
      },
      sensitivePaths: [
        'providers.onfido.apiKey',
        'providers.onfido.webhookSecret',
        'providers.sumsub.apiKey',
        'providers.sumsub.apiSecret',
        'providers.sumsub.webhookSecret',
      ],
    },
    
    // Verification Settings
    verification: {
      value: {
        // Session expiry
        sessionExpiryMinutes: 60,
        
        // Auto-approval
        allowAutoApproval: true,
        autoApprovalMinConfidence: 90,
        
        // Retries
        maxRetryAttempts: 3,
        retryWaitDays: 1,
        
        // Document
        maxDocumentSizeMB: 10,
        acceptedFileTypes: ['image/jpeg', 'image/png', 'application/pdf'],
        
        // Liveness
        livenessRequired: true,
        livenessLevel: 'enhanced',
        
        // Face Match
        faceMatchRequired: true,
        faceMatchThreshold: 80,
      },
    },
    
    // AML/Compliance Settings
    compliance: {
      value: {
        // AML
        amlCheckRequired: true,
        amlPeriodicCheckIntervalDays: 90,
        
        // PEP
        pepScreeningRequired: true,
        pepScreeningIntervalDays: 180,
        
        // Sanctions
        sanctionCheckRequired: true,
        sanctionLists: ['OFAC', 'EU', 'UN', 'UK'],
        
        // Source of Funds
        sourceOfFundsThreshold: 10000,
        sourceOfFundsCurrency: 'EUR',
        
        // Enhanced Due Diligence
        eddCountries: ['AF', 'BY', 'MM', 'CF', 'CD', 'IR', 'IQ', 'LB', 'LY', 'ML', 'NI', 'KP', 'PK', 'RU', 'SO', 'SS', 'SD', 'SY', 'VE', 'YE', 'ZW'],
        
        // Blocked Countries
        blockedCountries: ['KP', 'IR', 'SY', 'CU'],
      },
    },
    
    // Risk Settings
    risk: {
      value: {
        // Scoring
        baseScore: 20,
        
        // Thresholds
        lowRiskThreshold: 25,
        mediumRiskThreshold: 50,
        highRiskThreshold: 75,
        
        // Auto-actions
        autoSuspendOnCriticalRisk: true,
        manualReviewOnHighRisk: true,
        
        // Periodic assessment
        periodicAssessmentIntervalDays: 365,
      },
    },
    
    // Expiration Settings
    expiration: {
      value: {
        // Tier expiry (days, null = never)
        tierExpiry: {
          none: null,
          basic: null,
          standard: 365 * 2, // 2 years
          enhanced: 365, // 1 year
          full: 365, // 1 year
          professional: 365, // 1 year
        },
        
        // Document expiry warning (days before)
        documentExpiryWarningDays: 30,
        
        // Re-verification grace period
        reVerificationGracePeriodDays: 30,
        
        // Auto-downgrade
        autoDowngradeOnExpiry: true,
        downgradeToTier: 'basic',
      },
    },
    
    // Storage Settings
    storage: {
      value: {
        // Storage provider (s3, azure, gcs, local)
        provider: 'local',
        
        // Encryption
        encryptDocuments: true,
        
        // Retention (days)
        documentRetentionDays: 365 * 7, // 7 years (regulatory requirement)
        
        // Paths
        basePath: 'kyc-documents',
      },
      sensitivePaths: [
        'storage.encryptionKey',
      ],
    },
    
    // Notification Settings
    notifications: {
      value: {
        // Events to notify
        notifyOnVerificationStarted: true,
        notifyOnVerificationCompleted: true,
        notifyOnTierUpgrade: true,
        notifyOnExpirationWarning: true,
        notifyOnDocumentRejected: true,
        
        // Channels
        channels: ['email', 'push'],
      },
    },
    
    // Webhook Settings
    webhooks: {
      value: {
        // Internal webhooks
        enabled: true,
        events: [
          'kyc.verification.started',
          'kyc.verification.completed',
          'kyc.tier.upgraded',
          'kyc.tier.downgraded',
          'kyc.status.changed',
          'kyc.document.verified',
          'kyc.document.rejected',
          'kyc.risk.elevated',
          'kyc.expired',
          'kyc.aml.match',
        ],
      },
    },
} as const;
