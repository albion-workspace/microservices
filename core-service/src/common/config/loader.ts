/**
 * Unified Configuration Management
 * 
 * Supports multiple configuration sources:
 * - JSON files (local or remote URL)
 * - Environment variables (for k8s/docker)
 * - API endpoints (for dynamic config)
 * - MongoDB config store (dynamic, permission-aware)
 * - Hierarchical config (base + brand-specific overrides)
 * 
 * Best Practice: Use single source of truth per deployment
 * - Development: JSON file
 * - Docker: Environment variables
 * - Kubernetes: ConfigMap/Secrets (via env vars)
 * - Production: MongoDB config store (dynamic, multi-brand)
 * 
 * Priority order (lowest to highest):
 * 1. Base config file
 * 2. Brand-specific config file
 * 3. Environment-specific config file
 * 4. MongoDB config store (if configStore provided)
 * 5. Remote config URL/API
 * 6. Environment variables (highest priority - overrides everything)
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from '../logger.js';
import path from 'path';
import type { ConfigStore } from './store.js';

export interface ConfigLoaderOptions {
  /** Service name (e.g., 'auth-service', 'payment-service') */
  serviceName: string;
  /** Base config file path (relative to service root or absolute) */
  configFile?: string;
  /** Remote config URL (API endpoint or JSON file URL) */
  configUrl?: string;
  /** MongoDB config store instance (for dynamic config) */
  configStore?: ConfigStore;
  /** Tenant ID for tenant-specific configs */
  tenantId?: string;
  /** Brand identifier for brand-specific configs */
  brand?: string;
  /** Environment (development, staging, production) - Note: handled via database selection, not field */
  environment?: string;
  /** Whether to use environment variables (default: true) */
  useEnvVars?: boolean;
  /** Config validation function */
  validate?: (config: any) => { valid: boolean; errors?: string[] };
}

export interface ConfigSource {
  type: 'file' | 'url' | 'env' | 'api';
  path?: string;
  url?: string;
  priority: number; // Higher priority = loaded later (overrides previous)
}

/**
 * Load configuration from multiple sources with priority
 * 
 * Priority order (lowest to highest):
 * 1. Base config file
 * 2. Brand-specific config file
 * 3. Environment-specific config file
 * 4. MongoDB config store (if configStore provided)
 * 5. Remote config URL/API
 * 6. Environment variables (highest priority - overrides everything)
 * 
 * @example
 * // Development: Load from JSON file
 * const config = await loadConfig({
 *   serviceName: 'auth-service',
 *   configFile: './config/default.json',
 *   environment: 'development',
 * });
 * 
 * @example
 * // Docker/K8s: Use environment variables only
 * const config = await loadConfig({
 *   serviceName: 'auth-service',
 *   useEnvVars: true,
 *   environment: process.env.NODE_ENV,
 * });
 * 
 * @example
 * // Production: Load from MongoDB config store (dynamic, multi-brand)
 * const configStore = createConfigStore();
 * const config = await loadConfig({
 *   serviceName: 'auth-service',
 *   configStore,
 *   brand: process.env.BRAND_ID,
 *   tenantId: process.env.TENANT_ID,
 * });
 * 
 * @example
 * // Hybrid: MongoDB + env vars (env vars override MongoDB)
 * const configStore = createConfigStore();
 * const config = await loadConfig({
 *   serviceName: 'auth-service',
 *   configStore,
 *   configFile: './config/default.json', // Fallback
 *   useEnvVars: true, // Env vars override everything
 *   brand: process.env.BRAND_ID,
 * });
 */
