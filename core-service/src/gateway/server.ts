/**
 * Unified Gateway - GraphQL over HTTP + SSE + Socket.IO
 * 
 * Transport Strategy:
 * - graphql-http: Standard HTTP queries/mutations (spec-compliant)
 * - graphql-sse: SSE subscriptions (spec-compliant, works everywhere)
 * - Socket.IO: Bidirectional real-time (WebSocket with HTTP fallback)
 * 
 * Endpoints:
 * - POST /graphql - Queries & Mutations (graphql-http)
 * - GET/POST /graphql/stream - Subscriptions via SSE (graphql-sse)
 * - Socket.IO /socket.io - Bidirectional real-time (auto-fallback to polling)
 * - GET /health - Unified health check (liveness, readiness, metrics)
 * 
 * Socket.IO Benefits:
 * - ES5 browser support
 * - Automatic reconnection
 * - Fallback to HTTP long-polling
 * - Rooms & namespaces
 * - Bidirectional communication
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { 
  GraphQLSchema, 
  GraphQLObjectType, 
  GraphQLString, 
  GraphQLFloat, 
  GraphQLBoolean, 
  GraphQLInt,
  GraphQLList,
  GraphQLScalarType,
  GraphQLInputObjectType,
  GraphQLNonNull,
  Kind,
  execute,
  subscribe,
  buildSchema as buildGraphQLSchema,
  buildASTSchema,
  parse,
  DocumentNode,
  extendSchema,
} from 'graphql';
import { createHandler as createHttpHandler } from 'graphql-http/lib/use/http';
import { createHandler as createSSEHandler } from 'graphql-sse/lib/use/http';
import type { UserContext, PermissionRule, Resolvers, ResolverContext, JwtConfig, SubscriptionResolver } from '../types/index.js';
import type { DefaultServiceConfig } from '../types/config.js';
import { extractToken, verifyToken, createToken } from '../common/auth/jwt.js';
import { connectDatabase, checkDatabaseHealth } from '../databases/mongodb/connection.js';
import { connectRedis, checkRedisHealth, getRedis } from '../databases/redis/connection.js';
import { getCacheStats } from '../databases/cache.js';
import { logger, subscribeToLogs, type LogEntry, setCorrelationId, generateCorrelationId, getCorrelationId } from '../common/logger.js';
import { createResolverBuilder, type ServiceResolvers } from '../common/graphql/builder.js';
import { formatGraphQLError, getAllErrorCodes, getErrorMessage } from '../common/errors.js';
import { configGraphQLTypes, configResolvers } from '../common/config/graphql.js';
import { 
  createComplexityConfig, 
  analyzeQueryComplexity,
  type ComplexityConfig,
} from '../common/graphql/complexity.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface ServiceModule {
  name: string;
  types: string;
  resolvers: Resolvers;
}

export type GatewayPermissionRule = PermissionRule;

export interface GatewayPermissions {
  Query?: Record<string, GatewayPermissionRule>;
  Mutation?: Record<string, GatewayPermissionRule>;
  Subscription?: Record<string, GatewayPermissionRule>;
}

export interface SubscriptionConfig {
  [key: string]: SubscriptionResolver;
}

export interface GatewayConfig {
  name: string;
  port: number;
  jwt: JwtConfig;
  services: ServiceModule[];
  permissions?: GatewayPermissions;
  subscriptions?: SubscriptionConfig;
  cors?: { origins: string[] };
  silent?: boolean;
  mongoUri?: string;
  redisUrl?: string;
  defaultPermission?: 'deny' | 'allow' | 'authenticated';
  /** Query complexity configuration (optional, enables complexity limiting) */
  complexity?: {
    /** Maximum allowed query complexity (default: 1000) */
    maxComplexity?: number;
    /** Maximum query depth (default: 10) */
    maxDepth?: number;
    /** Log complexity for all queries (default: false) */
    logComplexity?: boolean;
    /** Enable complexity validation (default: true if complexity config provided) */
    enabled?: boolean;
  };
}

/** Spec for buildDefaultGatewayConfig: services and permissions; optional name, subscriptions, complexity. */
export interface GatewayConfigSpec {
  services: ServiceModule[];
  permissions: GatewayPermissions;
  name?: string;
  subscriptions?: SubscriptionConfig;
  complexity?: GatewayConfig['complexity'];
}

/**
 * Build gateway config from DefaultServiceConfig and a spec (services + permissions).
 * Fills name, port, cors, jwt, mongoUri, redisUrl, defaultPermission from config.
 */
export function buildDefaultGatewayConfig(
  config: DefaultServiceConfig,
  spec: GatewayConfigSpec
): GatewayConfig {
  return {
    name: spec.name ?? config.serviceName,
    port: config.port,
    cors: { origins: config.corsOrigins },
    jwt: {
      secret: config.jwtSecret,
      expiresIn: config.jwtExpiresIn,
      refreshSecret: config.jwtRefreshSecret,
      refreshExpiresIn: config.jwtRefreshExpiresIn ?? '7d',
    },
    services: spec.services,
    permissions: spec.permissions,
    subscriptions: spec.subscriptions,
    complexity: spec.complexity,
    mongoUri: config.mongoUri,
    redisUrl: config.redisUrl,
    defaultPermission: 'deny',
  };
}

