/**
 * Bonus Service Configuration
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
 * BonusConfig with service-specific settings
 */
export interface BonusConfig {
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
}

// Service name constant
const SERVICE_NAME = 'bonus-service';

/**
 * Load configuration with dynamic MongoDB config store support
 * 
 * Priority order:
 * 1. Environment variables (highest priority)
 * 2. MongoDB config store (from core_service.service_configs)
 * 3. Registered defaults (auto-created if missing)
 */
export async function loadConfig(brand?: string, tenantId?: string): Promise<BonusConfig> {
  const port = parseInt(process.env.PORT || '9003');
  
  // Load from MongoDB config store with automatic default creation
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
    serviceName: process.env.SERVICE_NAME || 'bonus-service',
    
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
  };
}

/**
 * Validate required configuration
 */
export function validateConfig(config: BonusConfig): void {
  const errors: string[] = [];
  
  if (!config.port || config.port < 1 || config.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }
  
  // Note: mongoUri validation removed - gateway handles defaults
  // See CODING_STANDARDS.md for database access patterns
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

/**
 * Print configuration summary (for debugging)
 */
export function printConfigSummary(config: BonusConfig): void {
  logger.info('Bonus Service Configuration:', {
    Port: config.port,
    MongoDB: config.mongoUri,
    Redis: config.redisUrl || 'not configured',
    CORS: config.corsOrigins.length + ' origin(s)',
  });
}
