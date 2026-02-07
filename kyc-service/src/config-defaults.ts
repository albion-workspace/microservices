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
    value: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
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
  providers: {
    value: {
      defaultProvider: 'mock',
      providers: {
        mock: { enabled: true, apiUrl: '', apiKey: '' },
        onfido: { enabled: false, apiUrl: 'https://api.onfido.com/v3.6', apiKey: '', webhookSecret: '' },
        sumsub: { enabled: false, apiUrl: 'https://api.sumsub.com', apiKey: '', apiSecret: '', webhookSecret: '' },
      },
    },
    sensitivePaths: [
      'providers.onfido.apiKey', 'providers.onfido.webhookSecret',
      'providers.sumsub.apiKey', 'providers.sumsub.apiSecret', 'providers.sumsub.webhookSecret',
    ],
  },
  verification: {
    value: {
      sessionExpiryMinutes: 60,
      allowAutoApproval: true,
      autoApprovalMinConfidence: 90,
      maxRetryAttempts: 3,
      retryWaitDays: 1,
      maxDocumentSizeMB: 10,
      acceptedFileTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      livenessRequired: true,
      livenessLevel: 'enhanced',
      faceMatchRequired: true,
      faceMatchThreshold: 80,
    },
  },
  compliance: {
    value: {
      amlCheckRequired: true,
      amlPeriodicCheckIntervalDays: 90,
      pepScreeningRequired: true,
      pepScreeningIntervalDays: 180,
      sanctionCheckRequired: true,
      sanctionLists: ['OFAC', 'EU', 'UN', 'UK'],
      sourceOfFundsThreshold: 10000,
      sourceOfFundsCurrency: 'EUR',
      eddCountries: ['AF', 'BY', 'MM', 'CF', 'CD', 'IR', 'IQ', 'LB', 'LY', 'ML', 'NI', 'KP', 'PK', 'RU', 'SO', 'SS', 'SD', 'SY', 'VE', 'YE', 'ZW'],
      blockedCountries: ['KP', 'IR', 'SY', 'CU'],
    },
  },
  risk: {
    value: {
      baseScore: 20,
      lowRiskThreshold: 25,
      mediumRiskThreshold: 50,
      highRiskThreshold: 75,
      autoSuspendOnCriticalRisk: true,
      manualReviewOnHighRisk: true,
      periodicAssessmentIntervalDays: 365,
    },
  },
  expiration: {
    value: {
      tierExpiry: {
        none: null,
        basic: null,
        standard: 365 * 2,
        enhanced: 365,
        full: 365,
        professional: 365,
      },
      documentExpiryWarningDays: 30,
      reVerificationGracePeriodDays: 30,
      autoDowngradeOnExpiry: true,
      downgradeToTier: 'basic',
    },
  },
  storage: {
    value: {
      provider: 'local',
      encryptDocuments: true,
      documentRetentionDays: 365 * 7,
      basePath: 'kyc-documents',
    },
    sensitivePaths: ['storage.encryptionKey'],
  },
  notifications: {
    value: {
      notifyOnVerificationStarted: true,
      notifyOnVerificationCompleted: true,
      notifyOnTierUpgrade: true,
      notifyOnExpirationWarning: true,
      notifyOnDocumentRejected: true,
      channels: ['email', 'push'],
    },
  },
  webhooks: {
    value: {
      enabled: true,
      events: [
        'kyc.verification.started', 'kyc.verification.completed', 'kyc.tier.upgraded', 'kyc.tier.downgraded',
        'kyc.status.changed', 'kyc.document.verified', 'kyc.document.rejected', 'kyc.risk.elevated',
        'kyc.expired', 'kyc.aml.match',
      ],
    },
  },
} as const;
