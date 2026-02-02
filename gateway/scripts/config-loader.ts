/**
 * Configuration Loader
 * 
 * Loads the appropriate config based on mode:
 * - dev (default): services.dev.json
 * - shared: services.shared.json
 * - Or custom: services.{name}.json
 * 
 * Also loads infra.json for infrastructure settings (versions, defaults, etc.)
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

// ═══════════════════════════════════════════════════════════════════
// Infrastructure Config Types (from infra.json)
// ═══════════════════════════════════════════════════════════════════

export interface InfraVersions {
  node: string;
  mongodb: string;
  redis: string;
}

export interface InfraConfig {
  versions: InfraVersions;
  docker: {
    network: string;
    containerPrefix: string;
    registry: string | null;
    /** Compose project name - shown as group in Docker Desktop */
    projectName: string;
  };
  kubernetes: {
    namespace: string;
    imagePullPolicy: string;
  };
  healthCheck: {
    intervalSeconds: number;
    timeoutSeconds: number;
    startPeriodSeconds: number;
    retries: number;
    defaultPath: string;
  };
  defaults: {
    service: {
      healthPath: string;
      graphqlPath: string;
      entryPoint: string;
    };
    runtime: {
      dev: { nodeEnv: string; jwtSecret: string };
      prod: { nodeEnv: string; jwtSecret: string };
    };
    mongodb: {
      port: number;
      replicaSet: string;
    };
    redis: {
      port: number;
      sentinelPort: number;
      masterName: string;
    };
  };
  security: {
    runAsUser: number;
    runAsGroup: number;
    fsGroup: number;
  };
}

// Cached infra config (loaded once per mode)
let _infraConfig: InfraConfig | null = null;
let _infraConfigMode: string | null = null;

/**
 * Deep merge two objects (target overrides base)
 */
function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideValue = override[key];
    if (overrideValue !== undefined) {
      if (
        typeof overrideValue === 'object' &&
        overrideValue !== null &&
        !Array.isArray(overrideValue) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        // Deep merge nested objects
        result[key] = deepMerge(result[key] as Record<string, any>, overrideValue as Record<string, any>) as T[keyof T];
      } else {
        // Override primitive or array
        result[key] = overrideValue as T[keyof T];
      }
    }
  }
  return result;
}

/**
 * Load infrastructure config. Base: infra.json. Overrides: infra.{mode}.json when present.
 */
export async function loadInfraConfig(mode: ConfigMode = 'dev'): Promise<InfraConfig> {
  // Return cached if same mode
  if (_infraConfig && _infraConfigMode === mode) return _infraConfig;
  
  // Load base infra.json (required)
  const basePath = join(CONFIGS_DIR, 'infra.json');
  const baseContent = await readFile(basePath, 'utf-8');
  const baseConfig: InfraConfig = JSON.parse(baseContent);
  
  const modePath = join(CONFIGS_DIR, `infra.${mode}.json`);
  try {
    const modeContent = await readFile(modePath, 'utf-8');
    const modeOverride: Partial<InfraConfig> = JSON.parse(modeContent);
    _infraConfig = deepMerge(baseConfig, modeOverride);
  } catch {
    _infraConfig = baseConfig;
  }
  
  _infraConfigMode = mode;
  return _infraConfig;
}

/**
 * Get infra config synchronously (must call loadInfraConfig first)
 */
export function getInfraConfig(): InfraConfig {
  if (!_infraConfig) {
    throw new Error('InfraConfig not loaded. Call loadInfraConfig() first.');
  }
  return _infraConfig;
}

/** Current config mode (set by loadConfigFromArgs). Used by k8s/generate to pass --config. */
export function getConfigMode(): ConfigMode {
  return (_infraConfigMode as ConfigMode) ?? 'dev';
}

/** Docker container names from infra.docker.projectName only. */
export function getDockerContainerNames(infra: InfraConfig): { mongo: string; redis: string } {
  const { projectName } = infra.docker;
  return {
    mongo: `${projectName}-mongo`,
    redis: `${projectName}-redis`,
  };
}

/** Mongo Docker container name: single = project-mongo, replica set = project-primaryHost (e.g. shared-mongo-primary). */
export function getMongoDockerContainerName(infra: InfraConfig, config: ServicesConfig): string {
  const mongo = config.infrastructure.mongodb;
  const { projectName } = infra.docker;
  if (mongo.mode === 'replicaSet' && mongo.members?.length) {
    const primaryHost = mongo.members[0].host.split('.')[0] ?? 'mongo-primary';
    return `${projectName}-${primaryHost}`;
  }
  return `${projectName}-mongo`;
}

