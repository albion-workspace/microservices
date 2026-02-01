/**
 * Microservice scaffold generator
 *
 * Generates a new microservice folder that follows project coding standards:
 * - Dynamic config from MongoDB (getConfigWithDefault, registerServiceConfigDefaults)
 * - createServiceDatabaseAccess (per-service or core_service)
 * - GraphQL types + resolvers, permissions, createGateway
 * - Error codes (registerServiceErrorCodes), optional Redis, optional webhooks
 *
 * Usage: service-infra service --name <name> [--port 9006] [--output ../../] [--redis] [--webhooks] [--core-db]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ServiceGeneratorOptions {
  /** Service name (e.g. "test" -> test-service) */
  serviceName: string;
  /** HTTP port (default: 9006) */
  port?: number;
  /** Output directory (parent of the new service folder; default: .) */
  outputDir?: string;
  /** Include Redis accessor and configureRedisStrategy in bootstrap */
  useRedis?: boolean;
  /** Include event-dispatcher and createWebhookService (stub) */
  useWebhooks?: boolean;
  /** Use core_service database (createServiceDatabaseAccess('core-service')) like auth-service */
  useCoreDatabase?: boolean;
  /** Dry run - log paths only, do not write files */
  dryRun?: boolean;
}

function toPascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-(\w)/g, (_, c) => c.toUpperCase());
}

function toConstantPrefix(s: string): string {
  return toPascal(s.replace(/-/g, ''));
}

/** CamelCase for GraphQL export name: test -> test, my-api -> myApi (matches authGraphQLTypes, notificationGraphQLTypes) */
function toCamel(s: string): string {
  const parts = s.split('-');
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}