export async function loadConfig<T = Record<string, unknown>>(
  options: ConfigLoaderOptions
): Promise<T> {
  const {
    serviceName,
    configFile,
    configUrl,
    configStore,
    tenantId,
    brand,
    environment = process.env.NODE_ENV || 'development',
    useEnvVars = true,
    validate,
  } = options;

  let mergedConfig: Record<string, unknown> = {};

  // 1. Load base config file (if exists)
  if (configFile) {
    try {
      const baseConfig = await loadConfigFile(configFile);
      mergedConfig = { ...mergedConfig, ...baseConfig };
      logger.debug('Loaded base config file', { serviceName, configFile });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to load base config file', { 
          serviceName, 
          configFile, 
          error: error.message 
        });
      }
    }
  }

  // 2. Load brand-specific config (if brand specified)
  if (brand && configFile) {
    const brandConfigPath = configFile.replace('.json', `.${brand}.json`);
    try {
      const brandConfig = await loadConfigFile(brandConfigPath);
      mergedConfig = { ...mergedConfig, ...brandConfig };
      logger.debug('Loaded brand-specific config', { serviceName, brand, brandConfigPath });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to load brand config', { 
          serviceName, 
          brand, 
          error: error.message 
        });
      }
    }
  }

  // 3. Load environment-specific config (if environment specified)
  if (environment && configFile) {
    const envConfigPath = configFile.replace('.json', `.${environment}.json`);
    try {
      const envConfig = await loadConfigFile(envConfigPath);
      mergedConfig = { ...mergedConfig, ...envConfig };
      logger.debug('Loaded environment-specific config', { serviceName, environment, envConfigPath });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to load environment config', { 
          serviceName, 
          environment, 
          error: error.message 
        });
      }
    }
  }

  // 4. Load from MongoDB config store (if provided)
  // Note: Environment is handled via database selection, not field
  if (configStore) {
    try {
      const dbConfig = await configStore.getAll(serviceName, {
        brand,
        tenantId,
        includeSensitive: true, // Service can access its own sensitive configs
      });
      mergedConfig = { ...mergedConfig, ...dbConfig };
      logger.debug('Loaded MongoDB config store', { serviceName, brand, tenantId });
    } catch (error: any) {
      logger.warn('Failed to load MongoDB config store', { 
        serviceName, 
        brand, 
        tenantId,
        error: error.message 
      });
      // Don't throw - allow fallback to other sources
    }
  }

  // 5. Load remote config (API or URL)
  if (configUrl) {
    try {
      const remoteConfig = await loadConfigFromUrl(configUrl);
      mergedConfig = { ...mergedConfig, ...remoteConfig };
      logger.debug('Loaded remote config', { serviceName, configUrl });
    } catch (error: any) {
      logger.warn('Failed to load remote config', { 
        serviceName, 
        configUrl, 
        error: error.message 
      });
      // Don't throw - allow fallback to other sources
    }
  }

  // 6. Override with environment variables (highest priority)
  if (useEnvVars) {
    const envConfig = loadConfigFromEnv(serviceName);
    mergedConfig = { ...mergedConfig, ...envConfig };
    logger.debug('Applied environment variable overrides', { serviceName });
  }

  // Validate if validator provided
  if (validate) {
    const validation = validate(mergedConfig);
    if (!validation.valid) {
      throw new Error(`Config validation failed: ${validation.errors?.join(', ')}`);
    }
  }

  return mergedConfig as T;
}

/**
 * Load config from JSON file
 */
async function loadConfigFile(filePath: string): Promise<Record<string, unknown>> {
  // Resolve path (support both relative and absolute)
  const resolvedPath = path.isAbsolute(filePath) 
    ? filePath 
    : path.resolve(process.cwd(), filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const content = await readFile(resolvedPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load config from remote URL (API endpoint or JSON file)
 */
async function loadConfigFromUrl(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'core-service-config-loader',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch config from ${url}: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json as Record<string, unknown>;
}

/**
 * Load config from environment variables
 * Converts env vars to config object using naming convention:
 * - SERVICE_NAME_CONFIG_KEY -> configKey
 * - SERVICE_NAME_CONFIG_KEY__NESTED__KEY -> configKey.nested.key
 * 
 * @example
 * AUTH_SERVICE_PORT=9001 -> { port: 9001 }
 * AUTH_SERVICE_DB__HOST=localhost -> { db: { host: 'localhost' } }
 */
function loadConfigFromEnv(serviceName: string): Record<string, unknown> {
  const prefix = serviceName.toUpperCase().replace(/-/g, '_');
  const config: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix + '_')) continue;

    // Remove prefix and convert to camelCase path
    const configKey = key
      .slice(prefix.length + 1) // Remove prefix and underscore
      .toLowerCase()
      .split('__') // Support nested keys via double underscore
      .map((part, idx) => 
        idx === 0 
          ? part // First part stays lowercase
          : part.charAt(0).toUpperCase() + part.slice(1) // CamelCase for nested
      );

    // Set nested value
    let current: Record<string, unknown> = config;
    for (let i = 0; i < configKey.length - 1; i++) {
      const part = configKey[i];
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[configKey[configKey.length - 1]] = parseEnvValue(value || '');
  }

  return config;
}

/**
 * Parse environment variable value (handle booleans, numbers, JSON)
 */
function parseEnvValue(value: string): unknown {
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return parseFloat(value);

  // JSON
  if ((value.startsWith('{') && value.endsWith('}')) || 
      (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch {
      // Not valid JSON, return as string
    }
  }

  // String (default)
  return value;
}

/**
 * Create a config loader for a specific service
 * Returns a function that loads config with service-specific defaults
 * 
 * @example
 * const loadAuthConfig = createConfigLoader({
 *   serviceName: 'auth-service',
 *   configFile: './config/default.json',
 *   validate: (config) => {
 *     const errors: string[] = [];
 *     if (!config.port) errors.push('port is required');
 *     return { valid: errors.length === 0, errors };
 *   },
 * });
 * 
 * const config = await loadAuthConfig({ brand: 'brand1', environment: 'production' });
 */
export function createConfigLoader<T = Record<string, unknown>>(
  defaults: Omit<ConfigLoaderOptions, 'serviceName'>
) {
  return async (overrides: Partial<ConfigLoaderOptions> = {}): Promise<T> => {
    return loadConfig<T>({
      ...defaults,
      ...overrides,
    } as ConfigLoaderOptions);
  };
}
