/**
 * Microservice scaffold generator
 *
 * Single source of truth for generic microservice structure. Emitted files use
 * ONLY getServiceConfigKey / getConfigWithDefault and the config object—no process.env. Exception:
 * core-service itself or auth-service when using core DB may need process.env
 * for bootstrap/strategy resolution (outside this generator; generator never emits process.env).
 *
 * - Dynamic config from MongoDB (getServiceConfigKey with fallbackService, registerServiceConfigDefaults)
 * - Per-service/per-brand DB init: createServiceDatabaseAccess, createServiceRedisAccess;
 *   db.initialize({ brand, tenantId }), redis.initialize({ brand }) after resolveContext/loadConfig
 * - Config: getServiceConfigKey(serviceName, key, defaultVal, { fallbackService: 'gateway' }) for common keys;
 *   service-only keys use getServiceConfigKey(..., { brand, tenantId }) (no fallback).
 * - GraphQL types + resolvers, permissions, createGateway
 * - SDL helpers: timestampFieldsSDL, buildSagaResultTypeSDL, buildConnectionTypeSDL, paginationArgsSDL
 * - Error codes (registerServiceErrorCodes); resolver path must throw GraphQLError(SERVICE_ERRORS.*), not Error
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
    'src/accessors.ts',
    `/**
 * ${serviceNamePascal} service accessors (db + redis) from one factory call.
 * ${useCoreDatabase ? `Uses core_service database.` : `Per-service database: ${databaseName}.`}
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('${serviceNameKebab}'${useCoreDatabase ? ", { databaseServiceName: 'core-service' }" : ''});
`
  );

  // ─── src/error-codes.ts ──────────────────────────────────────────────────
  await write(
    'src/error-codes.ts',
    `/**
 * ${serviceNamePascal} Service Error Codes
 *
 * Register with registerServiceErrorCodes. In resolver-path code (resolvers, saga steps,
 * services called from resolvers), throw GraphQLError with these codes only; do not use
 * throw new Error('message'). See CODING_STANDARDS § Resolver error handling.
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
 * Typed as Record<string, DefaultConfigEntry> (core-service). Pass to registerServiceConfigDefaults('${serviceNameKebab}', ...) in index.ts.
 * Stored in core_service.service_configs. loadBaseServiceConfig + getServiceConfigKey use these keys; common keys fallback to gateway.
 * No process.env (CODING_STANDARDS).
 */

import type { DefaultConfigEntry } from 'core-service';