// Context type used across all transports
interface GatewayContext {
  user: UserContext | null;
  requestId: string;
  socket?: Socket; // Available in Socket.IO context
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════
// Custom Scalars
// ═══════════════════════════════════════════════════════════════════

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (ast) => {
    if (ast.kind === Kind.STRING) return JSON.parse(ast.value);
    if (ast.kind === Kind.OBJECT) return ast.fields.reduce((acc, f) => ({ ...acc, [f.name.value]: f.value }), {});
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════
// Permission Middleware
// ═══════════════════════════════════════════════════════════════════

export function createPermissionMiddleware(
  permissions: GatewayPermissions,
  defaultPermission: 'deny' | 'allow' | 'authenticated' = 'deny'
) {
  return async function checkPermission(
    opType: 'Query' | 'Mutation' | 'Subscription',
    field: string,
    user: UserContext | null,
    args: Record<string, unknown>
  ): Promise<{ allowed: boolean; reason?: string }> {
    const rules = permissions[opType];
    if (!rules) {
      const allowed = applyDefault(user, defaultPermission);
      return { allowed, reason: allowed ? 'default:allow' : 'default:deny' };
    }
    
    const rule = rules[field];
    if (rule === undefined) {
      const allowed = applyDefault(user, defaultPermission);
      return { allowed, reason: allowed ? 'default:allow' : `no rule for ${field}` };
    }
    
    try {
      const allowed = await rule(user, args);
      return { allowed, reason: allowed ? 'rule:passed' : 'rule:denied' };
    } catch (err) {
      logger.error('Permission check error', { opType, field, error: err });
      return { allowed: false, reason: 'rule:error' };
    }
  };
}

function applyDefault(user: UserContext | null, defaultPermission: string): boolean {
  switch (defaultPermission) {
    case 'allow': return true;
    case 'authenticated': return user !== null;
    default: return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Built-in Subscriptions
// ═══════════════════════════════════════════════════════════════════

export function createHealthSubscription(
  serviceName: string,
  intervalMs: number = 1000
): SubscriptionResolver {
  return async function* healthSubscription(_args, _ctx) {
    const startTime = Date.now();
    
    while (true) {
      const dbHealth = await checkDatabaseHealth();
      const redis = getRedis();
      
      yield {
        status: dbHealth.healthy ? 'healthy' : 'degraded',
        service: serviceName,
        uptime: (Date.now() - startTime) / 1000,
        timestamp: new Date().toISOString(),
        database: { healthy: dbHealth.healthy, latencyMs: dbHealth.latencyMs },
        redis: { connected: redis !== null },
        cache: getCacheStats(),
      };
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  };
}

/**
 * Creates a subscription that streams all logs from the service
 */
export function createLogsSubscription(): SubscriptionResolver {
  return async function* logsSubscription(_args, _ctx) {
    // Create a queue to buffer log entries
    const logQueue: LogEntry[] = [];
    let resolve: (() => void) | null = null;
    
    // Subscribe to log events
    const unsubscribe = subscribeToLogs((entry) => {
      logQueue.push(entry);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });
    
    // Yield initial connection message immediately
    yield {
      timestamp: new Date().toISOString(),
      level: 'info' as const,
      service: logger.getConfig().service || 'gateway',
      message: 'Log stream connected',
      data: { subscriber: 'browser' },
    };
    
    try {
      while (true) {
        // Wait for logs if queue is empty
        if (logQueue.length === 0) {
          await new Promise<void>(r => { resolve = r; });
        }
        
        // Yield all buffered logs
        while (logQueue.length > 0) {
          yield logQueue.shift()!;
        }
      }
    } finally {
      unsubscribe();
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// Schema Builder
// ═══════════════════════════════════════════════════════════════════

function buildSchema(
  services: ServiceModule[],
  subscriptionConfig: SubscriptionConfig,
  resolvers: Record<string, (args: Record<string, unknown>, ctx: ResolverContext) => unknown>,
  checkPermission: (opType: 'Query' | 'Mutation' | 'Subscription', field: string, user: UserContext | null, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>,
): GraphQLSchema {
  // Health types
  const HealthDatabaseType = new GraphQLObjectType({
    name: 'HealthDatabase',
    fields: {
      healthy: { type: GraphQLBoolean },
      latencyMs: { type: GraphQLInt },
      connections: { type: GraphQLInt },
    },
  });
  
  const HealthRedisType = new GraphQLObjectType({
    name: 'HealthRedis',
    fields: { connected: { type: GraphQLBoolean } },
  });
  
  const HealthCacheType = new GraphQLObjectType({
    name: 'HealthCache',
    fields: {
      memorySize: { type: GraphQLInt },
      memoryKeys: { type: new GraphQLList(GraphQLString) },
    },
  });
  
  const HealthType = new GraphQLObjectType({
    name: 'Health',
    fields: {
      status: { type: GraphQLString },
      service: { type: GraphQLString },
      uptime: { type: GraphQLFloat },
      timestamp: { type: GraphQLString },
      database: { type: HealthDatabaseType },
      redis: { type: HealthRedisType },
      cache: { type: HealthCacheType },
    },
  });

  // Log type for streaming logs
  const LogType = new GraphQLObjectType({
    name: 'Log',
    fields: {
      timestamp: { type: GraphQLString },
      level: { type: GraphQLString },
      service: { type: GraphQLString },
      message: { type: GraphQLString },
      data: { type: JSONScalar },
    },
  });
  
  // Map subscription names to their return types
  const subscriptionTypes: Record<string, GraphQLObjectType> = {
    health: HealthType,
    logs: LogType,
  };

  // Parse and merge type definitions from all services
  // Note: JSON scalar is already added to schema.types array (JSONScalar), so we don't declare it in SDL
  // Declaring it in SDL would cause "Type JSON already exists" error
  let allTypeDefs = configGraphQLTypes; // Add config GraphQL types first (core service)
  for (const svc of services) {
    if (svc.types) {
      allTypeDefs += '\n' + svc.types;
    }
  }

  // Build base schema with minimal Query/Mutation/Subscription types
  // Only include 'health' query - let type definitions extend the rest
  // Note: Using any for dynamic GraphQL field building - GraphQL types are complex and dynamic
  const queryFields: Record<string, { type: any; args?: any; resolve: any }> = {
    health: {
      type: HealthType,
      resolve: async (_root: unknown, _args: unknown, ctx: GatewayContext) => {
        return resolvers.health({}, ctx);
      },
    },
    errorCodes: {
      type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
      resolve: async () => {
        return getAllErrorCodes();
      },
    },
  };

  const QueryType = new GraphQLObjectType({
    name: 'Query',
    fields: queryFields,
  });

  // Create empty Mutation and Subscription types - will be extended by type definitions
  const emptyMutationType = new GraphQLObjectType({
    name: 'Mutation',
    fields: {},
  });

  // Subscription type
  // Note: Using any for dynamic GraphQL field building - GraphQL types are complex and dynamic
  const subscriptionFields: Record<string, { type: any; subscribe: any; resolve: any }> = {};
  
  for (const [key, subFn] of Object.entries(subscriptionConfig)) {
    // Use specific type if defined, otherwise fallback to HealthType
    const returnType = subscriptionTypes[key] || HealthType;
    
    subscriptionFields[key] = {
      type: returnType,
      subscribe: async function* (_root: unknown, args: unknown, ctx: GatewayContext) {
        // Health and logs subscriptions are always allowed
        if (key !== 'health' && key !== 'logs') {
          const result = await checkPermission('Subscription', key, ctx.user, args as Record<string, unknown> || {});
          if (!result.allowed) {
            throw new Error(`Not authorized: Subscription.${key}`);
          }
        }
        
        const generator = subFn(args as Record<string, unknown>, ctx);
        for await (const value of generator) {
          yield { [key]: value };
        }
      },
      resolve: (payload: Record<string, unknown>) => payload[key],
    };
  }

  const SubscriptionType = Object.keys(subscriptionFields).length > 0
    ? new GraphQLObjectType({ name: 'Subscription', fields: subscriptionFields })
    : undefined;

  // Common types needed by services
  const PageInfoType = new GraphQLObjectType({
    name: 'PageInfo',
    fields: {
      hasNextPage: { type: GraphQLBoolean },
      hasPreviousPage: { type: GraphQLBoolean },
      startCursor: { type: GraphQLString }, // Cursor for first item in page
      endCursor: { type: GraphQLString },   // Cursor for last item in page
    },
  });

  const BasicResponseType = new GraphQLObjectType({
    name: 'BasicResponse',
    fields: {
      success: { type: GraphQLBoolean },
      message: { type: GraphQLString },
    },
  });

  // Build base schema with empty Mutation to allow extension
  let baseSchema = new GraphQLSchema({
    query: QueryType,
    mutation: emptyMutationType,
    subscription: SubscriptionType,
    types: [JSONScalar, HealthType, HealthDatabaseType, HealthRedisType, HealthCacheType, LogType, PageInfoType, BasicResponseType],
  });

  // Extend schema with service type definitions FIRST
  // Note: extendSchema may throw warnings but still extend the schema
  // We need to check if mutations were actually added even if there were warnings
  if (allTypeDefs.trim()) {
    try {
      const typeDoc = parse(allTypeDefs);
      baseSchema = extendSchema(baseSchema, typeDoc);
      logger.info('Successfully extended schema with service type definitions', {
        typeCount: Object.keys(baseSchema.getTypeMap()).length,
        hasMutations: baseSchema.getMutationType() ? Object.keys(baseSchema.getMutationType()!.getFields()).length : 0,
      });
    } catch (error: unknown) {
      // Even if extendSchema throws, it might have partially extended the schema
      const errorMessage = getErrorMessage(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      // Check if mutations were added by inspecting the extended schema
      const tempExtendedMutation = baseSchema.getMutationType();
      const hasMutations = tempExtendedMutation && Object.keys(tempExtendedMutation.getFields()).length > 0;
      
      logger.error('Schema extension error', { 
        error: errorMessage,
        stack: errorStack,
        hasMutations,
        typeDefsLength: allTypeDefs.length,
        typeDefsPreview: allTypeDefs.substring(0, 500),
      });
      
      if (hasMutations) {
        logger.warn('Schema extension had warnings but mutations were added', { 
          error: errorMessage,
        });
        // Schema was extended despite the error - continue using it
      } else {
        logger.error('Schema extension failed and no mutations found', { 
          error: errorMessage,
        });
        // Schema extension truly failed - will need fallback
        throw error; // Re-throw to prevent using broken schema
      }
    }
  }

  // Get extended root types from the schema
  const extendedQueryType = baseSchema.getQueryType();
  const extendedMutationType = baseSchema.getMutationType();
  const extendedSubscriptionType = baseSchema.getSubscriptionType();
  
  // Generic helper to build field resolvers for any root type
  // Note: Using any for dynamic GraphQL field building - GraphQL's type system is complex and dynamic
  function buildFieldResolver(
    opType: 'Query' | 'Mutation' | 'Subscription',
    fieldName: string,
    field: any,
    resolvers: Record<string, (args: Record<string, unknown>, ctx: ResolverContext) => unknown>,
    subscriptionConfig: SubscriptionConfig,
    checkPermission: (opType: 'Query' | 'Mutation' | 'Subscription', field: string, user: UserContext | null, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>
  ) {
    const fieldConfig: any = {
      type: field.type,
      args: field.args.reduce((acc: any, arg: any) => {
        acc[arg.name] = { type: arg.type };
        return acc;
      }, {}),
    };

    // Subscriptions use subscribe instead of resolve
    if (opType === 'Subscription') {
      const subFn = subscriptionConfig[fieldName];
      if (subFn) {
        fieldConfig.subscribe = async function* (_root: unknown, args: unknown, ctx: GatewayContext) {
          try {
            // Health and logs subscriptions are always allowed
            if (fieldName !== 'health' && fieldName !== 'logs') {
              const result = await checkPermission('Subscription', fieldName, ctx.user, args as Record<string, unknown> || {});
              if (!result.allowed) {
                throw new Error(`Not authorized: Subscription.${fieldName}`);
              }
            }
            const generator = subFn(args as Record<string, unknown>, ctx);
            for await (const value of generator) {
              yield { [fieldName]: value };
            }
          } catch (error) {
            // Format error for GraphQL response (auto-logged in GraphQLError constructor)
            throw formatGraphQLError(error, {
              correlationId: getCorrelationId(),
              userId: ctx.user?.userId,
            });
          }
        };
        fieldConfig.resolve = (payload: Record<string, unknown>) => payload[fieldName];
      } else if (field.subscribe) {
        // Use field's subscribe if no resolver
        fieldConfig.subscribe = field.subscribe;
        fieldConfig.resolve = field.resolve || ((payload: Record<string, unknown>) => payload[fieldName]);
      }
    } else {
      // Query and Mutation use resolve
      // Note: args and info use any due to GraphQL's dynamic nature
      fieldConfig.resolve = async (_root: unknown, args: any, ctx: GatewayContext, info: any) => {
        try {
          // Use resolver if available
          if (resolvers[fieldName]) {
            // Check if mutation uses input wrapper or direct arguments
            // Some mutations like testWebhook(id: ID!) use direct args, not input wrapper
            // Some mutations like updateWebhook(id: ID!, input: UpdateWebhookInput!) have both id and input
            const hasInputArg = opType === 'Mutation' && args.input !== undefined;
            const checkArgs = hasInputArg 
              ? (args.input as Record<string, unknown> || {})
              : (args || {});
            const result = await checkPermission(opType, fieldName, ctx.user || null, checkArgs);
            if (!result.allowed) {
              throw new Error(`Not authorized: ${opType}.${fieldName}`);
            }
            // Mutations with input wrapper: pass all args (including id if present)
            // Mutations with direct args (like testWebhook, deleteWebhook): pass args directly
            if (opType === 'Mutation' && hasInputArg) {
              // Preserve all args (id, input, etc.) for mutations like updateWebhook
              return await resolvers[fieldName](args, ctx);
            }
            return await resolvers[fieldName](checkArgs, ctx);
          }
          // Fallback to field's resolver
          if (field.resolve) {
            return await field.resolve(_root, args, ctx, info);
          }
          throw new Error(`No resolver for ${opType}.${fieldName}`);
        } catch (error) {
          // Format error for GraphQL response (auto-logged in GraphQLError constructor)
          throw formatGraphQLError(error, {
            correlationId: getCorrelationId(),
            userId: ctx.user?.userId,
          });
        }
      };
    }

    return fieldConfig;
  }
  
  // Build field maps with resolvers attached for each root type
  const queryFieldsWithResolvers: Record<string, any> = {};
  const mutationFieldsWithResolvers: Record<string, any> = {};
  const subscriptionFieldsWithResolvers: Record<string, any> = {};
  
  /**
   * Helper function to process GraphQL type fields and build resolvers
   */
  function processFields(
    opType: 'Query' | 'Mutation' | 'Subscription',
    type: any,
    targetFields: Record<string, any>
  ): void {
    if (!type) return;
    const fields = type.getFields();
    for (const [fieldName, field] of Object.entries(fields)) {
      targetFields[fieldName] = buildFieldResolver(opType, fieldName, field, resolvers, subscriptionConfig, checkPermission);
    }
  }
  
  // Process Query fields from extended schema
  processFields('Query', extendedQueryType, queryFieldsWithResolvers);
  
  // Process Mutation fields from extended schema
  if (extendedMutationType) {
    processFields('Mutation', extendedMutationType, mutationFieldsWithResolvers);
  }  
  // If schema extension failed but we have mutation resolvers, we need to use the extended schema anyway
  // The warning is non-fatal - the schema was still extended, just with warnings
  // Check if extendedMutationType has fields even if extension "failed"
  if (Object.keys(mutationFieldsWithResolvers).length === 0 && extendedMutationType) {
    const extendedFields = extendedMutationType.getFields();
    if (Object.keys(extendedFields).length > 0) {
      // Schema was actually extended, just had warnings - use the fields
      for (const [fieldName, field] of Object.entries(extendedFields)) {
        mutationFieldsWithResolvers[fieldName] = buildFieldResolver('Mutation', fieldName, field, resolvers, subscriptionConfig, checkPermission);
      }
      logger.info('Using mutation fields from extended schema despite extension warnings');
    }
  }

  // Process Subscription fields - use extended if available, otherwise use base
  processFields('Subscription', extendedSubscriptionType, subscriptionFieldsWithResolvers);
  // Always include base subscription fields (health, logs)
  for (const [fieldName, field] of Object.entries(subscriptionFields)) {
    if (!subscriptionFieldsWithResolvers[fieldName]) {
      subscriptionFieldsWithResolvers[fieldName] = field;
    }
  }

  // Get all types from extended schema except root types to avoid duplicates
  // Note: Using any for GraphQL type filtering - GraphQL's type system is complex
  const typeMap = baseSchema.getTypeMap();
  const otherTypes = Object.values(typeMap).filter((type: any) => 
    type.name !== 'Query' && 
    type.name !== 'Mutation' && 
    type.name !== 'Subscription' && 
    !type.name.startsWith('__')
  );

  // Create new root types with resolvers attached
  const QueryWithResolvers = new GraphQLObjectType({
    name: 'Query',
    fields: queryFieldsWithResolvers,
  });

  // Only create Mutation type if there are fields - GraphQL requires at least one field
  const MutationWithResolvers = Object.keys(mutationFieldsWithResolvers).length > 0
    ? new GraphQLObjectType({ 
        name: 'Mutation', 
        fields: mutationFieldsWithResolvers
      })
    : undefined;

  const SubscriptionWithResolvers = Object.keys(subscriptionFieldsWithResolvers).length > 0
    ? new GraphQLObjectType({
        name: 'Subscription',
        fields: subscriptionFieldsWithResolvers,
      })
    : undefined;

  // Return new schema - GraphQL will handle type deduplication
  return new GraphQLSchema({
    query: QueryWithResolvers,
    mutation: MutationWithResolvers,
    subscription: SubscriptionWithResolvers,
    types: otherTypes,
  });
}

// ═══════════════════════════════════════════════════════════════════
// Gateway Implementation
// ═══════════════════════════════════════════════════════════════════

/**
 * Socket.IO broadcast helpers for server-initiated push
 */
export interface BroadcastHelpers {
  /** Broadcast to all connected clients or a specific room */
  (event: string, data: unknown, room?: string): void;
  /** Broadcast to a specific user by userId */
  toUser: (userId: string, event: string, data: unknown) => void;
  /** Broadcast to all users in a tenant */
  toTenant: (tenantId: string, event: string, data: unknown) => void;
}

/**
 * SSE (Server-Sent Events) helpers for server-initiated push
 */
export interface SSEHelpers {
  /** Push event to all SSE connections */
  push: (event: string, data: unknown) => void;
  /** Push event to a specific user's SSE connections */
  pushToUser: (userId: string, event: string, data: unknown) => void;
  /** Push event to all users in a tenant's SSE connections */
  pushToTenant: (tenantId: string, event: string, data: unknown) => void;
  /** Get count of active SSE connections */
  getConnectionCount: () => number;
}

/**
 * Gateway instance returned from createGateway
 */
export interface GatewayInstance {
  /** HTTP server */
  server: import('http').Server;
  /** Socket.IO server - for advanced usage */
  io: SocketIOServer;
  /** GraphQL schema */
  schema: GraphQLSchema;
  /** Socket.IO broadcast helpers (bidirectional, WebSocket + polling) */
  broadcast: BroadcastHelpers;
  /** SSE broadcast helpers (unidirectional, server → client) */
  sse: SSEHelpers;
  /** Gracefully shutdown the gateway */
  shutdown: () => Promise<void>;
}

/**
 * Resolve and connect gateway infrastructure (DB + optional Redis).
 * Separates infra wiring from schema/server orchestration for testability.
 */
async function connectGatewayInfrastructure(config: Pick<GatewayConfig, 'name' | 'mongoUri' | 'redisUrl'>): Promise<void> {
  const { name, mongoUri, redisUrl } = config;
  let dbUri = mongoUri || process.env.MONGO_URI;
  if (!dbUri) {
    const dbName = (name === 'auth-service' || name === 'core-service') ? 'core_service' : name.replace(/-/g, '_');
    dbUri = `mongodb://localhost:27017/${dbName}`;
  }
  await connectDatabase(dbUri);
  const dbHealth = await checkDatabaseHealth();
  if (!dbHealth.healthy) {
    throw new Error('Database health check failed after connection');
  }

  const redisUri = redisUrl || process.env.REDIS_URL;
  if (redisUri) {
    try {
      await connectRedis(redisUri);
      const redisHealth = await checkRedisHealth();
      if (!redisHealth.healthy) {
        logger.warn('Redis health check failed - continuing without Redis');
      }
    } catch (error) {
      logger.warn(`Failed to connect to Redis for ${name} - continuing without Redis`, {
        error: getErrorMessage(error),
      });
    }
  }
}

export async function createGateway(config: GatewayConfig): Promise<GatewayInstance> {
  const { 
    name, port, jwt, services, 
    permissions = {},
    subscriptions = {},
    cors, silent = false,
    mongoUri, redisUrl,
    defaultPermission = 'deny',
  } = config;
  
  const startTime = Date.now();
  logger.info(`Starting ${name}...`);

  try {
    await connectGatewayInfrastructure({ name, mongoUri, redisUrl });
  } catch (error) {
    logger.error(`Failed to connect to database for ${name}`, {
      error: getErrorMessage(error),
      uri: (mongoUri || process.env.MONGO_URI || '').replace(/:[^:@]+@/, ':***@'),
    });
    throw error;
  }

  const checkPermission = createPermissionMiddleware(permissions, defaultPermission);

  // Build resolvers using Builder pattern (simplifies merging and construction)
  const resolverBuilder = createResolverBuilder()
    .addQuery('health', async () => {
      const dbHealth = await checkDatabaseHealth();
      const redis = getRedis();
      return { 
        status: dbHealth.healthy ? 'healthy' : 'degraded',
        service: name, 
        uptime: (Date.now() - startTime) / 1000,
        database: { healthy: dbHealth.healthy, latencyMs: dbHealth.latencyMs, connections: dbHealth.connections },
        redis: { connected: redis !== null },
        cache: getCacheStats(),
      };
    })
    .addQuery('errorCodes', async () => {
      return getAllErrorCodes();
    })
    // Add config resolvers (core service) - wrap to match ResolverFunction signature
    .addQuery('config', async (args, ctx) => {
      return configResolvers.Query.config(null, args as any, ctx);
    })
    .addQuery('configs', async (args, ctx) => {
      return configResolvers.Query.configs(null, args as any, ctx);
    })
    .addMutation('setConfig', async (args, ctx) => {
      return configResolvers.Mutation.setConfig(null, args as any, ctx);
    })
    .addMutation('deleteConfig', async (args, ctx) => {
      return configResolvers.Mutation.deleteConfig(null, args as any, ctx);
    })
    .addMutation('reloadConfig', async (args, ctx) => {
      return configResolvers.Mutation.reloadConfig(null, args as any, ctx);
    });

  // Add resolvers from all services
  for (const svc of services) {
    resolverBuilder.addService(svc.resolvers as ServiceResolvers);
  }

  // Build resolver object
  const builtResolvers = resolverBuilder.build();
  
  // Convert to format expected by buildSchema (flat object)
  const resolvers: Record<string, (args: Record<string, unknown>, ctx: ResolverContext) => unknown> = {
    ...builtResolvers.Query,
    ...builtResolvers.Mutation,
  };

  // All subscriptions
  const allSubscriptions: SubscriptionConfig = {
    health: createHealthSubscription(name, 1000),
    logs: createLogsSubscription(),
    ...subscriptions,
  };

  // Build GraphQL schema
  const schema = buildSchema(services, allSubscriptions, resolvers, checkPermission);

  // ─────────────────────────────────────────────────────────────────
  // Shared context factory - SINGLE SOURCE OF TRUTH
  // ─────────────────────────────────────────────────────────────────
  
  function createContext(req: IncomingMessage, socket?: Socket): GatewayContext {
    // Extract correlation ID from headers (X-Correlation-ID or X-Request-ID)
    const correlationId = (req.headers['x-correlation-id'] || 
                          req.headers['x-request-id'] || 
                          generateCorrelationId()) as string;
    setCorrelationId(correlationId);
    
    const token = extractToken(req.headers.authorization);
    const user = token ? verifyToken(token, jwt) : null;
    return { user, requestId: correlationId, socket };
  }

  function createContextFromToken(token: string | null | undefined, socket?: Socket): GatewayContext {
    const user = token ? verifyToken(token, jwt) : null;
    return { user, requestId: randomUUID(), socket };
  }

  // ─────────────────────────────────────────────────────────────────
  // Query Complexity Configuration
  // ─────────────────────────────────────────────────────────────────
  
  const complexityConfig: ComplexityConfig | null = config.complexity?.enabled !== false && config.complexity
    ? createComplexityConfig({
        maxComplexity: config.complexity.maxComplexity ?? 1000,
        maxDepth: config.complexity.maxDepth ?? 10,
        logComplexity: config.complexity.logComplexity ?? false,
      })
    : null;

  // ─────────────────────────────────────────────────────────────────
  // graphql-http: Queries & Mutations
  // ─────────────────────────────────────────────────────────────────
  
  const httpHandler = createHttpHandler({
    schema,
    // Note: Using any for context function - graphql-http expects specific context type
    context: ((req: { raw: IncomingMessage }) => createContext(req.raw)) as any,
  });

  /**
   * Wrapper handler that validates query complexity before execution
   */
  async function handleGraphQLWithComplexity(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // If complexity checking is disabled, pass through directly
    if (!complexityConfig) {
      return httpHandler(req, res);
    }

    // Only check POST requests (queries/mutations)
    if (req.method !== 'POST') {
      return httpHandler(req, res);
    }

    // Parse request body to get the query
    try {
      const body = await parseRequestBody(req);
      
      if (body && body.query) {
        const result = analyzeQueryComplexity(
          schema,
          body.query,
          body.variables || {},
          complexityConfig,
          body.operationName
        );

        if (!result.allowed && result.error) {
          // Return complexity error
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            errors: [{
              message: result.error.message,
              extensions: result.error.extensions,
            }],
          }));
          return;
        }
      }
    } catch {
      // If parsing fails, let the HTTP handler deal with it
    }

    // Pass through to the original handler
    return httpHandler(req, res);
  }

  /**
   * Parse request body for complexity checking
   */
  async function parseRequestBody(req: IncomingMessage): Promise<{ query?: string; variables?: Record<string, unknown>; operationName?: string } | null> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // graphql-sse: Subscriptions via SSE
  // ─────────────────────────────────────────────────────────────────
  
  const sseHandler = createSSEHandler({
    schema,
    execute,
    subscribe,
    // Note: Using any for context function - graphql-sse expects specific context type
    context: ((req: { raw: IncomingMessage }) => createContext(req.raw)) as any,
  });

  // ─────────────────────────────────────────────────────────────────
  // Custom SSE: Event stream for non-GraphQL push (GET /events)
  // ─────────────────────────────────────────────────────────────────
  
  interface SSEConnection {
    res: ServerResponse;
    userId: string | null;
    tenantId: string | null;
  }
  
  const sseConnections = new Map<string, SSEConnection>();

  function handleSSEEvents(req: IncomingMessage, res: ServerResponse) {
    const ctx = createContext(req);
    const connectionId = randomUUID();
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    
    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ connectionId })}\n\n`);
    
    // Track connection
    sseConnections.set(connectionId, {
      res,
      userId: ctx.user?.userId || null,
      tenantId: ctx.user?.tenantId || null,
    });
    
    logger.info('SSE connected', { connectionId, userId: ctx.user?.userId });
    
    // Keep-alive ping every 30s
    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`:ping\n\n`);
      }
    }, 30000);
    
    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(pingInterval);
      sseConnections.delete(connectionId);
      logger.info('SSE disconnected', { connectionId });
    });
  }

  // SSE push helpers
  /**
   * Helper function to push SSE events to connections with optional filtering
   */
  function pushToSSEConnections(
    event: string,
    data: unknown,
    filter?: (conn: SSEConnection) => boolean
  ): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, conn] of sseConnections) {
      if (!conn.res.writableEnded && (!filter || filter(conn))) {
        conn.res.write(payload);
      }
    }
  }

  function ssePush(event: string, data: unknown) {
    pushToSSEConnections(event, data);
  }

  function ssePushToUser(userId: string, event: string, data: unknown) {
    pushToSSEConnections(event, data, (conn) => conn.userId === userId);
  }

  function ssePushToTenant(tenantId: string, event: string, data: unknown) {
    pushToSSEConnections(event, data, (conn) => conn.tenantId === tenantId);
  }

  // ─────────────────────────────────────────────────────────────────
  // HTTP Request Handler
  // ─────────────────────────────────────────────────────────────────
  
  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', cors.origins[0] || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Correlation-ID,X-Request-ID');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }

    // Unified health endpoint - combines liveness, readiness, and metrics
    if (url.pathname === '/health') {
      const dbHealth = await checkDatabaseHealth();
      const redis = getRedis();
      const cacheStats = getCacheStats();
      
      // Service is healthy if database is healthy
      const healthy = dbHealth.healthy;
      const status = healthy ? 'healthy' : 'degraded';
      
      // Return 200 if healthy, 503 if degraded (for Kubernetes readiness)
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status,
        service: name,
        uptime: (Date.now() - startTime) / 1000,
        timestamp: new Date().toISOString(),
        database: {
          healthy: dbHealth.healthy,
          latencyMs: dbHealth.latencyMs,
          connections: dbHealth.connections,
        },
        redis: { connected: redis !== null },
        cache: cacheStats,
      }));
      return;
    }

    // GraphQL SSE subscriptions
    if (url.pathname === '/graphql/stream') {
      return sseHandler(req, res);
    }

    // Custom SSE event stream (non-GraphQL)
    if (url.pathname === '/events' && req.method === 'GET') {
      return handleSSEEvents(req, res);
    }

    // GraphQL queries/mutations (with complexity validation)
    if (url.pathname === '/graphql') {
      return handleGraphQLWithComplexity(req, res);
    }

    res.writeHead(404);
    res.end('Not found');
  }

  // Create HTTP server
  const server = createServer(handleRequest);
  
  // ─────────────────────────────────────────────────────────────────
  // Socket.IO: Bidirectional real-time with HTTP fallback
  // ─────────────────────────────────────────────────────────────────
  
  const io = new SocketIOServer(server, {
    cors: cors ? {
      origin: cors.origins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Request-ID'],
      credentials: true,
    } : undefined,
    // Allow both WebSocket and HTTP long-polling
    transports: ['websocket', 'polling'],
    // Ping settings for connection health
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Track active subscriptions per socket
  const activeSubscriptions = new Map<string, Map<string, { running: boolean }>>();

  io.on('connection', (socket: Socket) => {
    const socketId = socket.id;
    activeSubscriptions.set(socketId, new Map());
    
    // Extract token from auth header or handshake
    // Socket.IO client sends auth object which becomes socket.handshake.auth
    // The auth.token is the raw token (not "Bearer <token>")
    // Also check headers for Authorization header (which is "Bearer <token>")
    const authToken = socket.handshake.auth?.token;
    const headerAuth = socket.handshake.headers?.authorization;
    
    // If authToken exists and is a string, use it directly (it's already the token)
    // Otherwise, extract from Authorization header (which has "Bearer " prefix)
    const token = authToken && typeof authToken === 'string' 
      ? authToken 
      : extractToken(headerAuth);
    
    const ctx = createContextFromToken(token, socket);
    
    // Debug logging
    if (!ctx.user) {
      logger.warn('Socket.IO connection: No user context created', {
        socketId,
        hasAuthToken: !!authToken,
        hasHeaderAuth: !!headerAuth,
        authTokenType: typeof authToken,
        handshakeAuth: socket.handshake.auth,
        handshakeHeaders: Object.keys(socket.handshake.headers || {}),
      });
    }
    
    logger.info('Socket.IO connected', { 
      socketId, 
      userId: ctx.user?.userId,
      tenantId: ctx.user?.tenantId,
      hasToken: !!token,
      hasAuthToken: !!authToken,
      hasHeaderAuth: !!headerAuth,
      authTokenPresent: !!socket.handshake.auth?.token,
      transport: socket.conn.transport.name, // 'websocket' or 'polling'
    });

    // Join user-specific room for targeted messages
    if (ctx.user?.userId) {
      const userRoom = `user:${ctx.user.userId}`;
      socket.join(userRoom);
      logger.info('Socket joined user room', { socketId, userId: ctx.user.userId, room: userRoom });
    } else {
      logger.warn('Socket connected but no userId found - notifications will not be received', {
        socketId,
        hasToken: !!token,
        hasUser: !!ctx.user,
      });
    }
    if (ctx.user?.tenantId) {
      const tenantRoom = `tenant:${ctx.user.tenantId}`;
      socket.join(tenantRoom);
      logger.info('Socket joined tenant room', { socketId, tenantId: ctx.user.tenantId, room: tenantRoom });
    }

    // ─── GraphQL Query/Mutation via Socket.IO ───
    socket.on('graphql', async (payload: { query: string; variables?: Record<string, unknown>; operationName?: string }, callback) => {
      try {
        // Validate query complexity if enabled
        if (complexityConfig) {
          const complexityResult = analyzeQueryComplexity(
            schema,
            payload.query,
            payload.variables || {},
            complexityConfig,
            payload.operationName
          );
          
          if (!complexityResult.allowed && complexityResult.error) {
            callback({
              errors: [{
                message: complexityResult.error.message,
                extensions: complexityResult.error.extensions,
              }],
            });
            return;
          }
        }

        const result = await execute({
          schema,
          document: (await import('graphql')).parse(payload.query),
          variableValues: payload.variables,
          contextValue: ctx,
          operationName: payload.operationName,
        });
        
        if (typeof callback === 'function') {
          callback({ data: result.data, errors: result.errors });
        } else {
          socket.emit('graphql:result', { data: result.data, errors: result.errors });
        }
      } catch (err) {
        const error = { message: err instanceof Error ? err.message : 'GraphQL error' };
        if (typeof callback === 'function') {
          callback({ errors: [error] });
        } else {
          socket.emit('graphql:error', { errors: [error] });
        }
      }
    });

    // ─── GraphQL Subscription via Socket.IO ───
    socket.on('subscribe', async (payload: { id: string; query: string; variables?: Record<string, unknown> }) => {
      const { id, query, variables } = payload;
      const subs = activeSubscriptions.get(socketId)!;
      
      // Stop existing subscription with same id
      if (subs.has(id)) {
        subs.get(id)!.running = false;
      }
      
      try {
        const { parse } = await import('graphql');
        const doc = parse(query);
        const op = doc.definitions.find((d): d is import('graphql').OperationDefinitionNode => 
          d.kind === 'OperationDefinition' && d.operation === 'subscription'
        );
        
        if (!op) {
          socket.emit('subscription:error', { id, errors: [{ message: 'Not a subscription query' }] });
          return;
        }
        
        const field = op.selectionSet.selections
          .filter((s): s is import('graphql').FieldNode => s.kind === 'Field')
          .map(s => s.name.value)[0];
        
        const subscription = allSubscriptions[field];
        if (!subscription) {
          socket.emit('subscription:error', { id, errors: [{ message: `Unknown subscription: ${field}` }] });
          return;
        }
        
        // Permission check (except health)
        if (field !== 'health') {
          const permResult = await checkPermission('Subscription', field, ctx.user, variables || {});
          if (!permResult.allowed) {
            socket.emit('subscription:error', { id, errors: [{ message: `Not authorized: Subscription.${field}` }] });
            return;
          }
        }
        
        // Start subscription
        const subState = { running: true };
        subs.set(id, subState);
        
        const generator = subscription(variables || {}, ctx);
        
        (async () => {
          try {
            for await (const value of generator) {
              if (!subState.running) break;
              socket.emit('subscription:data', { id, data: { [field]: value } });
            }
            socket.emit('subscription:complete', { id });
          } catch (err) {
            if (subState.running) {
              socket.emit('subscription:error', { id, errors: [{ message: err instanceof Error ? err.message : String(err) }] });
            }
          } finally {
            subs.delete(id);
          }
        })();
        
      } catch (err) {
        socket.emit('subscription:error', { id, errors: [{ message: err instanceof Error ? err.message : 'Subscription error' }] });
      }
    });

    // ─── Stop Subscription ───
    socket.on('unsubscribe', (payload: { id: string }) => {
      const subs = activeSubscriptions.get(socketId);
      const sub = subs?.get(payload.id);
      if (sub) {
        sub.running = false;
        subs?.delete(payload.id);
        socket.emit('subscription:complete', { id: payload.id });
      }
    });

    // ─── Room Management ───
    socket.on('joinRoom', (payload: { room: string }, callback?: (response: { success: boolean; room?: string; error?: string }) => void) => {
      if (payload?.room) {
        socket.join(payload.room);
        logger.info('Socket joined room', { socketId, room: payload.room, userId: ctx.user?.userId });
        if (typeof callback === 'function') {
          callback({ success: true, room: payload.room });
        } else {
          socket.emit('room:joined', { room: payload.room });
        }
      } else if (typeof callback === 'function') {
        callback({ success: false, error: 'Room name required' });
      }
    });

    socket.on('leaveRoom', (payload: { room: string }, callback?: (response: { success: boolean; room?: string; error?: string }) => void) => {
      if (payload?.room) {
        socket.leave(payload.room);
        logger.info('Socket left room', { socketId, room: payload.room, userId: ctx.user?.userId });
        if (typeof callback === 'function') {
          callback({ success: true, room: payload.room });
        } else {
          socket.emit('room:left', { room: payload.room });
        }
      } else if (typeof callback === 'function') {
        callback({ success: false, error: 'Room name required' });
      }
    });

    socket.on('getRooms', (callback?: (rooms: string[]) => void) => {
      const rooms = Array.from(socket.rooms);
      if (typeof callback === 'function') {
        callback(rooms);
      } else {
        socket.emit('rooms', rooms);
      }
    });

    socket.on('getConnectionCount', (callback?: (count: number) => void) => {
      const count = io.sockets.sockets.size;
      if (typeof callback === 'function') {
        callback(count);
      } else {
        socket.emit('connectionCount', { count });
      }
    });

    // ─── Disconnect ───
    socket.on('disconnect', (reason) => {
      // Stop all subscriptions
      const subs = activeSubscriptions.get(socketId);
      if (subs) {
        for (const [, sub] of subs) {
          sub.running = false;
        }
      }
      activeSubscriptions.delete(socketId);
      
      logger.info('Socket.IO disconnected', { socketId, reason });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Helper: Broadcast to rooms (server-initiated push)
  // ─────────────────────────────────────────────────────────────────
  
  function broadcast(event: string, data: unknown, room?: string) {
    if (room) {
      io.to(room).emit(event, data);
    } else {
      io.emit(event, data);
    }
  }

  function broadcastToUser(userId: string, event: string, data: unknown) {
    io.to(`user:${userId}`).emit(event, data);
  }

  function broadcastToTenant(tenantId: string, event: string, data: unknown) {
    io.to(`tenant:${tenantId}`).emit(event, data);
  }

  server.listen(port, () => {
    if (!silent) {
      logger.info(`${name} started`, { 
        port, 
        endpoints: {
          graphql: `http://localhost:${port}/graphql`,
          subscriptions_sse: `http://localhost:${port}/graphql/stream`,
          socketio: `http://localhost:${port} (Socket.IO)`,
          health: `http://localhost:${port}/health`,
        },
        transports: {
          http: 'graphql-http (official)',
          sse: 'graphql-sse (official)',
          socketio: 'Socket.IO v4 (WebSocket + polling fallback)',
        },
      });
      
    }
  });

  // Create typed broadcast helper (Socket.IO)
  const broadcastHelper: BroadcastHelpers = Object.assign(
    broadcast,
    { toUser: broadcastToUser, toTenant: broadcastToTenant }
  );

  // Create SSE helpers
  const sseHelpers: SSEHelpers = {
    push: ssePush,
    pushToUser: ssePushToUser,
    pushToTenant: ssePushToTenant,
    getConnectionCount: () => sseConnections.size,
  };

  return { 
    server, 
    io,
    schema,
    broadcast: broadcastHelper,
    sse: sseHelpers,
    shutdown: async () => { 
      // Close all SSE connections
      for (const [, conn] of sseConnections) {
        if (!conn.res.writableEnded) {
          conn.res.end();
        }
      }
      sseConnections.clear();
      io.close();
      server.close(); 
    },
  };
}