export async function generateService(options: ServiceGeneratorOptions): Promise<string[]> {
  const {
    serviceName: name,
    port = 9006,
    outputDir = '.',
    useRedis = true,
    useWebhooks = false,
    useCoreDatabase = false,
    dryRun = false,
  } = options;

  const serviceNameKebab = name.includes('-') ? name : `${name}-service`;
  const shortName = serviceNameKebab.replace(/-service$/, '');
  const serviceNameConst = toConstantPrefix(shortName);
  const serviceNamePascal = toPascal(shortName);
  const graphqlTypesName = toCamel(shortName) + 'GraphQLTypes'; // e.g. testGraphQLTypes, authGraphQLTypes
  const databaseName = useCoreDatabase ? 'core_service' : `${name.replace(/-/g, '_')}_service`;
  const dbAccessorName = useCoreDatabase ? 'core-service' : serviceNameKebab;

  const root = join(outputDir, serviceNameKebab);
  const src = join(root, 'src');
  const srcServices = join(src, 'services');
  const srcTypes = join(src, 'types');

  const written: string[] = [];

  async function write(path: string, content: string): Promise<void> {
    const full = join(root, path);
    written.push(full);
    if (dryRun) return;
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  // ─── package.json ─────────────────────────────────────────────────────────
  await write(
    'package.json',
    JSON.stringify(
      {
        name: serviceNameKebab,
        version: '1.0.0',
        description: `${serviceNamePascal} microservice - generated scaffold`,
        type: 'module',
        scripts: {
          start: 'node ../core-service/node_modules/tsx/dist/cli.mjs src/index.ts',
          dev: 'node ../core-service/node_modules/tsx/dist/cli.mjs watch --ignore dist --ignore node_modules src/index.ts',
          build: 'node ../core-service/node_modules/typescript/bin/tsc',
          'build:run': 'npm run build && npm start',
          test: 'node ../core-service/node_modules/tsx/dist/cli.mjs src/**/*.test.ts',
        },
        dependencies: {
          'access-engine': 'file:../access-engine',
          'core-service': 'file:../core-service',
        },
        devDependencies: {
          '@types/node': '^25.0.3',
          typescript: '^5.9.3',
        },
      },
      null,
      2
    )
  );

  // ─── tsconfig.json ───────────────────────────────────────────────────────
  await write(
    'tsconfig.json',
    `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020"],
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`
  );

  // ─── src/database.ts ─────────────────────────────────────────────────────
  await write(
    'src/database.ts',
    `/**
 * ${serviceNamePascal} Service Database Access
 *
 * Uses createServiceDatabaseAccess from core-service for consistent database access.
 * ${useCoreDatabase ? `${serviceNamePascal} uses shared core_service database.` : `Per-service database: ${databaseName}.`}
 */

import { createServiceDatabaseAccess } from 'core-service';

export const db = createServiceDatabaseAccess('${dbAccessorName}');
`
  );

  // ─── src/error-codes.ts ──────────────────────────────────────────────────
  await write(
    'src/error-codes.ts',
    `/**
 * ${serviceNamePascal} Service Error Codes
 *
 * Register with registerServiceErrorCodes; use constants with GraphQLError.
 * Prefix: MS${serviceNameConst}
 */

export const ${serviceNameConst.toUpperCase()}_ERRORS = {
  NotFound: 'MS${serviceNameConst}NotFound',
  Unauthorized: 'MS${serviceNameConst}Unauthorized',
  ValidationFailed: 'MS${serviceNameConst}ValidationFailed',
} as const;

export const ${serviceNameConst.toUpperCase()}_ERROR_CODES = Object.values(${serviceNameConst.toUpperCase()}_ERRORS) as readonly string[];

export type ${serviceNamePascal}ErrorCode = typeof ${serviceNameConst.toUpperCase()}_ERRORS[keyof typeof ${serviceNameConst.toUpperCase()}_ERRORS];
`
  );

  // ─── src/config-defaults.ts ──────────────────────────────────────────────
  await write(
    'src/config-defaults.ts',
    `/**
 * ${serviceNamePascal} Service Configuration Defaults
 *
 * Pass to registerServiceConfigDefaults('${serviceNameKebab}', ...) in index.ts.
 * Stored in core_service.service_configs; use loadConfig() in config.ts.
 * No process.env: all config via getConfigWithDefault (CODING_STANDARDS).
 */

export const ${serviceNameConst.toUpperCase()}_CONFIG_DEFAULTS = {
  port: {
    value: ${port},
    description: 'HTTP port',
  },
  serviceName: {
    value: '${serviceNameKebab}',
    description: 'Service name',
  },
  nodeEnv: {
    value: 'development',
    description: 'Node environment',
  },
  corsOrigins: {
    value: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    description: 'Allowed CORS origins',
  },
  jwt: {
    value: {
      secret: '',
      expiresIn: '1h',
      refreshSecret: '',
      refreshExpiresIn: '7d',
    },
    sensitivePaths: ['jwt.secret', 'jwt.refreshSecret'] as string[],
    description: 'JWT configuration',
  },
  database: {
    value: { mongoUri: '', redisUrl: '' },
    sensitivePaths: ['database.mongoUri', 'database.redisUrl'] as string[],
    description: 'MongoDB and Redis URLs (set via config store or deployment)',
  },
};
`
  );

  // ─── src/config.ts ───────────────────────────────────────────────────────
  await write(
    'src/config.ts',
    `/**
 * ${serviceNamePascal} Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 */

import { getConfigWithDefault } from 'core-service';
import type { ${serviceNamePascal}Config } from './types.js';

const SERVICE_NAME = '${serviceNameKebab}';

export async function loadConfig(brand?: string, tenantId?: string): Promise<${serviceNamePascal}Config> {
  const port = (await getConfigWithDefault<number>(SERVICE_NAME, 'port', { brand, tenantId })) ?? ${port};
  const serviceName = (await getConfigWithDefault<string>(SERVICE_NAME, 'serviceName', { brand, tenantId })) ?? SERVICE_NAME;
  const nodeEnv = (await getConfigWithDefault<string>(SERVICE_NAME, 'nodeEnv', { brand, tenantId })) ?? 'development';
  const corsOrigins = await getConfigWithDefault<string[]>(SERVICE_NAME, 'corsOrigins', { brand, tenantId }) ?? [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  ];
  const jwtConfig = await getConfigWithDefault<{ secret: string; expiresIn: string; refreshSecret: string; refreshExpiresIn: string }>(SERVICE_NAME, 'jwt', { brand, tenantId }) ?? {
    secret: '',
    expiresIn: '1h',
    refreshSecret: '',
    refreshExpiresIn: '7d',
  };
  const databaseConfig = await getConfigWithDefault<{ mongoUri?: string; redisUrl?: string }>(SERVICE_NAME, 'database', { brand, tenantId }) ?? { mongoUri: '', redisUrl: '' };

  return {
    port: typeof port === 'number' ? port : parseInt(String(port), 10),
    nodeEnv,
    serviceName,
    corsOrigins,
    mongoUri: databaseConfig.mongoUri || undefined,
    redisUrl: databaseConfig.redisUrl || undefined,
    jwtSecret: jwtConfig.secret || 'change-in-production',
    jwtExpiresIn: jwtConfig.expiresIn,
    jwtRefreshSecret: jwtConfig.refreshSecret,
    jwtRefreshExpiresIn: jwtConfig.refreshExpiresIn,
  };
}

export function validateConfig(config: ${serviceNamePascal}Config): void {
  if (!config.jwtSecret || config.jwtSecret === 'change-in-production') {
    console.warn('JWT secret should be set in config store for production');
  }
}

export function printConfigSummary(config: ${serviceNamePascal}Config): void {
  console.log('Config:', { port: config.port, serviceName: config.serviceName });
}
`
  );

  // ─── src/types.ts ────────────────────────────────────────────────────────
  await write(
    'src/types.ts',
    `/**
 * ${serviceNamePascal} Service shared types
 */

export interface ${serviceNamePascal}Config {
  port: number;
  nodeEnv: string;
  serviceName: string;
  corsOrigins: string[];
  mongoUri?: string;
  redisUrl?: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret?: string;
  jwtRefreshExpiresIn?: string;
}
`
  );

  // ─── src/graphql.ts ──────────────────────────────────────────────────────
  await write(
    'src/graphql.ts',
    `/**
 * GraphQL schema and resolvers for ${serviceNamePascal} Service
 *
 * Follow auth-service/notification-service pattern: types string + createResolvers(config).
 */

import type { ResolverContext } from 'core-service';
import { allow, getUserId, getTenantId } from 'core-service';
import type { ${serviceNamePascal}Config } from './types.js';

export const ${graphqlTypesName} = \`
  type ${serviceNamePascal}Health {
    status: String!
    service: String!
  }

  extend type Query {
    health: String!
    ${name}Health: ${serviceNamePascal}Health!
  }
\`;

export function create${serviceNamePascal}Resolvers(config: ${serviceNamePascal}Config) {
  return {
    Query: {
      health: () => 'ok',
      ${name}Health: () => ({
        status: 'ok',
        service: config.serviceName,
      }),
    },
    Mutation: {},
  };
}
`
  );

  // ─── src/services/index.ts ──────────────────────────────────────────────
  await write(
    'src/services/index.ts',
    `/**
 * ${serviceNamePascal} domain services
 *
 * Add service classes and repositories here; export from index.
 */

// Placeholder - add your service exports
export {};
`
  );

  // ─── src/index.ts ────────────────────────────────────────────────────────
  const redisImport = useRedis
    ? `
import { redis } from './redis.js';`
    : '';
  const redisInit = useRedis
    ? `
  if (config.redisUrl) {
    try {
      await configureRedisStrategy({ strategy: 'shared', defaultUrl: config.redisUrl });
      await redis.initialize({ brand: context.brand });
      logger.info('Redis accessor initialized', { brand: context.brand });
    } catch (err) {
      logger.warn('Could not initialize Redis accessor', { error: (err as Error).message });
    }
  }`
    : '';
  const webhookBlock = useWebhooks
    ? `
  const webhookService = createWebhookService({
    manager: ${name}Webhooks as any,
    eventsDocs: \`${serviceNamePascal} Service Webhook Events: (add events)\`,
  });`
    : '';
  const eventDispatcherImport = useWebhooks
    ? `
import { createWebhookService } from 'core-service';
import { ${name}Webhooks } from './event-dispatcher.js';`
    : '';

  const indexContent = `/**
 * ${serviceNamePascal} Service
 *
 * Generated scaffold. Uses dynamic config (MongoDB + env), createGateway, optional Redis.
 * Restart trigger: \${Date.now()}
 */

import {
  createGateway,
  logger,
  allow,
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
  ensureDefaultConfigsCreated,
  resolveContext,
  configureRedisStrategy,
  startListening,
} from 'core-service';
import { db } from './database.js';${redisImport}${eventDispatcherImport}

import { loadConfig, validateConfig, printConfigSummary } from './config.js';
import { ${serviceNameConst.toUpperCase()}_CONFIG_DEFAULTS } from './config-defaults.js';
import { ${serviceNameConst.toUpperCase()}_ERROR_CODES } from './error-codes.js';
import { ${graphqlTypesName}, create${serviceNamePascal}Resolvers } from './graphql.js';

async function main() {
  registerServiceConfigDefaults('${serviceNameKebab}', ${serviceNameConst.toUpperCase()}_CONFIG_DEFAULTS);
  const context = await resolveContext();
  const config = await loadConfig(context.brand, context.tenantId);
  validateConfig(config);
  printConfigSummary(config);

  const { database, strategy, context: defaultContext } = await db.initialize({
    brand: context.brand,
    tenantId: context.tenantId,
  });
  logger.info('Database initialized', { database: database.databaseName });

  const resolvers = create${serviceNamePascal}Resolvers(config);${webhookBlock}

  await createGateway({
    name: config.serviceName,
    port: config.port,
    cors: { origins: config.corsOrigins },
    jwt: {
      secret: config.jwtSecret,
      refreshSecret: config.jwtRefreshSecret,
      expiresIn: config.jwtExpiresIn,
      refreshExpiresIn: config.jwtRefreshExpiresIn,
    },
    services: ${useWebhooks ? `[\n      { name: '${name}', types: ${graphqlTypesName}, resolvers },\n      webhookService,\n    ]` : `[\n      { name: '${name}', types: ${graphqlTypesName}, resolvers },\n    ]`},
    permissions: {
      Query: { health: allow, ${name}Health: allow },
      Mutation: {},
    },
    mongoUri: config.mongoUri,
    redisUrl: config.redisUrl,
    defaultPermission: 'deny' as const,
  });${redisInit}

  try {
    const created = await ensureDefaultConfigsCreated('${serviceNameKebab}', { brand: context.brand, tenantId: context.tenantId });
    if (created > 0) logger.info(\`Created \${created} default config(s)\`);
  } catch (e) {
    logger.warn('ensureDefaultConfigsCreated failed', { error: (e as Error).message });
  }

  if (config.redisUrl) {
    try {
      await startListening(['integration:${name}']);
      logger.info('Started listening on integration:${name}');
    } catch (err) {
      logger.warn('Could not start event listener', { error: (err as Error).message });
    }
  }

  registerServiceErrorCodes(${serviceNameConst.toUpperCase()}_ERROR_CODES);
  logger.info('${serviceNamePascal} service started', { port: config.port });
}

main().catch((err) => {
  logger.error('Failed to start ${serviceNameKebab}', { error: err?.message, stack: err?.stack });
  process.exit(1);
});
`;
  await write('src/index.ts', indexContent);

  if (useRedis) {
    await write(
      'src/redis.ts',
      `/**
 * ${serviceNamePascal} Service Redis accessor
 *
 * Uses createServiceRedisAccess from core-service. Initialize after createGateway (configureRedisStrategy).
 */

import { createServiceRedisAccess } from 'core-service';

export const redis = createServiceRedisAccess('${serviceNameKebab}');
`
    );
  }

  if (useWebhooks) {
    await write(
      'src/event-dispatcher.ts',
      `/**
 * ${serviceNamePascal} Service webhooks and event emission
 *
 * Register with createWebhookService in index; emit events for other services.
 */

import { createWebhookManager } from 'core-service';

export const ${name}Webhooks = createWebhookManager({ serviceName: '${serviceNameKebab}' });
// export async function emit${serviceNamePascal}Event(...) { ... }
`
    );
  }

  return written;
}