/**
 * Internal/container ports for MongoDB and Redis (single source of truth from infra.defaults).
 * Use for: Docker compose service env (MONGO_URI, REDIS_URL), K8s secrets, K8s containerPort/targetPort.
 * Host binding ports come from services.*.json infrastructure.mongodb.port / redis.port.
 */
export function getInternalPorts(infra: InfraConfig): { mongoPort: number; redisPort: number } {
  return {
    mongoPort: infra.defaults.mongodb.port,
    redisPort: infra.defaults.redis.port,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Services Config Types
// ═══════════════════════════════════════════════════════════════════

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
  password?: string;
  sentinel: {
    name: string;
    hosts: Array<{ host: string; port: number }>;
    /** Docker host port for first sentinel (default 26380). Others use base+1, base+2 so stacks don't conflict. */
    hostPortBase?: number;
  } | null;
}

/** Combo mode: reuse infra/services from another namespace (e.g. test uses ms Redis + auth). Avoids "shared" which is already used for per-service vs shared strategy. */
export interface ReuseFromConfig {
  /** K8s namespace to reuse from (e.g. "microservices") */
  namespace: string;
  /** Docker Compose project name to reuse from (e.g. "ms") */
  project: string;
  /** Docker network name in provider's compose (e.g. "ms_network"). Full name is {project}_{network}. */
  network?: string;
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
    /** Optional: JWT secret for this environment (single secret; can be shared or per-service via config store) */
    jwtSecret?: string;
  }>;
  /** Combo only: which namespace/project to reuse Redis/Mongo and optionally services from */
  reuseFrom?: ReuseFromConfig;
  /** Combo only: reuse Redis and/or MongoDB from reuseFrom (do not deploy in this namespace) */
  reuseInfra?: { redis?: boolean; mongodb?: boolean };
  /**
   * Combo only: which services to reuse and from where. Key = "provider:serviceName" (e.g. "ms:auth"), value = port.
   * Slim and intuitive: one map encodes provider, service, and port. Reused service names derived from keys.
   */
  reuseServicePorts?: Record<string, number>;
}

/** Parsed entry from reuseServicePorts (key "provider:serviceName", value port). */
export interface ReusedServiceEntry {
  project: string;
  serviceName: string;
  port: number;
}

/**
 * Parse reuseServicePorts into entries. Key format: "provider:serviceName" (e.g. "ms:auth").
 * Returns list of { project, serviceName, port }. Invalid keys (no colon) are skipped.
 */
export function getReusedServiceEntries(config: ServicesConfig): ReusedServiceEntry[] {
  const out: ReusedServiceEntry[] = [];
  for (const [key, port] of Object.entries(config.reuseServicePorts ?? {})) {
    const colon = key.indexOf(':');
    if (colon === -1) continue;
    out.push({
      project: key.slice(0, colon),
      serviceName: key.slice(colon + 1),
      port,
    });
  }
  return out;
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
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load configuration based on CLI args
 */
export async function loadConfigFromArgs(): Promise<{ config: ServicesConfig; mode: ConfigMode; infra: InfraConfig }> {
  const mode = parseConfigMode();
  const [config, infra] = await Promise.all([loadConfig(mode), loadInfraConfig(mode)]);
  return { config, mode, infra };
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
  
  // Build Redis URL with optional password
  const redis = config.infrastructure.redis;
  const redisAuth = redis.password ? `:${redis.password}@` : '';
  return `redis://${redisAuth}${redis.host}:${redis.port}`;
}

/**
 * Get JWT secret for a config environment (Docker/K8s runtime).
 * Uses config.environments[env].jwtSecret when set, else infra.defaults.runtime.dev|prod.jwtSecret.
 */
export function getJwtSecret(config: ServicesConfig, env: string = 'docker'): string {
  const envConfig = config.environments[env];
  if (envConfig?.jwtSecret) {
    return envConfig.jwtSecret;
  }
  const infra = getInfraConfig();
  const runtime = env === 'prod' ? infra.defaults.runtime.prod : infra.defaults.runtime.dev;
  return runtime.jwtSecret;
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
