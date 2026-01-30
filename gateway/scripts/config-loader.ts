/**
 * Configuration Loader
 * 
 * Loads the appropriate config based on mode:
 * - dev (default): services.dev.json
 * - shared: services.shared.json
 * - Or custom: services.{name}.json
 * 
 * Usage:
 *   --config=dev      # Load services.dev.json
 *   --config=shared   # Load services.shared.json
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIGS_DIR = join(__dirname, '..', 'configs');

export interface ServiceConfig {
  name: string;
  host: string;
  port: number;
  database: string;
  healthPath: string;
  graphqlPath: string;
  replicas?: number;
}

export interface MongoConfig {
  mode: 'single' | 'replicaSet';
  host: string;
  port: number;
  replicaSet: string | null;
  members?: Array<{ host: string; port: number; priority?: number }>;
}

export interface RedisConfig {
  mode: 'single' | 'sentinel';
  host: string;
  port: number;
  sentinel: {
    name: string;
    hosts: Array<{ host: string; port: number }>;
  } | null;
}

export interface ServicesConfig {
  mode: string;
  description?: string;
  gateway: {
    port: number;
    defaultService: string;
    rateLimit: number;
  };
  services: ServiceConfig[];
  infrastructure: {
    mongodb: MongoConfig;
    redis: RedisConfig;
  };
  environments: Record<string, {
    mongoUri: string;
    redisUrl: string;
  }>;
}

export type ConfigMode = 'dev' | 'shared' | string;

/**
 * Parse --config argument from process.argv
 */
export function parseConfigMode(args: string[] = process.argv.slice(2)): ConfigMode {
  for (const arg of args) {
    if (arg.startsWith('--config=')) {
      return arg.split('=')[1];
    }
  }
  return 'dev'; // Default
}

/**
 * Get config file path for a given mode
 */
export function getConfigPath(mode: ConfigMode): string {
  return join(CONFIGS_DIR, `services.${mode}.json`);
}

/**
 * Load configuration for a given mode
 */
export async function loadConfig(mode: ConfigMode = 'dev'): Promise<ServicesConfig> {
  const configPath = getConfigPath(mode);
  
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    // Fallback to legacy services.json if mode-specific doesn't exist
    const legacyPath = join(CONFIGS_DIR, 'services.json');
    try {
      const content = await readFile(legacyPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      throw new Error(`Config not found: ${configPath}`);
    }
  }
}

/**
 * Load configuration based on CLI args
 */
export async function loadConfigFromArgs(): Promise<{ config: ServicesConfig; mode: ConfigMode }> {
  const mode = parseConfigMode();
  const config = await loadConfig(mode);
  return { config, mode };
}

/**
 * Get MongoDB connection string for a config
 */
export function getMongoUri(config: ServicesConfig, env: string = 'local'): string {
  const envConfig = config.environments[env];
  if (envConfig) {
    return envConfig.mongoUri;
  }
  
  // Build from infrastructure config
  const mongo = config.infrastructure.mongodb;
  if (mongo.mode === 'replicaSet' && mongo.members) {
    const hosts = mongo.members.map(m => `${m.host}:${m.port}`).join(',');
    return `mongodb://${hosts}/?replicaSet=${mongo.replicaSet}`;
  }
  return `mongodb://${mongo.host}:${mongo.port}`;
}

/**
 * Get Redis connection string for a config
 */
export function getRedisUrl(config: ServicesConfig, env: string = 'local'): string {
  const envConfig = config.environments[env];
  if (envConfig) {
    return envConfig.redisUrl;
  }
  
  return `redis://${config.infrastructure.redis.host}:${config.infrastructure.redis.port}`;
}

/**
 * Log config summary
 */
export function logConfigSummary(config: ServicesConfig, mode: ConfigMode): void {
  console.log(`📋 Config: ${mode} (${config.description || config.mode})`);
  console.log(`   Gateway port: ${config.gateway.port}`);
  console.log(`   Services: ${config.services.length}`);
  console.log(`   MongoDB: ${config.infrastructure.mongodb.mode}`);
  console.log(`   Redis: ${config.infrastructure.redis.mode}`);
}