export const ${serviceNameConst.toUpperCase()}_CONFIG_DEFAULTS: Record<string, DefaultConfigEntry> = {
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
 * Base keys via loadBaseServiceConfig + getBaseServiceConfigDefaults; service-only keys with getServiceConfigKey + configKeyOpts.
 */

import { loadBaseServiceConfig, getBaseServiceConfigDefaults } from 'core-service';
import type { ${serviceNamePascal}Config } from './types.js';

export const SERVICE_NAME = '${serviceNameKebab}';

export async function loadConfig(brand?: string, tenantId?: string): Promise<${serviceNamePascal}Config> {
  return loadBaseServiceConfig(SERVICE_NAME, getBaseServiceConfigDefaults({ port: ${port}, serviceName: SERVICE_NAME }), { brand, tenantId });
}

export function validateConfig(config: ${serviceNamePascal}Config): void {
  if (!config.jwtSecret || config.jwtSecret === 'shared-jwt-secret-change-in-production') {
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
 * Config extends DefaultServiceConfig (common props from core-service); add only service-specific props here.
 */

import type { DefaultServiceConfig } from 'core-service';

export interface ${serviceNamePascal}Config extends DefaultServiceConfig {}
`
  );

  // ─── src/graphql.ts ──────────────────────────────────────────────────────
  await write(
    'src/graphql.ts',
    `/**
 * GraphQL schema and resolvers for ${serviceNamePascal} Service
 *
 * Follow auth-service/notification-service pattern: types string + createResolvers(config).
 * Resolver errors: throw GraphQLError(SERVICE_ERRORS.*, { ... }) only; never throw new Error('message').
 *
 * REUSABLE SDL HELPERS (from core-service – single source of truth, see CODING_STANDARDS § GraphQL):
 *   timestampFieldsSDL()         → createdAt: String!  updatedAt: String   (default)
 *   timestampFieldsRequiredSDL() → createdAt: String!  updatedAt: String!  (User, Config, Webhook)
 *   timestampFieldsOptionalSDL() → createdAt: String   updatedAt: String   (KYC, Bonus)
 *   buildSagaResultTypeSDL(name, field, type, extra?) → type XResult { success … sagaId … }
 *   paginationArgsSDL()          → first: Int, after: String, last: Int, before: String
 *   buildConnectionTypeSDL(conn, node) → type XConnection { nodes … totalCount … pageInfo … }
 *
 * Example usage in SDL template literals:
 *   type Item { id: ID! name: String! \${timestampFieldsSDL()} }
 *   \${buildSagaResultTypeSDL('CreateItemResult', 'item', 'Item')}
 *   \${buildConnectionTypeSDL('ItemConnection', 'Item')}
 *   extend type Query { items(\${paginationArgsSDL()}): ItemConnection! }
 */

import type { ResolverContext } from 'core-service';
import {
  allow,
  getUserId,
  getTenantId,
  // SDL helpers – use these instead of writing inline SDL (single source of truth):
  buildConnectionTypeSDL,
  timestampFieldsSDL,
  timestampFieldsRequiredSDL,
  timestampFieldsOptionalSDL,
  buildSagaResultTypeSDL,
  paginationArgsSDL,
} from 'core-service';
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
 * Add createService definitions here; export from index.
 *
 * REUSABLE PATTERNS (from core-service – avoid reinventing, see CODING_STANDARDS):
 *   In saga steps and resolvers: throw GraphQLError(SERVICE_ERRORS.*, { ... }), never throw new Error('message').
 *   createService<Entity, Input>({ name, entity, saga, ... })  → saga-based CRUD service
 *   buildSagaResultTypeSDL(name, field, type, extra?)           → saga result SDL (in graphql.ts)
 *   buildConnectionTypeSDL(connectionName, nodeType)            → connection type SDL (in graphql.ts)
 *   timestampFieldsSDL() / Required / Optional                  → timestamp fields SDL (in graphql.ts)
 *   paginationArgsSDL()                                         → cursor pagination args (in graphql.ts)
 *   withEventHandlerError(errorCode, handler)                   → event handler error wrapper
 *   createUniqueIndexSafe(collection, key, options)             → safe unique index creation
 *   getErrorMessage(error)                                      → consistent error string extraction
 *   normalizeWalletForGraphQL(wallet)                           → wallet null-coalescing (payment only)
 *   paginateCollection(collection, opts)                        → cursor-based pagination
 *
 * See existing services (auth, payment, bonus, kyc, notification) for real examples.
 */

// Placeholder - add your service exports
export {};
`
  );

  // ─── src/index.ts ────────────────────────────────────────────────────────
  const accessorsImport = `
import { db, redis } from './accessors.js';`;
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

  const withRedisBlock = useRedis
    ? `
  await withRedis(config.redisUrl, redis, { brand: context.brand }, {
    afterReady: async () => {
      await startListening(['integration:${name}']);
      logger.info('Started listening on integration:${name}');
    },
  });`
    : '';

  const indexContent = `/**
 * ${serviceNamePascal} Service
 *
 * Generated scaffold. Aligned with CODING_STANDARDS: loadBaseServiceConfig, buildDefaultGatewayConfig, ensureServiceDefaultConfigsCreated, withRedis.
 * Restart trigger: \${Date.now()}
 */

import {
  createGateway,
  logger,
  allow,
  registerServiceErrorCodes,
  registerServiceConfigDefaults,
  resolveContext,
  buildDefaultGatewayConfig,
  ensureServiceDefaultConfigsCreated,
  withRedis,
  startListening,
} from 'core-service';
${accessorsImport}${eventDispatcherImport}

import { loadConfig, validateConfig, printConfigSummary, SERVICE_NAME } from './config.js';
import type { ${serviceNamePascal}Config } from './types.js';
import { ${serviceNameConst.toUpperCase()}_CONFIG_DEFAULTS } from './config-defaults.js';
import { ${serviceNameConst.toUpperCase()}_ERROR_CODES } from './error-codes.js';
import { ${graphqlTypesName}, create${serviceNamePascal}Resolvers } from './graphql.js';

function buildGatewayConfig(
  config: ${serviceNamePascal}Config,
  resolvers: ReturnType<typeof create${serviceNamePascal}Resolvers>${useWebhooks ? ',\n  webhookService: ReturnType<typeof createWebhookService>' : ''}
) {
  return buildDefaultGatewayConfig(config, {
    services: ${useWebhooks ? `[\n      { name: '${name}', types: ${graphqlTypesName}, resolvers },\n      webhookService,\n    ]` : `[\n      { name: '${name}', types: ${graphqlTypesName}, resolvers },\n    ]`},
    permissions: {
      Query: { health: allow, ${name}Health: allow },
      Mutation: {},
    },
    name: config.serviceName,
  });
}

async function main() {
  registerServiceConfigDefaults(SERVICE_NAME, ${serviceNameConst.toUpperCase()}_CONFIG_DEFAULTS);
  const context = await resolveContext();
  const config = await loadConfig(context.brand, context.tenantId);
  validateConfig(config);
  printConfigSummary(config);

  const { database } = await db.initialize({
    brand: context.brand,
    tenantId: context.tenantId,
  });
  logger.info('Database initialized', { database: database.databaseName });

  const resolvers = create${serviceNamePascal}Resolvers(config);${webhookBlock}

  await createGateway(buildGatewayConfig(config, resolvers${useWebhooks ? ', webhookService' : ''}));
  await ensureServiceDefaultConfigsCreated(SERVICE_NAME, { brand: context.brand, tenantId: context.tenantId });${withRedisBlock}

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
