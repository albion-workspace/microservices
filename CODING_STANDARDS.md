# Coding Standards & Best Practices

**Purpose**: This document defines coding standards, best practices, and patterns to follow when working on this codebase. Always review this document before making changes.

**Project Status**: Pre-Production - This project has not yet been released to production. Code cleanup rules are simplified (no backward compatibility concerns). After production/release, these rules will be updated to include backward compatibility and legacy code management.

**Last Updated**: 2026-02-06

---

## 📋 General Principles

### 1. **Holistic Review First**
- **Always**: Review the entire file/component before making changes
- **Always**: Check for related files that might be affected
- **Always**: Understand the full context before refactoring
- **Never**: Make changes based on isolated code snippets without understanding the full picture

### 2. **Consistency Over Speed**
- **Always**: Follow existing patterns in the codebase
- **Always**: Maintain consistency across similar files/components
- **Never**: Introduce new patterns without justification
- **When in doubt**: Check similar files for patterns

### 3. **Verify Before Removing**
- **Always**: Search the entire codebase for usages before removing code
- **Always**: Check if variables/functions are used elsewhere
- **Always**: Verify imports are truly unused (check dynamic imports, re-exports)
- **Never**: Remove code based on linter warnings alone without verification

### 4. **Remove Dead Code After Error Throws**
- **Always**: Remove unreachable code after `throw` statements
- **Always**: Remove unreachable `return` statements after `throw`
- **Always**: Remove unreachable variable assignments after `throw`
- **Never**: Leave dead code after error throws (it's unreachable and confusing)
- **Example**: After `throw createServiceError(...)`, remove any code that follows in the same block

---

## 🔍 Code Review Checklist

Before making any changes, follow this checklist:

### Pre-Change Analysis
- [ ] Read the entire file being modified
- [ ] Search codebase for all usages of functions/variables being changed
- [ ] Check for related files that might be affected
- [ ] Understand the purpose and context of the code
- [ ] Check for similar patterns in other files
- [ ] Consider if a design pattern would be appropriate (see Design Patterns section)
- [ ] Verify dependencies and imports

### During Changes
- [ ] Maintain existing code style and patterns
- [ ] Keep changes focused and minimal
- [ ] Preserve functionality while improving code
- [ ] Add comments for non-obvious logic
- [ ] Update related documentation if needed

### Post-Change Verification
- [ ] Build all affected services/modules
- [ ] Check for TypeScript errors
- [ ] Verify no unused imports/variables introduced
- [ ] Ensure no breaking changes (unless intentional)
- [ ] Test affected functionality if possible

---

## 📦 Import/Export Rules

### Imports

#### Import Grouping Standard

**Always**: Group imports in the following order (separate groups with blank lines):

1. **Node.js Built-ins** (if any)
   ```typescript
   import { createServer, IncomingMessage } from 'node:http';
   import { randomUUID } from 'node:crypto';
   ```

2. **External Packages** (npm packages)
   ```typescript
   import { Server as SocketIOServer } from 'socket.io';
   import { GraphQLSchema, GraphQLObjectType } from 'graphql';
   import { createHandler } from 'graphql-http/lib/use/http';
   ```

3. **Internal Packages** (core-service, core-service/access, etc.)
   ```typescript
   import { logger, createServiceAccessors } from 'core-service';
   import { matchAnyUrn } from 'core-service/access';
   ```

4. **Local Imports** (relative paths: `./`, `../`)
   ```typescript
   import { db, redis } from './accessors.js';
   import { rolesToArray, normalizeUser } from './utils.js';
   import { SYSTEM_CURRENCY } from '../constants.js';
   ```

5. **Type-Only Imports** (can be mixed with regular imports or separate group)
   ```typescript
   import type { UserContext, ResolverContext } from 'core-service';
   import type { RegisterInput, LoginInput } from './types.js';
   ```

**Best Practices**:
- Use blank lines to separate groups
- Within each group, sort alphabetically (optional but recommended)
- Type-only imports (`import type`) can be:
  - Mixed with regular imports in the same group (if from same source)
  - Separated into their own group at the end (if many type imports)
- Keep related imports together (e.g., all GraphQL imports together)

**Example** (Good):
```typescript
// Node.js built-ins
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// External packages
import { Server as SocketIOServer } from 'socket.io';
import { GraphQLSchema, GraphQLObjectType } from 'graphql';

// Internal packages
import { logger, createServiceAccessors } from 'core-service';
import { matchAnyUrn } from 'core-service/access';

// Local imports
import { db, redis } from './accessors.js';
import { rolesToArray } from './utils.js';
import { SYSTEM_CURRENCY } from '../constants.js';

// Type imports (can be mixed or separate)
import type { UserContext, ResolverContext } from 'core-service';
import type { RegisterInput } from './types.js';
```

#### General Import Rules
- **Always**: Remove unused imports
- **Always**: Use consistent import styles across similar files
- **Never**: Remove imports without checking:
  - Dynamic imports (`import()`)
  - Re-exports from the same file
  - Type-only imports that might be used in type definitions
  - Imports used in JSDoc comments

### Exports
- **Always**: Remove unused exports
- **Always**: Check if exports are used in other files before removing
- **Always**: Remove exports that are no longer needed (no backward compatibility concerns pre-production)
- **Never**: Remove exports that are re-exported elsewhere
- **Note**: After production/release, backward compatibility rules will apply

### Dynamic Imports
- **Always**: Verify dynamic imports are necessary (circular dependencies, code splitting)
- **Always**: Check if statically imported alternatives exist
- **Never**: Use dynamic imports when static imports work

---

## 📦 Package & Dependency Conventions

### Core-Service as Dependency Provider

**Principle**: `core-service` provides shared dependencies for all microservices. This avoids duplication and ensures version consistency.

**Core-Service Dependencies** (provided to all services):
- `tsx` - TypeScript execution runtime
- `typescript` - TypeScript compiler
- `graphql` - GraphQL runtime
- `mongodb` - MongoDB driver
- `redis` - Redis client
- `jsonwebtoken` - JWT handling
- And other shared infrastructure

### Microservice package.json Pattern

**Microservices** (auth-service, payment-service, bonus-service, kyc-service, notification-service):

```json
{
  "name": "service-name",
  "version": "1.0.0",
  "description": "Service description",
  "type": "module",
  "scripts": {
    "start": "node ../core-service/node_modules/tsx/dist/cli.mjs src/index.ts",
    "dev": "node ../core-service/node_modules/tsx/dist/cli.mjs watch src/index.ts",
    "build": "node ../core-service/node_modules/typescript/bin/tsc",
    "build:run": "npm run build && npm start",
    "test": "node ../core-service/node_modules/tsx/dist/cli.mjs src/test.ts",
    "infra:generate": "service-infra generate -c infra.config.json --all",
    "infra:preview": "service-infra generate -c infra.config.json --all --dry-run",
    "infra:docker": "service-infra generate -c infra.config.json --dockerfile --compose",
    "infra:k8s": "service-infra generate -c infra.config.json --k8s"
  },
  "dependencies": {
    "core-service": "file:../core-service"
    // Only add service-specific dependencies (e.g., passport for auth)
  },
  "devDependencies": {
    // Only @types/* for service-specific dependencies
    // NO tsx, typescript - these come from core-service
  }
}
```

**Key Rules**:
- ✅ **Always**: Depend on `core-service` via `file:../core-service`
- ✅ **Always**: Include infra scripts for Docker/K8s generation
- ✅ **Always**: Only add service-specific dependencies
- ✅ **Always**: Prefer Node.js built-in modules over external packages (see below)
- ❌ **Never**: Add `tsx` or `typescript` to devDependencies (they come from core-service)
- ❌ **Never**: Add `graphql`, `mongodb`, `redis` directly (they come from core-service)
- ❌ **Never**: Depend on other microservices directly (use event-driven communication)
- ❌ **Never**: Add packages with native bindings (e.g., bcrypt) - use built-in alternatives

### Prefer Node.js Built-in Modules

**Principle**: Minimize external dependencies by using Node.js built-in modules. This avoids:
- Native module compilation issues in Docker/Alpine
- Version conflicts and security vulnerabilities
- Unnecessary package bloat

**Common Replacements**:

| Instead of | Use | Reason |
|------------|-----|--------|
| `bcrypt` | `node:crypto` (scrypt) | Native compilation issues in Alpine Linux |
| `uuid` | `node:crypto` (randomUUID) | Built-in since Node 14.17 |
| `lodash.get` | Optional chaining (`?.`) | ES2020 feature |
| `moment` | `Intl.DateTimeFormat` / native Date | Built-in |

**Password Hashing with node:crypto**:

```typescript
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SCRYPT_KEYLEN = 64;
const SALT_LENGTH = 16;

// Hash password
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const derivedKey = await scryptAsync(password, salt, SCRYPT_KEYLEN) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

// Verify password (timing-safe)
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, storedKey] = hash.split(':');
  if (!salt || !storedKey) return false;
  const derivedKey = await scryptAsync(password, salt, SCRYPT_KEYLEN) as Buffer;
  const storedKeyBuffer = Buffer.from(storedKey, 'hex');
  if (derivedKey.length !== storedKeyBuffer.length) return false;
  return timingSafeEqual(derivedKey, storedKeyBuffer);
}
```

### Standalone/Shared Package Pattern

**Standalone packages** (access-engine, shared-validators) that need to work independently or in browser:

```json
{
  "name": "package-name",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.x.x"
    // Own typescript since not depending on core-service
  }
}
```

**Key Rules**:
- ✅ These packages keep their own `typescript` in devDependencies
- ✅ They do NOT depend on `core-service` (to stay client-safe/standalone)
- ✅ They can be used in React apps, other projects, etc.

### shared-validators Package

**Purpose**: Client-safe validators and utilities. Pure functions with no database dependencies. Used by the React app and services.

**Usage**:
```typescript
import { BonusEligibility, KYCEligibility, decodeJWT, isExpired } from 'shared-validators';

// JWT (client-safe decode only; no verification)
const payload = decodeJWT(accessToken);
if (payload && isExpired(payload)) { /* refresh or clear */ }

// Bonus eligibility
const result = BonusEligibility.check(template, { kycTier: 'standard' });

// KYC transaction limits
const txResult = KYCEligibility.checkTransaction(limits, {
  currentTier: 'basic',
  transactionType: 'withdrawal',
  amount: 500,
  currency: 'EUR',
});

// Tier requirements
const requirements = KYCEligibility.getTierRequirements('enhanced');
```

**Exports**:
- `decodeJWT`, `isExpired`, `JwtPayload` – client-safe JWT decode (e.g. auth-context, token expiry checks)
- `BonusEligibility` – bonus template eligibility (active, date range, tier, country, KYC tier)
- `KYCEligibility` – transaction limits, tier requirements, action permissions

**Key Principles**:
- All types are self-contained (no external dependencies)
- Pure functions / static classes
- No database calls – validation and decode only
- Same code runs on client and server


### Inter-Service Communication

**Services do NOT depend on each other**. Communication is event-driven:

```typescript
// ✅ Correct: Event-driven communication
import { emit, on } from 'core-service';

// Emit event from payment-service
await emit('payment.completed', tenantId, userId, { paymentId, amount });

// Listen in bonus-service
on('payment.completed', async (event) => {
  // Handle payment completion
});

// ❌ Wrong: Direct service dependency
// "notification-service": "file:../notification-service"  // DON'T DO THIS
```

### When to Create Shared Packages

Only create a shared package (like `shared-validators`) when:
1. **Client-side validation is needed** - Logic must run in browser
2. **Types are shared across client and server** - Need same types in React app
3. **The code is truly platform-agnostic** - No Node.js dependencies

**Don't create shared packages for**:
- Server-only code (keep in the service)
- Types only used by one service
- Code that could use event-driven communication instead

---

## 🔧 TypeScript Best Practices

### Type Safety
- **Always**: Fix type errors properly (don't use `any` unless necessary)
- **Always**: Match TypeScript interfaces with GraphQL schemas
- **Always**: Use proper type guards and narrowing
- **Never**: Ignore type errors with `@ts-ignore` without justification

### Interfaces & Types
- **Always**: Keep interfaces consistent with their usage
- **Always**: Update TypeScript types when GraphQL schemas change
- **Always**: Use descriptive type names
- **Never**: Create duplicate or conflicting type definitions

### Unused Variables
- **Always**: Check if variables are used before removing:
  - State setters (`setState`) - keep even if state is unused
  - Destructured variables that might be used conditionally
  - Variables used in comments or documentation
- **When unused**: Prefix with `_` or remove if truly unused

### Modern TypeScript Patterns
- **Always**: Use destructuring instead of nested property access
  - ❌ **Wrong**: `const value = obj.property.nestedProperty.deepProperty;`
  - ✅ **Right**: `const { property: { nestedProperty: { deepProperty: value } } } = obj;`
  - ✅ **Right**: `const { nestedProperty } = obj.property; const { deepProperty: value } = nestedProperty;`
- **Always**: Use destructuring for function parameters
  - ❌ **Wrong**: `function process(data) { const id = data.user.id; const name = data.user.name; }`
  - ✅ **Right**: `function process({ user: { id, name } }: DataType) { ... }`
- **Always**: Use destructuring for array elements
  - ❌ **Wrong**: `const first = arr[0]; const second = arr[1];`
  - ✅ **Right**: `const [first, second] = arr;`
- **Always**: Use optional chaining with destructuring when properties might be undefined
  - ✅ **Right**: `const { user } = data; const { name } = user ?? {};`
- **Always**: Use rest/spread operators for modern patterns
  - ✅ **Right**: `const { id, ...rest } = user; const updated = { ...user, name: 'New' };`

---

## 🏗️ Architecture Patterns

### Core-Service Architecture
- **Core-Service is the Single Source of Truth**: Provides shared database abstractions, utilities, and patterns
- **Microservices Extend Core-Service**: Each microservice adds specialized functionality on top
- **Never**: Add service-specific logic to `core-service`
- **Never**: Import `mongodb` or `redis` directly in microservices - always use `core-service` exports
- **Always**: Use database types from `core-service` (`Db`, `ClientSession`, `Collection`, etc.)
- **Pattern**: `core-service` provides database abstractions and utilities, microservices use them for business logic

### Microservices
- **Always**: Build services in dependency order
- **Always**: Verify dependencies are correctly declared
- **Always**: Check for circular dependencies
- **Never**: Import services directly (use through `core-service`)
- **Always**: Extend `core-service` patterns rather than duplicating code

### Service Ports

| Service | Port | GraphQL Endpoint |
|---------|------|------------------|
| auth-service | 9001 | http://localhost:9001/graphql |
| payment-service | 9002 | http://localhost:9002/graphql |
| bonus-service | 9003 | http://localhost:9003/graphql |
| notification-service | 9004 | http://localhost:9004/graphql |
| kyc-service | 9005 | http://localhost:9005/graphql |

**Next available port**: 9006

### Gateway Routing Strategy

The system supports multiple gateway deployment strategies:

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `per-service` | Each service has own gateway (default) | Production, independent scaling |
| `shared` | All services in one gateway process | Development, small projects |
| `per-brand` | Brand-specific gateways | White-label platforms |

#### Header-Based Routing (per-service mode)

In per-service mode, nginx routes requests based on the `X-Target-Service` header:

```
Client → /graphql + X-Target-Service: payment → nginx → payment-service:9002
```

**Client Usage:**
```typescript
// GraphQL client sets header for routing
const client = new GraphQLClient('/graphql', {
  headers: {
    'X-Target-Service': 'payment',  // auth|payment|bonus|kyc|notification
    'Authorization': `Bearer ${token}`,
  }
});
```

**Generating nginx config:**
```typescript
import { generateMultiServiceInfra, createDefaultGatewayRoutingConfig } from 'core-service';

// Generate gateway infrastructure
await generateMultiServiceInfra(createDefaultGatewayRoutingConfig(), {
  outputDir: './infra',
  nginx: true,
  dockerCompose: true,
});
```

**Default services configuration:**
```typescript
const gatewayConfig: GatewayRoutingConfig = {
  strategy: 'per-service',
  port: 9999,
  defaultService: 'auth',
  services: [
    { name: 'auth', host: 'auth-service', port: 9001 },
    { name: 'payment', host: 'payment-service', port: 9002 },
    { name: 'bonus', host: 'bonus-service', port: 9003 },
    { name: 'notification', host: 'notification-service', port: 9004 },
    { name: 'kyc', host: 'kyc-service', port: 9005 },
  ],
};
```

#### Gateway Orchestration Folder

The `gateway/` folder is the central orchestration point for infrastructure:

```bash
cd gateway

# Start all services (dev config)
npm run dev

# Check service health
npm run health

# Generate all infrastructure configs
npm run generate:all
```

#### Configuration Profiles

Configuration files follow the pattern `gateway/configs/services.{mode}.json`:

| Mode | File | Description |
|------|------|-------------|
| `dev` (default/ms) | `services.dev.json` | Single MongoDB/Redis, all 5 services (default) |
| `test` | `services.test.json` | Standalone stack; distinct ports (gateway 9998). Uses `infra.test.json`. |
| `combo` | `services.combo.json` | Reuses ms Redis/Mongo/auth; deploys gateway + KYC only. Deploy ms first. Uses `infra.combo.json`. |
| `shared` | `services.shared.json` | MongoDB Replica Set, Redis Sentinel |
| `{brand}` | `services.{brand}.json` | Custom brand-specific config |

**Using different configs:**
```bash
# Default (dev config)
npm run dev
npm run health
npm run generate

# Shared/production config
npm run dev:shared
npm run health:shared
npm run generate:shared

# Custom brand config (copy from existing, then use)
cp configs/services.dev.json configs/services.acme.json
npm run dev -- --config=acme
npm run health -- --config=acme
npm run generate -- --config=acme
```

**Config structure:**
```json
{
  "mode": "per-service",
  "description": "Description for logging",
  "gateway": { "port": 9999, "defaultService": "auth", "rateLimit": 100 },
  "services": [...],
  "infrastructure": {
    "mongodb": { "mode": "single|replicaSet", ... },
    "redis": { "mode": "single|sentinel", ... }
  },
  "environments": { "local": {...}, "docker": {...}, "prod": {...} }
}
```

**Key files:**
- `gateway/configs/services.json` - Single source of truth for all services
- `gateway/scripts/generate.ts` - Generates nginx, docker, k8s configs
- `gateway/generated/` - Output folder (gitignored)

See `gateway/README.md` for full documentation.

---

## 🚀 Creating a New Microservice

### Service Structure

Every microservice follows this standard structure (aligned with the service generator). Use a single **accessors** module for db + redis; do not add separate `database.ts` or `redis.ts` re-exports.

```
service-name/
├── src/
│   ├── index.ts           # Entry point with createGateway; imports from ./accessors.js
│   ├── accessors.ts       # db + redis via createServiceAccessors (single factory call)
│   ├── config.ts          # Service configuration (getServiceConfigKey only)
│   ├── config-defaults.ts # registerServiceConfigDefaults values
│   ├── error-codes.ts     # SERVICE_ERRORS, SERVICE_ERROR_CODES (use with GraphQLError only; no throw new Error in resolver path)
│   ├── graphql.ts         # Types + createResolvers
│   ├── services/
│   │   └── feature.ts     # createService definitions
│   ├── repositories/
│   │   └── feature-repository.ts  # Extends BaseRepository; import db from ../accessors.js
│   └── types/
│       └── feature-types.ts
├── package.json
└── tsconfig.json
```

### Step 1: Create package.json

```json
{
  "name": "service-name",
  "version": "1.0.0",
  "description": "Service description",
  "type": "module",
  "scripts": {
    "start": "node ../core-service/node_modules/tsx/dist/cli.mjs src/index.ts",
    "dev": "node ../core-service/node_modules/tsx/dist/cli.mjs watch src/index.ts",
    "build": "node ../core-service/node_modules/typescript/bin/tsc",
    "build:run": "npm run build && npm start",
    "test": "node ../core-service/node_modules/tsx/dist/cli.mjs src/test.ts"
  },
  "dependencies": {
    "core-service": "file:../core-service"
  }
}
```

### Step 2: Create accessors (`accessors.ts`) – db + redis in one call

Use a single **accessors** module. Do not create separate `database.ts` or `redis.ts`; all code imports `db` and `redis` from `./accessors.js`.

```typescript
/**
 * {ServiceName} service accessors (db + redis) from one factory call.
 * Per-service database: {service_name}.   (or: Uses core_service database. for auth)
 */

import { createServiceAccessors } from 'core-service';

export const { db, redis } = createServiceAccessors('service-name');

// Auth-service uses shared DB: createServiceAccessors('auth-service', { databaseServiceName: 'core-service' });
```

**Usage in service code:**
- `await db.initialize({ brand, tenantId });` then `const database = await db.getDb();`
- `await redis.initialize({ brand });` then `await redis.set('key', value, ttl);` / `redis.get<T>('key')`
- All other files import: `import { db, redis } from './accessors.js';` or `from '../accessors.js';`

### Step 3: Create Service with GraphQL (`services/feature.ts`)

```typescript
import { createService, type SagaContext, type Repository, buildConnectionTypeSDL, buildSagaResultTypeSDL, timestampFieldsSDL } from 'core-service';
import { type } from 'arktype';

// Define input validation schema
const createFeatureSchema = type({
  name: 'string',
  'description?': 'string',
});

// Define TypeScript types
interface Feature {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateFeatureInput {
  name: string;
  description?: string;
}

// Define saga steps
type FeatureCtx = SagaContext<Feature, CreateFeatureInput>;

const featureSaga = [
  {
    name: 'createFeature',
    critical: true,
    execute: async ({ input, data, ...ctx }: FeatureCtx): Promise<FeatureCtx> => {
      const repo = data._repository as Repository<Feature>;
      
      const feature = {
        tenantId: 'default',
        name: input.name,
        description: input.description,
        status: 'active',
      };
      
      const created = await repo.create(feature as any);
      return { ...ctx, input, data, entity: created };
    },
    compensate: async ({ entity, data }: FeatureCtx) => {
      if (entity) {
        const repo = data._repository as Repository<Feature>;
        await repo.delete(entity.id);
      }
    },
  },
];

// Create the service
export const featureService = createService<Feature, CreateFeatureInput>({
  name: 'feature',
  entity: {
    name: 'feature',
    collection: 'features',
    // Use SDL helpers from core-service (single source of truth – no inline duplication)
    graphqlType: `
      type Feature {
        id: ID!
        tenantId: String!
        name: String!
        description: String
        status: String!
        ${timestampFieldsSDL()}
      }

      ${buildConnectionTypeSDL('FeatureConnection', 'Feature')}
      ${buildSagaResultTypeSDL('CreateFeatureResult', 'feature', 'Feature')}
    `,
    graphqlInput: `input CreateFeatureInput { name: String! description: String }`,
    validateInput: (input) => {
      const result = createFeatureSchema(input);
      if (result instanceof type.errors) {
        return { errors: result.summary.split('\n') };
      }
      return result as CreateFeatureInput;
    },
    indexes: [
      { fields: { tenantId: 1 } },
      { fields: { name: 1, tenantId: 1 }, options: { unique: true } },
      { fields: { status: 1, tenantId: 1 } },
    ],
  },
  saga: featureSaga,
});
```

### Step 4: Create Entry Point (`index.ts`)

Keep import order: core-service → accessors → local. Index header should include: "Aligned with service generator scaffold (accessors, config, createGateway). Domain-specific code below."

```typescript
/**
 * {ServiceName} Service
 * Aligned with service generator scaffold (accessors, config, createGateway). Domain-specific code below.
 *
 * (Domain description...)
 */

import {
  createGateway,
  logger,
  configureRedisStrategy,
  type ResolverContext,
  type GatewayConfig,
  GraphQLError,
} from 'core-service';
import { db, redis } from './accessors.js';

import { loadConfig, validateConfig, printConfigSummary, SERVICE_NAME } from './config.js';
import { SERVICE_ERRORS } from './error-codes.js';
import { featureService } from './services/feature.js';

// Configuration from config store only (no process.env in microservices)
const context = await resolveContext();
const config = await loadConfig(context.brand, context.tenantId);

// Helper functions for resolvers (use GraphQLError + error code, never throw new Error)
function getUserId(ctx: ResolverContext): string {
  const userId = ctx.user?.id || ctx.user?.userId;
  if (!userId) throw new GraphQLError(SERVICE_ERRORS.Unauthorized, {});
  return userId;
}

function getTenantId(ctx: ResolverContext): string {
  return ctx.user?.tenantId || 'default';
}

// Custom type definitions (extend the service types)
const customTypeDefs = `
  extend type Query {
    myFeatures: [Feature!]!
  }
`;

// Custom resolvers (signature: (args, ctx) - NO parent parameter)
const customResolvers = {
  Query: {
    myFeatures: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const userId = getUserId(ctx);
      const tenantId = getTenantId(ctx);
      // Custom query logic here
      return [];
    },
  },
};

// Build gateway configuration
function buildGatewayConfig(): GatewayConfig {
  return {
    port: config.port,
    serviceName: 'service-name',
    mongoUri: config.mongoUri,
    typeDefs: customTypeDefs,
    resolvers: customResolvers,
    services: [featureService],
    contextBuilder: (req) => ({
      user: (req as any).user,
      tenantId: (req as any).user?.tenantId || 'default',
    }),
  };
}

// Main startup
async function main() {
  logger.info('Starting service-name...');

  // Start gateway (handles MongoDB connection)
  await createGateway(buildGatewayConfig());

  logger.info(`Service started on port ${config.port}`);

  // Initialize Redis accessor (after gateway)
  if (config.redisUrl) {
    try {
      await configureRedisStrategy({
        strategy: 'shared',
        defaultUrl: config.redisUrl,
      });
      await redis.initialize({ brand: 'default' });
      logger.info('Redis accessor initialized');
    } catch (err) {
      logger.warn('Could not initialize Redis', {
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }
}

main().catch((err) => {
  logger.error('Failed to start service', { error: err.message });
  process.exit(1);
});
```

### GraphQL Resolver Signature

**Critical**: Custom resolvers use `(args, ctx)` signature, NOT `(parent, args, ctx)`.

```typescript
// ✅ Correct: (args, ctx) signature
const customResolvers = {
  Query: {
    myQuery: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const userId = args.userId as string;
      return result;
    },
  },
  Mutation: {
    myMutation: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const input = args.input as MyInput;
      return result;
    },
  },
};

// ❌ Wrong: (parent, args, ctx) signature - causes type errors
const wrongResolvers = {
  Query: {
    myQuery: async (_parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
      // This will NOT work with core-service!
    },
  },
};
```

### Resolver error handling (GraphQLError only)

**Critical**: In **resolver-path code** (resolvers, saga steps, and any code called from them), **do not** use `throw new Error('message')`. Use **`GraphQLError`** with a code from the service's `error-codes.ts` so errors are discoverable and consistent for clients and i18n.

- **Always**: Throw `throw new GraphQLError(SERVICE_ERRORS.SomeCode, { ...context })` (e.g. `SERVICE_ERRORS.NotFound`, `SERVICE_ERRORS.Unauthorized`). Add context (ids, field names) in the second argument for debugging and i18n.
- **Never**: Use `throw new Error('any string message')` in resolvers, saga steps, or services invoked from resolvers.
- **Exception**: Config validation, bootstrap, and scripts (e.g. `config.ts` validate, `index.ts` "Configuration not loaded yet") may still use `throw new Error` for startup failures; only **resolver-visible** errors must use GraphQLError.

```typescript
// ✅ Correct: use GraphQLError with error code from error-codes.ts
import { GraphQLError } from 'core-service';
import { SERVICE_ERRORS } from './error-codes.js';

function getUserId(ctx: ResolverContext): string {
  const userId = ctx.user?.id || ctx.user?.userId;
  if (!userId) throw new GraphQLError(SERVICE_ERRORS.Unauthorized, {});
  return userId;
}
```

```typescript
// ❌ Wrong: throw new Error with string message (forbidden in resolver path)
if (!userId) throw new Error('Unauthorized');
if (!entity) throw new Error(`Item ${id} not found`);
```

Every service has `error-codes.ts` with `SERVICE_ERRORS` and `SERVICE_ERROR_CODES`. Add new codes there when needed; use them with `GraphQLError` only.

### GraphQL Type Naming Convention

When using `createService`, the result type must follow this naming convention:

```typescript
// Entity name: "feature" → Result type: "CreateFeatureResult"
// Entity name: "kycDocument" → Result type: "CreateKycDocumentResult" (note: Kyc not KYC)
// Entity name: "kycVerification" → Result type: "CreateKycVerificationResult"

graphqlType: `
  type Feature { ... }
  type FeatureConnection { ... }
  type CreateFeatureResult { success: Boolean! feature: Feature sagaId: ID! errors: [String!] }
`,
```

### Avoiding Duplicate Query Names

If `createService` generates a query (e.g., `feature(id: ID!)`) and you need a custom query with similar purpose, use a different name:

```typescript
// ❌ Wrong: Duplicate query name
extend type Query {
  feature(userId: String!): Feature  # Conflicts with auto-generated feature(id: ID!)
}

// ✅ Correct: Use unique name
extend type Query {
  featureByUserId(userId: String!): Feature  # No conflict
}
```

---

### Access Engine Usage (RBAC/HBAC/URN)
- **React App**: Import directly from `access-engine` package
  ```typescript
  import { hasRole, can, matchUrn } from 'access-engine';
  ```
- **Microservices**: Use through `core-service` (not direct imports)
  ```typescript
  import { hasRole, can, matchUrn } from 'core-service/access';
  ```
- **URN-Based Permissions**: Use URN format `resource:action:target` (e.g., `wallet:read:own`, `transfer:create:*`)
- **Role-Based Access Control (RBAC)**: Use `hasRole()`, `hasAnyRole()` for role checks
- **Hierarchy-Based Access Control (HBAC)**: Use role inheritance and context-based roles
- **Always**: Verify access-engine usage matches this pattern
- **Never**: Import `access-engine` directly in microservices - always use `core-service/access`

### Event-Driven Communication
- **Pattern**: Use `core-service` event system for inter-service communication
- **Emit Events**: Use `emit()` from `core-service/common/integration`
  ```typescript
  import { emit } from 'core-service/common/integration';
  await emit('payment.processed', tenantId, userId, { paymentId, amount });
  ```
- **Listen to Events**: Use `on()` to register handlers
  ```typescript
  import { on, startListening } from 'core-service/common/integration';
  on('payment.processed', async (event) => {
    // Handle event
  });
  await startListening();
  ```
- **Event Format**: Follow `IntegrationEvent<T>` structure (eventId, eventType, timestamp, tenantId, userId, data)
- **Never**: Use direct HTTP calls between services - use events instead
- **Always**: Services define their own event types - `core-service` provides generic pub/sub infrastructure

### Dependencies & Infrastructure
- **Core-Service**: Provides (single source of truth):
  - **Accessors**: `createServiceAccessors(serviceName, options?)` returns `{ db, redis }` in one call; microservices use a single `accessors.ts` and import from `./accessors.js` (no separate `database.ts` or `redis.ts`).
  - Database abstractions (`createServiceDatabaseAccess`, `createServiceAccessors`, `getDatabase`, `getClient`, `connectDatabase`)
  - Database utilities (`findOneById`, `paginateCollection`, `buildIdQuery`, `createUniqueIndexSafe`, `normalizeWalletForGraphQL`)
  - Database types (`Db`, `ClientSession`, `Collection`, `Filter`, `MongoClient`)
  - Redis abstractions (`createServiceRedisAccess`, `configureRedisStrategy`; prefer `createServiceAccessors` for new code)
  - Generic utilities (logging, retry, circuit breaker, `getErrorMessage`, `getServiceConfigKey`)
  - Generic patterns (saga, gateway, event system, `withEventHandlerError`, `createTransferRecoverySetup`, `buildConnectionTypeSDL`, `timestampFieldsSDL` / `timestampFieldsRequiredSDL` / `timestampFieldsOptionalSDL`, `buildSagaResultTypeSDL`, `paginationArgsSDL`)
  - Type definitions and interfaces (e.g. `NotificationHandlerPlugin`, `HandlerContext` in core-service)
  - Shared helpers (pagination, validation, wallet operations)
- **Core-Service**: Must NOT include:
  - Service-specific database schemas
  - Service-specific business logic
  - Domain-specific types (these belong in services)
- **Microservices**: 
  - **Always**: Import database types from `core-service`, never from `mongodb` directly
  - **Always**: Use `core-service` utilities for database operations
  - Include their own business logic implementations
  - Define their own domain-specific types and schemas

### MongoDB Best Practices (Driver 7.x)

This project uses **MongoDB Node.js Driver 7.x**. Follow these practices:

**Database Access Pattern**:
```typescript
// ✅ Correct: Single accessors module (db + redis from one factory)
// In accessors.ts:
import { createServiceAccessors } from 'core-service';
export const { db, redis } = createServiceAccessors('payment-service');

// In other files: import { db } from './accessors.js'; or from '../accessors.js';

// Initialize once at startup (in index)
await db.initialize({ brand, tenantId });

// Use in service code
const database = await db.getDb();
const collection = database.collection('wallets');
```

**Connection Pool Monitoring** - Use event-based tracking:
```typescript
// ✅ Correct: Event-based stats via accessor
const stats = getConnectionPoolStats();  // { totalConnections, checkedOut }
const health = await db.checkHealth();   // includes connections & latency

// ❌ Wrong: Never access internal topology (not a public API)
// client.topology?.s?.pool?.totalConnectionCount
```

**Index Creation** - No deprecated options:
```typescript
// ✅ Correct: Modern options only
db.registerIndexes('collection', [
  { key: { field: 1 }, unique: true },
  { key: { field: -1 }, sparse: true },
]);

// ❌ Wrong: 'background' is deprecated in MongoDB 4.2+
// { key: { field: 1 }, background: true }
```

**Transactions** - Use `withTransaction`:
```typescript
// ✅ Correct: withTransaction helper or session.withTransaction
import { withTransaction } from 'core-service';

await withTransaction({
  client: db.getClient(),
  fn: async (session) => {
    await col1.updateOne({...}, {...}, { session });
    await col2.insertOne({...}, { session });
  },
});
```

**Deprecated/Removed Options** - Never use:
- `useNewUrlParser`, `useUnifiedTopology`, `useFindAndModify`, `useCreateIndex` - Removed in driver 4.0+
- `background` (index option) - Deprecated in MongoDB 4.2+
- Internal topology access (`client.topology?.s?.pool`) - Not a public API

### Redis Best Practices (node-redis v5)

This project uses **node-redis v5.10.0+**. Follow these practices:

**Service Redis Accessor Pattern**:
```typescript
// ✅ Correct: Obtain redis from accessors.ts (same file as db)
import { db, redis } from './accessors.js';

// Initialize with brand context (in index, after gateway/config)
await redis.initialize({ brand: 'acme' });

// Keys are auto-prefixed: {brand}:{service}:{key}
await redis.set('tx:123', { status: 'pending' }, 300);
const value = await redis.get<T>('tx:123');
```

**Key Scanning** - Use SCAN iterator, NOT KEYS:
```typescript
// ✅ Correct: SCAN iterator (non-blocking, production-safe)
import { scanKeysIterator, scanKeysArray } from 'core-service';
const keys = await scanKeysArray({ pattern: 'user:*', maxKeys: 1000 });

// Or use accessor's pattern methods
const keys = await redis.keys('tx:*');  // Uses SCAN internally
await redis.deletePattern('expired:*'); // Uses SCAN internally

// ❌ Wrong: KEYS command blocks entire Redis server
// await client.keys('user:*');  // DO NOT USE - blocks Redis!
```

**Pattern Deletion** - Use SCAN-based deletion:
```typescript
// ✅ Correct: Uses SCAN internally (non-blocking)
import { deleteCachePattern } from 'core-service';
await deleteCachePattern('user:*');

// ❌ Wrong: KEYS + DEL blocks Redis
// const keys = await client.keys('user:*');
// await client.del(keys);
```

**Read/Write Splitting** (when infrastructure supports):
```typescript
// ✅ Correct: Use dedicated functions
import { getRedis, getRedisForRead, hasReadReplica } from 'core-service';

const master = getRedis();        // Always use for writes
const reader = getRedisForRead(); // Use for reads (replica or master fallback)

// Check if replica available
if (hasReadReplica()) {
  // Read from replica
}
```

**Connection Features** (node-redis v5.10.0+):
- `keepAlive: true` - TCP keep-alive enabled by default
- `noDelay: true` - Nagle's algorithm disabled for lower latency
- Exponential backoff with jitter for reconnection
- `clientName` - Visible in `CLIENT LIST` for debugging
- `pingInterval` - Keep-alive for Azure Cache and similar

**Anti-Patterns to Avoid**:
- ❌ `KEYS *` - Blocks entire Redis server (use `scanKeysArray` instead)
- ❌ Large batch operations without pipelining
- ❌ Storing large values (>100KB) without compression
- ❌ Using Redis as primary database (use for cache/state only)

**Already Supported (HA + Read Scaling)**:
```typescript
// Master-slave with Sentinel (auto-failover)
await connectRedis({
  sentinel: { hosts: [{ host: 'sentinel1', port: 26379 }], name: 'mymaster' }
});

// Read replicas (read/write splitting)
await connectRedis({
  url: 'redis://master:6379',
  readReplicas: { enabled: true, urls: ['redis://replica1:6379'] }
});

// Per-brand Redis instances
await configureRedisStrategy({
  strategy: 'per-brand',
  defaultUrl: 'redis://default:6379',
  brandUrls: { 'brand-a': 'redis://brand-a:6379' }
});
```

**Future: Purpose-Based Segmentation (if needed at scale)**:
```typescript
// Segment by workload type (not yet implemented)
// REDIS_CACHE_URL=redis://cache:6379    // High churn, evictable
// REDIS_STATE_URL=redis://state:6379    // Recovery, pending ops
// REDIS_SESSION_URL=redis://session:6379 // Auth sessions

// Key prefix convention (already in use):
// {service}:{category}:{key}
// payment-service:cache:wallet:123
// auth-service:session:user:456
```

### Caching Best Practices (Multi-Level Cache)

This project uses a **multi-level cache** (Memory → Redis → Database). Follow these practices:

**Cache Layers**:
```
L1: Memory (~0.001ms) → L2: Redis (~0.5-2ms) → Database (~5-50ms)
```

**Cache API Usage**:
```typescript
// ✅ Correct: Use core-service cache functions
import { cached, getCache, setCache, getCacheMany, setCacheMany, warmCache } from 'core-service';

// Cache-aside pattern (preferred)
const user = await cached('user:123', 300, () => fetchUser('123'));

// Batch operations (use for multiple keys)
const values = await getCacheMany<User>(['user:1', 'user:2', 'user:3']);
await setCacheMany([
  { key: 'user:1', value: user1, ttl: 300 },
  { key: 'user:2', value: user2, ttl: 300 },
]);

// Cache warming (startup or periodic)
await warmCache([
  { key: 'config:app', fetchFn: () => loadConfig(), ttl: 3600 },
]);
```

**Pattern Deletion** - Use SCAN-based deletion:
```typescript
// ✅ Correct: Uses SCAN internally (non-blocking)
import { deleteCachePattern } from 'core-service';
await deleteCachePattern('user:*');

// ❌ Wrong: Manual pattern matching is inefficient
// for (const key of allKeys) { if (key.startsWith('user:')) await deleteCache(key); }
```

**Cache Key Conventions**:
```typescript
// ✅ Correct: Use createCacheKeys factory
import { createCacheKeys } from 'core-service';

const UserCache = createCacheKeys('user');
UserCache.one('123');      // 'user:123'
UserCache.list('active');  // 'users:active'
UserCache.pattern();       // 'user*'
```

**Best Practices**:
- ✅ Use `cached()` for cache-aside pattern (checks cache, fetches if miss, stores)
- ✅ Use batch operations (`getCacheMany`, `setCacheMany`) for multiple keys
- ✅ Use `deleteCachePattern()` for pattern-based invalidation (uses SCAN)
- ✅ Set appropriate TTLs (default: 300s, adjust based on data volatility)
- ✅ Use `warmCache()` for frequently accessed data at startup

**Anti-Patterns to Avoid**:
- ❌ Direct Redis access for caching (bypasses memory layer)
- ❌ Very long TTLs without invalidation strategy
- ❌ Caching user-specific data without proper key namespacing
- ❌ Forgetting to invalidate cache after data changes

**Hot Path Caching (Balance Reads) ⚠️**:

Balance reads are the #1 hot path at scale. Use write-through caching:

```typescript
// ✅ Correct: Write-through for balances
async function updateWalletBalance(walletId: string, newBalance: number) {
  // 1. Write to MongoDB (source of truth)
  await walletsCollection.updateOne({ id: walletId }, { $set: { balance: newBalance } });
  
  // 2. Write-through to Redis (non-blocking, outside transaction)
  setCache(`wallet:balance:${walletId}`, newBalance, 300).catch(() => {});
}

// ✅ Correct: Fast balance read
async function getWalletBalance(walletId: string): Promise<number> {
  // Fast path: Redis
  const cached = await getCache<number>(`wallet:balance:${walletId}`);
  if (cached !== null) return cached;
  
  // Slow path: MongoDB (populate cache on miss)
  const wallet = await findOneById(walletsCollection, walletId);
  if (wallet) await setCache(`wallet:balance:${walletId}`, wallet.balance, 300);
  return wallet?.balance ?? 0;
}

// ❌ Wrong: Always hitting MongoDB for balance
const wallet = await walletsCollection.findOne({ id: walletId });  // No cache!
return wallet.balance;
```

**Note**: This pattern is not yet implemented in core-service. See README "TODO - MongoDB Hot Path Scaling" for migration plan.

### GraphQL
- **Always**: Keep GraphQL schemas and TypeScript types in sync
- **Always**: Use cursor-based pagination (not offset)
- **Always**: Remove deprecated fields from both schema and types immediately (no backward compatibility needed pre-production)
- **Reuse**: For list types use `buildConnectionTypeSDL(connectionName, nodeTypeName)` from core; for common fields (e.g. `createdAt`, `updatedAt`) use `timestampFieldsSDL()`, `timestampFieldsRequiredSDL()`, or `timestampFieldsOptionalSDL()` from core so SDL is a single source of truth
- **Reuse**: For saga result types use `buildSagaResultTypeSDL(resultName, entityField, entityType, extraFields?)` from core; for pagination arguments use `paginationArgsSDL()` from core

#### GraphQL Schema ↔ TypeScript Type Sync Verification

**Manual Verification Checklist** (Run before each release):

1. **Input Types** - Verify GraphQL `input` types match TypeScript interfaces:
   - Check all `input` types in GraphQL schema (e.g., `RegisterInput`, `LoginInput`)
   - Verify corresponding TypeScript interfaces exist (e.g., `RegisterInput`, `LoginInput` in `types.ts`)
   - Verify field names match exactly (case-sensitive)
   - Verify required fields: GraphQL `!` = TypeScript non-optional field
   - Verify optional fields: GraphQL no `!` = TypeScript optional field (`?`)

2. **Output Types** - Verify GraphQL `type` definitions match TypeScript return types:
   - Check all `type` definitions in GraphQL schema (e.g., `User`, `AuthResponse`)
   - Verify resolver return types match GraphQL type structure
   - Verify field names match exactly
   - Verify nullable vs non-nullable: GraphQL `!` = TypeScript non-nullable

3. **Enum Types** - Verify GraphQL enums match TypeScript enums:
   - Check all `enum` definitions in GraphQL schema
   - Verify corresponding TypeScript enums exist
   - Verify enum values match exactly (case-sensitive)

4. **Query/Mutation Signatures** - Verify resolver function signatures:
   - Check GraphQL query/mutation argument types match resolver `args` types
   - Verify return types match GraphQL return types

**Automated Check** (Run `npm run verify:graphql-types` from `scripts/` directory):
- Basic validation script extracts GraphQL input types and compares with TypeScript interfaces
- Reports missing TypeScript interfaces, mismatched field names, and required/optional mismatches
- Automatically skips GraphQL-only input types (whitelisted - no TypeScript interface needed)
- Exits with code 0 (success) for warnings/GraphQL-only types, code 1 (failure) only for real type mismatches
- Safe to use in CI/CD pipelines
- See `scripts/typescript/verify-graphql-types.ts` for details
- **Note**: GraphQL-only input types (simple pass-through types used only in resolvers with `(args as any).input`) don't require TypeScript interfaces - this is acceptable and keeps code size minimal
- **Examples**: `UpdateUserRolesInput`, `UpdateUserPermissionsInput`, `UpdateUserStatusInput`, `SendNotificationInput` are GraphQL-only and automatically skipped

**When to Verify**:
- Before each release/deployment
- After adding new GraphQL types or inputs
- After modifying existing GraphQL schemas
- When TypeScript type errors occur in resolvers
- **Note**: After production/release, deprecation and backward compatibility policies will apply

### Saga, Transaction, and Recovery Boundaries ⚠️

**Critical Rule**: Each system has a distinct responsibility. Do NOT overlap.

| System | Responsibility | Scope |
|--------|----------------|-------|
| **MongoDB Transaction** | Local atomicity | Single service, multi-document |
| **Saga Engine** | Multi-step coordination | Cross-step operations |
| **Recovery System** | Crash repair only | Stuck operations (stale heartbeat) |

**Never Do**:
- ❌ Retry a saga step inside a MongoDB transaction
- ❌ Recover something a saga already compensated
- ❌ Use compensation mode (`useTransaction: false`) for financial operations

**Safe Patterns**:
```typescript
// ✅ Financial operations: Saga with transaction mode (REQUIRED)
sagaOptions: { useTransaction: true }  // MongoDB handles rollback

// ✅ Non-financial multi-step: Saga with compensation
sagaOptions: { useTransaction: false } // Manual compensate functions

// ✅ Standalone transfer: Self-managed transaction + recovery
createTransferWithTransactions(params); // No session = tracked by recovery

// ✅ Transfer inside saga transaction: Uses saga's session
createTransferWithTransactions(params, { session }); // Not tracked
```

**How It Works**:
1. When saga uses `useTransaction: true` → session passed to steps → MongoDB handles rollback
2. When `createTransferWithTransactions` gets session → uses it directly, **NO state tracking**
3. When `createTransferWithTransactions` has no session → creates own transaction + **state tracking enabled**
4. Recovery job only acts on operations with **stale heartbeats** (no update in 60s)
5. Successfully completed operations are marked and ignored by recovery

**Why This Matters**:
- If saga and recovery both try to handle the same operation → double transfer/reversal
- If compensation runs after recovery → inconsistent state
- Financial operations MUST use transactions for atomic rollback

**Recovery Job Scaling Note**:

Current recovery uses scan-based approach (O(total)):
```typescript
// Every 5 minutes, scans ALL operation_state:transfer:* keys
const keys = await scanKeysArray({ pattern: 'operation_state:transfer:*' });
for (const key of keys) { /* check if stuck */ }
```

**Mitigating factors:**
- ✅ TTLs bound key count (60s in-progress, 300s completed)
- ✅ SCAN not KEYS (non-blocking)

**At scale (10M users):** Consider event-driven recovery (O(stuck)) using Redis Sorted Sets or Streams. See README "TODO - Event-Driven Recovery" for implementation pattern.

---

## 🎨 Design Patterns

### Pattern-First Approach
- **Always**: Consider if a design pattern fits before implementing a solution
- **Always**: Search for existing patterns that solve similar problems
- **Always**: Review pattern implementations before coding from scratch
- **Reference**: See [Design Patterns in TypeScript](https://github.com/torokmark/design_patterns_in_typescript) for implementations
- **When to Apply**: If you find yourself repeating similar structures or facing common architectural problems, check if a pattern applies

### Creational Patterns

#### Singleton
- **When to Use**: Need exactly one instance of a class (e.g., database connection, logger, configuration manager)
- **Apply If**: Multiple instances would cause issues (resource conflicts, state inconsistency)
- **Example**: Service instances, connection pools, cache managers
- **Reference**: `singleton/singleton.ts`

#### Abstract Factory
- **When to Use**: Need to create families of related objects without specifying concrete classes
- **Apply If**: System needs to be independent of how products are created/composed/represented
- **Example**: Creating UI components for different themes, database adapters for different vendors
- **Reference**: `abstract_factory/abstractFactory.ts`

#### Factory Method
- **When to Use**: Need to create objects but let subclasses decide which class to instantiate
- **Apply If**: Class can't anticipate the class of objects it must create
- **Example**: Creating different notification providers (email, SMS, push), payment processors
- **Reference**: `factory_method/factoryMethod.ts`

#### Builder
- **When to Use**: Need to construct complex objects step by step
- **Apply If**: Object has many optional parameters or complex initialization
- **Example**: GraphQL query builders, configuration objects, request builders
- **Reference**: `builder/builder.ts`

#### Prototype
- **When to Use**: Need to create objects by cloning existing instances
- **Apply If**: Object creation is expensive and similar objects already exist
- **Example**: Template-based object creation, caching cloned objects
- **Reference**: `prototype/prototype.ts`

### Structural Patterns

#### Adapter
- **When to Use**: Need to make incompatible interfaces work together
- **Apply If**: Integrating third-party libraries or legacy code with different interfaces
- **Example**: Wrapping external APIs, adapting old service interfaces to new ones
- **Reference**: `adapter/adapter.ts`

#### Bridge
- **When to Use**: Need to separate abstraction from implementation so both can vary independently
- **Apply If**: Want to avoid permanent binding between abstraction and implementation
- **Example**: Platform-independent UI frameworks, database abstraction layers
- **Reference**: `bridge/bridge.ts`

#### Composite
- **When to Use**: Need to treat individual objects and compositions uniformly
- **Apply If**: Working with tree structures where nodes can be leaves or containers
- **Example**: File systems, UI component hierarchies, nested permissions
- **Reference**: `composite/composite.ts`

#### Decorator
- **When to Use**: Need to add behavior to objects dynamically without altering structure
- **Apply If**: Want to extend functionality without subclassing
- **Example**: Adding logging, caching, validation layers to services
- **Reference**: `decorator/decorator.ts`

#### Facade
- **When to Use**: Need to provide a simplified interface to a complex subsystem
- **Apply If**: Want to hide complexity and provide easy-to-use API
- **Example**: API gateways, service wrappers, simplified client interfaces
- **Reference**: `facade/facade.ts`

#### Flyweight
- **When to Use**: Need to support large numbers of fine-grained objects efficiently
- **Apply If**: Many objects share intrinsic state and only differ in extrinsic state
- **Example**: Character rendering in text editors, icon caching, shared configuration
- **Reference**: `flyweight/flyweight.ts`

#### Proxy
- **When to Use**: Need to provide a placeholder or surrogate for another object
- **Apply If**: Need lazy loading, access control, or remote object access
- **Example**: Lazy-loaded data, access control wrappers, API proxies
- **Reference**: `proxy/proxy.ts`

### Behavioral Patterns

#### Chain of Responsibility
- **When to Use**: Need to pass requests along a chain of handlers
- **Apply If**: Multiple objects can handle a request and handler isn't known a priori
- **Example**: Middleware chains, validation pipelines, event handlers
- **Reference**: `chain_of_responsibility/chainOfResponsibility.ts`

#### Command
- **When to Use**: Need to encapsulate requests as objects
- **Apply If**: Need to parameterize objects with operations, queue requests, or support undo
- **Example**: Transaction systems, undo/redo functionality, job queues
- **Reference**: `command/command.ts`

#### Interpreter
- **When to Use**: Need to define a grammar and interpret sentences in that language
- **Apply If**: Need to interpret domain-specific languages or expressions
- **Example**: Query parsers, rule engines, expression evaluators
- **Reference**: `interpreter/interpreter.ts`

#### Iterator
- **When to Use**: Need to access elements of a collection sequentially without exposing structure
- **Apply If**: Want to traverse collections in different ways without changing collection code
- **Example**: Cursor-based pagination, tree traversal, collection iteration
- **Reference**: `iterator/iterator.ts`

#### Mediator
- **When to Use**: Need to reduce coupling between classes that communicate
- **Apply If**: Many classes communicate directly and dependencies are complex
- **Example**: Event buses, chat systems, component communication
- **Reference**: `mediator/mediator.ts`

#### Memento
- **When to Use**: Need to capture and restore object state without violating encapsulation
- **Apply If**: Need undo functionality or state snapshots
- **Example**: Undo/redo systems, state restoration, checkpoint systems
- **Reference**: `memento/memento.ts`

#### Observer
- **When to Use**: Need to notify multiple objects about state changes
- **Apply If**: Change to one object requires changing others, and number of objects is unknown
- **Example**: Event systems, reactive programming, publish/subscribe patterns
- **Reference**: `observer/observer.ts`
- **Note**: Already used in our event-driven architecture (`core-service/common/integration`)

#### State
- **When to Use**: Object behavior changes based on its state
- **Apply If**: Object has many conditional statements that depend on object's state
- **Example**: State machines, workflow engines, game character states
- **Reference**: `state/state.ts`

#### Strategy
- **When to Use**: Need to define a family of algorithms and make them interchangeable
- **Apply If**: Multiple ways to perform a task and want to choose at runtime
- **Example**: Payment processing strategies, sorting algorithms, validation strategies
- **Reference**: `strategy/strategy.ts`

#### Template Method
- **When to Use**: Need to define skeleton of algorithm and let subclasses override steps
- **Apply If**: Algorithm structure is fixed but some steps vary
- **Example**: Base service classes, workflow templates, processing pipelines
- **Reference**: `template_method/templateMethod.ts`

#### Visitor
- **When to Use**: Need to perform operations on elements of object structure without changing classes
- **Apply If**: Operations vary but object structure is stable
- **Example**: AST traversal, report generation, type checking
- **Reference**: `visitor/visitor.ts`

### Pattern Selection Guidelines

1. **Before Implementing**: Search codebase and design patterns repository for similar solutions
2. **Match Problem to Pattern**: Identify the core problem (creation, structure, behavior) and find matching pattern
3. **Consider Complexity**: Simple problems may not need patterns - avoid over-engineering
4. **Check Existing Usage**: See if pattern is already used in codebase (e.g., Observer in event system)
5. **Document Pattern Usage**: When applying a pattern, document why it was chosen

### Patterns Already in Use

- **Observer**: Event-driven communication (`core-service/common/integration`)
- **Facade**: API Gateway (`core-service/gateway`)
- **Strategy**: Payment processors, notification providers
- **Factory**: Service creation (`core-service/saga`)
- **Template Method**: Base service classes, recovery handlers

---

## 🔄 Code Reuse & DRY Principles

### Avoid Code Duplication
- **Always**: Extract common patterns into reusable functions/utilities
- **Always**: Use shared structures instead of repeating if/else blocks with same structure
- **Never**: Copy-paste similar code blocks - refactor into shared utilities
- **Pattern**: If you see the same structure repeated 3+ times, extract it

### Shared Structures Pattern
- ❌ **Wrong**: Repeated if/else blocks with same structure
  ```typescript
  if (condition1) {
    validate(data1);
    process(data1);
    log(data1);
  } else {
    validate(data2);
    process(data2);
    log(data2);
  }
  // ... repeated elsewhere
  ```
- ✅ **Right**: Extract to shared function
  ```typescript
  function handleOperation<T>(data: T, condition: boolean) {
    validate(data);
    process(data);
    log(data);
  }
  handleOperation(condition1 ? data1 : data2, condition1);
  ```

### Generic Helpers in Core-Service
- **Always**: Add generic, reusable helpers to `core-service`
- **Examples**: `extractDocumentId()`, `retry()`, `circuitBreaker()`, pagination helpers; `getErrorMessage(error)` for consistent error messages; `getServiceConfigKey()` for config with optional gateway fallback; `createServiceAccessors()`, `buildConnectionTypeSDL()`, `timestampFieldsSDL()` / `timestampFieldsRequiredSDL()`, `createUniqueIndexSafe()`, `normalizeWalletForGraphQL()`, `withEventHandlerError()`, `createTransferRecoverySetup()`, notification handler plugin types (`NotificationHandlerPlugin`, `HandlerContext`)
- **Never**: Add service-specific logic to `core-service`
- **Pattern**: If a helper can be used by multiple services, it belongs in `core-service`

### Service Generator Alignment
- **Always**: New and existing microservices should look as if generated by the service generator (same structure, comments, naming). Only domain-specific code (resolvers, sagas, event handlers) should differ.
- **Accessors**: One `accessors.ts` per service with generator-style comment: "[Name] service accessors (db + redis) from one factory call." then "Per-service database: {name}_service." or "Uses core_service database." for auth.
- **Index**: Include the line "Aligned with service generator scaffold (accessors, config, createGateway). Domain-specific code below." in the top comment block; keep import order: core-service → accessors → local.

### Service-Specific Patterns
- **Always**: Create service-specific utilities when logic is unique to that service
- **Pattern**: Use `core-service` for generic patterns, service code for specifics
- **Example**: `core-service` provides `createTransferWithTransactions()`, service provides transfer validation rules

---

## 🧹 Code Cleanup Rules

**Note**: This project is pre-production. These rules will be updated after production/release to include backward compatibility and legacy code management.

### Code Removal (Pre-Production)
- **Always**: Search entire codebase for usages before removing
- **Always**: Check test scripts for dependencies
- **Always**: Update all usages to new patterns immediately
- **Always**: Remove code immediately when no longer needed (no backward compatibility concerns)
- **Never**: Keep deprecated code "for compatibility" - remove it directly

### Unused Code
- **Always**: Verify code is truly unused:
  - Search for function/variable name across codebase
  - Check for dynamic access (`obj[name]`)
  - Verify not used in templates/strings
- **When removing**: Remove immediately - no deprecation period needed
- **When removing**: Remove related comments and documentation

### Comments & Documentation
- **Always**: Remove outdated comments immediately
- **Always**: Update comments when code changes
- **Always**: Keep comments that explain "why" not "what"
- **Never**: Leave TODO/FIXME comments without context
- **Never**: Keep comments about "legacy" or "deprecated" code - remove the code instead

### Deprecated Code
- **Pre-Production**: Don't mark code as deprecated - remove it directly
- **Pre-Production**: No deprecation warnings or migration paths needed
- **After Production**: Deprecation policies will be established

---

## 🎯 Refactoring Guidelines

### Before Refactoring
1. **Understand the full scope**: Read all related files
2. **Identify all usages**: Search codebase for patterns
3. **Check design patterns**: Review if a design pattern would improve the structure
4. **Plan the changes**: List all files that need updates
5. **Check dependencies**: Verify build order and dependencies

### During Refactoring
1. **Make incremental changes**: One logical change at a time
2. **Maintain functionality**: Don't break existing features
3. **Update all usages**: Don't leave old patterns behind
4. **Test as you go**: Build and verify after each change

### After Refactoring
1. **Build everything**: Verify all services compile
2. **Check for errors**: Fix TypeScript/linter errors
3. **Verify consistency**: Ensure patterns are consistent
4. **Update documentation**: Reflect changes in docs

---

## 🚨 Common Pitfalls to Avoid

### 1. Partial View Changes
- ❌ **Wrong**: Fixing errors in one file without checking related files
- ✅ **Right**: Reviewing the entire component/service before changes

### 2. Assumptions About Unused Code
- ❌ **Wrong**: Removing code based on linter warnings alone
- ✅ **Right**: Searching codebase to verify it's truly unused

### 3. Inconsistent Patterns
- ❌ **Wrong**: Using different patterns in similar files
- ✅ **Right**: Following existing patterns consistently

### 4. Breaking Changes Without Updates
- ❌ **Wrong**: Removing code without checking for usages
- ✅ **Right**: Search codebase and update all usages before removing code
- **Note**: Pre-production, we can make breaking changes freely - just ensure all usages are updated

### 5. Type Mismatches
- ❌ **Wrong**: Ignoring type errors or using `any`
- ✅ **Right**: Fixing types properly to match schemas/interfaces

### 6. Nested Property Access
- ❌ **Wrong**: `const value = obj.property.nestedProperty.deepProperty;`
- ✅ **Right**: Use destructuring `const { property: { nestedProperty: { deepProperty: value } } } = obj;`

### 7. Code Duplication
- ❌ **Wrong**: Copy-pasting similar if/else blocks everywhere
- ✅ **Right**: Extract shared structures into reusable functions

### 8. Service-Specific Logic in Core-Service
- ❌ **Wrong**: Adding MongoDB models or Redis-specific code to `core-service`
- ✅ **Right**: Keep `core-service` generic, add specifics in microservices

### 9. Direct Access-Engine Imports in Services
- ❌ **Wrong**: `import { hasRole } from 'access-engine'` in microservices
- ✅ **Right**: `import { hasRole } from 'core-service/access'` in microservices

### 10. Direct Service-to-Service Communication
- ❌ **Wrong**: HTTP calls between services
- ✅ **Right**: Use event-driven communication via `core-service/common/integration`

### 11. Not Considering Design Patterns
- ❌ **Wrong**: Implementing custom solutions without checking if a design pattern fits
- ✅ **Right**: Review design patterns section and reference repository before implementing
- ✅ **Right**: Search codebase for existing pattern usage before creating new implementations

### 12. Wrong Resolver Signature ⚠️
- ❌ **Wrong**: `async (_parent, args, ctx) => { }` - Three-parameter signature
- ✅ **Right**: `async (args, ctx) => { }` - Two-parameter signature (core-service pattern)
- **Risk**: TypeScript errors and runtime failures

### 13. GraphQL Type Name Mismatch ⚠️
- ❌ **Wrong**: `CreateKYCDocumentResult` when entity name is `kycDocument`
- ✅ **Right**: `CreateKycDocumentResult` - matches entity name casing
- **Risk**: Schema extension errors on startup

### 14. Duplicate GraphQL Query Names ⚠️
- ❌ **Wrong**: Defining `kycProfile(userId: String!)` when `createService` generates `kycProfile(id: ID!)`
- ✅ **Right**: Use unique names like `kycProfileByUserId(userId: String!)`
- **Risk**: "Field can only be defined once" errors

### 15. Missing Redis/MongoDB Accessor ⚠️
- ❌ **Wrong**: Using `getRedis()` or raw DB without accessor initialization; or adding separate `database.ts` / `redis.ts` instead of a single `accessors.ts`
- ✅ **Right**: Use single `accessors.ts` with `createServiceAccessors('service-name')` exporting `{ db, redis }`; import from `./accessors.js`; initialize `db` and (if used) `redis` after gateway/config
- **Risk**: "Redis not connected" or "database not initialized" errors

### 16. Wrong Initialization Order ⚠️
- ❌ **Wrong**: Initialize event handlers before Redis is connected
- ✅ **Right**: Order: `createGateway()` → `configureRedisStrategy()` → `redis.initialize()` → `initializeEventHandlers()`
- **Risk**: Event handlers fail with connection errors

### 17. Index Options with Null Values ⚠️
- ❌ **Wrong**: `{ fields: { userId: 1 }, options: { sparse: someVar } }` where `someVar` might be `null`
- ✅ **Right**: Only include options with explicit boolean values, or omit optional options
- **Risk**: MongoDB error "sparse: null is not convertible to bool"

### 18. External Provider Calls Without Protection ⚠️
- ❌ **Wrong**: Calling external APIs (Twilio, SMTP, etc.) directly without circuit breaker
- ❌ **Wrong**: Fan-out to multiple channels without backpressure
- ✅ **Right**: Wrap external calls with `CircuitBreaker` from core-service
- ✅ **Right**: Use `retry()` with per-provider policies
- ✅ **Right**: Implement queue for async processing with concurrency limits
- **Risk**: Provider outages cause retry storms → system-wide latency amplifier

```typescript
// ✅ Correct: Protected external call
import { CircuitBreaker, retry } from 'core-service';

this.circuitBreaker = new CircuitBreaker({ 
  failureThreshold: 5, 
  resetTimeout: 30000 
});

async send(notification) {
  return this.circuitBreaker.execute(() => 
    retry(() => this.provider.send(notification), { maxAttempts: 3 })
  );
}
```

---

## 📝 File-Specific Guidelines

### React Components (`app/src/`)
- **Always**: Check for unused imports before removing
- **Always**: Verify state variables are used (check setters)
- **Always**: Check for dynamic imports and their necessity
- **Always**: Maintain consistent component structure

### Services (`*-service/src/`)
- **Always**: Build in dependency order
- **Always**: Verify GraphQL schemas match TypeScript types
- **Always**: Check for unused exports before removing
- **Always**: Maintain service boundaries (no direct cross-service imports)
- **Always**: Use `core-service` for generic utilities, add service-specific logic on top
- **Always**: Use event-driven communication (`emit`/`on`) instead of direct HTTP calls
- **Always**: Wrap integration event handlers (registered with `on()`) with `withEventHandlerError(errorCode, handler)` so failures throw GraphQLError with eventId and a consistent error code (payment, bonus, kyc use it)
- **Always**: Import access-engine through `core-service/access`, not directly
- **Never**: Add generic utilities to service code - use `core-service` instead

### Test Scripts (`scripts/typescript/`)
- **Always**: Update test scripts when APIs change
- **Always**: Verify test scripts use latest patterns
- **Always**: Check for dynamic imports and their necessity

**Current Test Limitations (Technical Debt):**
```
⚠️ Tests are currently order-dependent and coupled:
   - Payment tests must run first (creates users, drops DBs)
   - Bonus tests depend on payment-created users
   - Auth tests depend on registered users
```

**Best Practices (future improvements):**
- ❌ **Avoid**: Tests that depend on other test suites running first
- ❌ **Avoid**: Dropping entire databases in tests
- ❌ **Avoid**: Shared mutable state between test suites
- ✅ **Prefer**: Isolated test data created per test/suite
- ✅ **Prefer**: Contract tests with mocked dependencies
- ✅ **Prefer**: Immutable fixtures loaded from snapshots

See README "TODO - Testing Infrastructure" for migration plan.

---

## 🔄 Workflow for Code Changes

### Standard Workflow
1. **Read** this document (CODING_STANDARDS.md)
2. **Analyze** the full context of the change
3. **Search** codebase for related code
4. **Plan** the changes holistically
5. **Implement** changes following patterns
6. **Verify** by building all affected modules
7. **Document** significant changes

### For Bug Fixes
1. Understand the root cause (not just symptoms)
2. Check for similar issues elsewhere
3. Fix consistently across codebase
4. Verify fix doesn't break other things

### For Refactoring
1. Understand current implementation fully
2. Identify all affected code
3. Plan migration path
4. Execute changes systematically
5. Verify everything still works

---

## 🐳 Docker & Infrastructure (Gateway)

The `gateway/` folder orchestrates local development, Docker, and Kubernetes deployments.

### Configuration Files (`gateway/configs/`)

```
infra.json, infra.test.json, infra.combo.json   # Infra overrides per profile
services.json, services.dev.json                # Base + default (ms)
services.test.json, services.combo.json         # Test (standalone), combo (reuses ms)
services.shared.json, services.local-k8s.json   # Shared/production, local K8s
```

### Key Scripts

```bash
# Generate infrastructure (Dockerfiles, compose, K8s manifests)
npm run generate                        # All, dev config
npm run generate:test                   # Test config
npm run generate:combo                   # Combo config (deploy ms first)
npm run generate:dockerfile             # Only Dockerfiles

# Docker operations (support --service for single service)
npm run docker:build                    # Build all images
npm run docker:up                       # Start all containers
npm run docker:down                      # Stop containers (uses --remove-orphans when switching configs)
npm run docker:status                   # Check status
npm run docker:fresh                    # Full fresh: clean + build + start + health (default/ms, single Mongo/Redis)
npm run docker:fresh:test               # Fresh deploy (test config)
npm run docker:fresh:combo              # Fresh deploy (combo; deploy ms first)
npm run docker:fresh:shared             # Fresh deploy (shared config: replica set + Sentinel)

# Kubernetes: k8s:apply, k8s:status, k8s:delete (suffix :test, :combo for those configs)

# Health checks
npm run health                          # Local services
npm run health:docker                   # Docker (default/ms)
npm run health:docker:test              # Docker (test config)
npm run health:k8s                      # K8s services
```

### Cleaning build artifacts and generated files

**Always** use the standard infra clean command. **Do not** add or use custom delete/clean scripts (e.g. ad‑hoc `rm -rf` or one-off PowerShell/Node scripts) for removing `dist`, `node_modules`, generated Dockerfiles, or gateway output. The single source of truth is the core-service infra CLI.

**Commands** (run from repo root or from `core-service` after `npm run build` there):

| Command | What it removes |
|--------|------------------------------------------|
| **Default clean** | Generated files only: `gateway/generated`, `Dockerfile.core-base` at repo root, and each package’s `Dockerfile` (e.g. `auth-service/Dockerfile`, `payment-service/Dockerfile`). Use when you want to wipe generated infra without touching build artifacts or dependencies. |
| **Full clean** | Everything above **plus** in every package under repo root: `dist`, `node_modules`, `package-lock.json`. Use for a full reset before a clean install/build. |

**How to run:**

```bash
# From core-service (requires core-service to be built first: npm run build)
cd core-service
npm run clean        # default: generated only
npm run clean:full   # generated + dist, node_modules, package-lock.json in all packages

# Or via CLI directly (from repo root or core-service)
npx service-infra clean
npx service-infra clean --full
# or: node core-service/dist/infra/cli.js clean
# or: node core-service/dist/infra/cli.js clean -f
```

- **When to use default clean:** After changing gateway config and wanting to regenerate everything; or to remove only generated Dockerfiles and gateway output without deleting `node_modules` or `dist`.
- **When to use full clean:** When preparing for a clean install (e.g. after dependency or Node version changes), or when you want to ensure no stale build artifacts anywhere.

**Rules:**

- **Do not** introduce project-specific or one-off scripts that delete `dist`, `node_modules`, `package-lock.json`, or generated files (e.g. in `scripts/bin/` or service folders). Use `service-infra clean` / `npm run clean` and `npm run clean:full` only.
- **Do not** hardcode service names or paths in clean logic; the infra CLI discovers packages by `package.json` under repo root and cleans generically.

### Dockerfile Generation Patterns

Dockerfiles are **generated dynamically** based on each service's `package.json` dependencies:

```javascript
// In auth-service/package.json
{
  "dependencies": {
    "core-service": "file:../core-service",  // Local = build stage
    "express": "^4.18.0"                     // npm = normal install
  }
}
```

The generator:
1. Reads `file:` dependencies from package.json
2. Creates Docker build stages only for local dependencies
3. Handles dependency chains (core-service → access-engine)

**Result**: If tomorrow `core-service` is published to npm, just change `"file:../core-service"` to `"^1.0.0"` and regenerate Dockerfiles.

**Default (ms)** uses **single** MongoDB and **single** Redis from `services.dev.json`; shared config uses replica set and Sentinel. When switching configs (e.g. ms ↔ test ↔ shared), run `docker:down` first; it uses `--remove-orphans` so orphaned containers are removed and ports freed. See `gateway/STATUS.md` for implementation status.

### Infrastructure Auto-Detection

When generating docker-compose, the script automatically detects:
- Running MongoDB/Redis containers
- Existing Docker networks

If infrastructure exists → uses external network
If not exists → creates infrastructure services

This makes CI/CD bulletproof - works in both scenarios.

### Adding a New Service

**Use the service generator** so the new microservice follows coding standards (dynamic config from MongoDB, GraphQL, database accessor, error codes, optional Redis/webhooks). All current services (auth, bonus, payment, notification, kyc) are aligned to this pattern—you can run and test them now. For the template contents and maintenance rules, see **`core-service/src/infra/SERVICE_GENERATOR.md`**; for status and optional next steps, see **README.md** (repo root) § Config and standards status.

```bash
# From repo root or core-service
cd core-service && npm run build
npx service-infra service --name <name> [--port 9006] [--output ..] [--webhooks] [--core-db]
```

Example: `service-infra service --name test --port 9006 --output ..` creates `test-service/` with:

- `config.ts` / `config-defaults.ts` (dynamic config via `getServiceConfigKey`, `registerServiceConfigDefaults`)
- **`accessors.ts`** (`createServiceAccessors` → `{ db, redis }`); no separate `database.ts` or `redis.ts`
- `error-codes.ts`, `graphql.ts` (types + `createResolvers`), `index.ts` (bootstrap: `resolveContext`, `loadConfig`, `db.initialize`, `createGateway`, `startListening`)
- `services/index.ts`, `types.ts`

Then:

1. Add the service to `gateway/configs/services.dev.json` (and other profiles as needed):
   ```json
   { "name": "test", "host": "test-service", "port": 9006, "database": "test_service", "healthPath": "/health", "graphqlPath": "/graphql" }
   ```
2. Run `npm run generate` from gateway
3. Add the service to gateway dev script if needed; run `npm run dev` or `npm run docker:fresh`

### Microservice naming conventions (auth, payment, bonus, notification, generator)

All microservices that use core-service should follow the same naming so patterns stay consistent. The service generator produces this structure; existing services (auth, payment, bonus, notification, kyc) match it.

| Area | Convention | Example (auth / test) |
|------|------------|----------------------|
| **Config** | **Export** `SERVICE_NAME = '{service}-service'` from config.ts. `loadConfig(brand?, tenantId?)` **via getServiceConfigKey** (common keys with `fallbackService: 'gateway'`, service-only keys with `{ brand, tenantId }`; no `process.env`), `validateConfig`, `printConfigSummary`. Interface `{Service}Config` **extends `DefaultServiceConfig`** (from core-service) in types.ts; add only service-specific properties. | `auth-service`, `AuthConfig`, `loadConfig`, `SERVICE_NAME` |
| **Config defaults** | Export `{SERVICE}_CONFIG_DEFAULTS` with **every** key used by loadConfig: `port`, `serviceName`, `nodeEnv`, `corsOrigins`, `jwt`, `database` (mongoUri, redisUrl). Each key: `{ value, description }`; use `sensitivePaths` for secrets. **No** registration in config-defaults; index calls `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)`. | `AUTH_CONFIG_DEFAULTS`, `TEST_CONFIG_DEFAULTS` |
| **Error codes** | `{SERVICE}_ERRORS` (object), `{SERVICE}_ERROR_CODES` (array), code values `MS{Service}*`, type `{Service}ErrorCode`. **Resolver path**: throw `GraphQLError(SERVICE_ERRORS.*, { ... })` only; **never** `throw new Error('message')`. | `AUTH_ERRORS`, `AUTH_ERROR_CODES`, `MSAuthUserNotFound`, `AuthErrorCode` |
| **GraphQL** | Types: `{shortName}GraphQLTypes` (camelCase short name). Resolvers: `create{Service}Resolvers(config)` | `authGraphQLTypes`, `createAuthResolvers`; `testGraphQLTypes`, `createTestResolvers` |
| **Accessors** | Single `accessors.ts`: `createServiceAccessors('{service}-service')` → `{ db, redis }`; auth uses `{ databaseServiceName: 'core-service' }`. All code imports from `./accessors.js`. | `export const { db, redis } = createServiceAccessors('auth-service', { databaseServiceName: 'core-service' });` |
| **Index** | Import `SERVICE_NAME` from config; `registerServiceConfigDefaults(SERVICE_NAME, …)`, `resolveContext`, `loadConfig`, `validateConfig`, `printConfigSummary`, `db.initialize`, `createGateway`, optional Redis (`config.redisUrl`) / `ensureDefaultConfigsCreated(SERVICE_NAME, …)` / `startListening`, `registerServiceErrorCodes` | Same order as template; see SERVICE_GENERATOR.md §2.1 |

**Short name** for GraphQL: service name without `-service` (e.g. auth, payment, notification, test). Use camelCase for multi-word: `my-api` → `myApiGraphQLTypes`.

**Service configuration – no process.env (dynamic config only):**

- **Do not use `process.env` in microservices.** All config must come from the MongoDB config store. Use **`getServiceConfigKey`** (from core-service) as the single pattern in `config.ts` and anywhere a service reads its own or shared config.
- **Exception:** `process.env` is allowed **only** in core-service or in auth-service when required for **bootstrap/core DB** (e.g. strategy resolution before the config store is available). Document which env vars are used there. All other services must use **dynamic config only** (getServiceConfigKey / config store).
- **Legacy fallback:** Remove; do not keep `process.env` as fallback in config.ts or index. Remove legacy/deprecated code instead of keeping it (see Refactoring Guidelines).
- **Config interface:** Use `DefaultServiceConfig` from core-service for common properties (port, nodeEnv, serviceName, mongoUri, redisUrl, corsOrigins, jwtSecret, jwtExpiresIn, jwtRefreshSecret, jwtRefreshExpiresIn). Each service defines `export interface {Service}Config extends DefaultServiceConfig { ... }` and adds **only** service-specific properties. Reduces duplication and keeps config shape consistent; see SERVICE_GENERATOR.md.
- Register **every** value used at runtime in `config-defaults.ts`: `port`, `serviceName`, `nodeEnv`, `corsOrigins`, `jwt` (secret, expiresIn, refreshSecret, refreshExpiresIn), `database` (mongoUri, redisUrl). Use `{ value, description }` per key; add `sensitivePaths` for secrets.
- **In `loadConfig`:** Use `getServiceConfigKey(SERVICE_NAME, key, defaultVal, opts)` for every key. For **common keys** (port, serviceName, nodeEnv, corsOrigins, jwt, database) use `opts = { brand, tenantId, fallbackService: 'gateway' }` so missing service key falls back to gateway. For **service-only keys** use `opts = { brand, tenantId }`. No fallback to `process.env`. Same pattern elsewhere when reading config (e.g. provider config): use `getServiceConfigKey` with an appropriate default.
- **File separation:** Keep instructions in the correct file: **types.ts** = type/interface definitions only (no defaults, no loadConfig). **config.ts** = loadConfig, validateConfig, printConfigSummary only (no config interface definition, no default constants). **config-defaults.ts** = default value object `{SERVICE}_CONFIG_DEFAULTS` only (no loadConfig, no registration call; index calls `registerServiceConfigDefaults(SERVICE_NAME, {SERVICE}_CONFIG_DEFAULTS)`). See SERVICE_GENERATOR.md §3.1.
- **SERVICE_NAME constant:** Export `SERVICE_NAME` from config.ts (`export const SERVICE_NAME = '{service}-service'`). Use it in index.ts for `registerServiceConfigDefaults(SERVICE_NAME, ...)` and `ensureDefaultConfigsCreated(SERVICE_NAME, ...)`; do not use a static string for the service name there. Same pattern in the service generator.
- **Current state:** All five services (auth, bonus, payment, notification, kyc) use `getServiceConfigKey` in loadConfig; the service generator emits the same pattern. You can run and test all services; see **README.md** (repo root) § Config and standards status and **core-service/src/infra/SERVICE_GENERATOR.md** for alignment status and maintenance rules.

---

## ✅ Quality Gates

Before considering work complete:

- [ ] All affected services build successfully
- [ ] No TypeScript errors
- [ ] No unused imports/variables (verified, not assumed)
- [ ] Code follows existing patterns
- [ ] Related files updated consistently
- [ ] Documentation updated if needed
- [ ] No breaking changes (unless intentional and documented)

---

## 📚 Additional Resources

- `README.md` - Project overview, architecture, database layer, caching, Redis, GraphQL gateway, access control, resilience patterns, event system, error handling, configuration, testing, sharding guide, disaster recovery, and roadmap

---

## 🎓 Learning from Mistakes

### Recent Issues Fixed
1. **Type Mismatch**: `VerifyOTPInput` interface didn't match GraphQL schema
   - **Lesson**: Always verify TypeScript types match GraphQL schemas
   - **Prevention**: Check both files when making schema changes

2. **Unused Variable Assumptions**: Removed variables that were actually used
   - **Lesson**: Always search codebase before removing code
   - **Prevention**: Use grep/codebase search, not just linter warnings

3. **Inconsistent Patterns**: Different approaches in similar files
   - **Lesson**: Review similar files to understand patterns
   - **Prevention**: Check existing patterns before introducing new ones

4. **Partial Context**: Fixed errors without understanding full context
   - **Lesson**: Always read entire file/component before changes
   - **Prevention**: Follow holistic review checklist

5. **Wrong Resolver Signature** (KYC Service): Used `(parent, args, ctx)` instead of `(args, ctx)`
   - **Lesson**: `core-service`'s `createGateway` expects resolvers with `(args, ctx)` signature
   - **Prevention**: Always check existing services for resolver patterns

6. **GraphQL Type Naming Mismatch** (KYC Service): Used `UploadKYCDocumentResult` when `createService` expected `CreateKycDocumentResult`
   - **Lesson**: `createService` generates types based on entity name with specific casing
   - **Prevention**: Follow the naming convention: `Create{EntityName}Result` where `EntityName` matches entity name casing

7. **Duplicate Query Names** (KYC Service): Defined custom `kycProfile` query conflicting with auto-generated one
   - **Lesson**: `createService` generates default queries; custom queries need unique names
   - **Prevention**: Use descriptive names like `kycProfileByUserId` for custom queries

8. **Redis Not Connected** (KYC Service): Called `startListening()` before Redis was initialized
   - **Lesson**: Redis accessor must be initialized before event handlers
   - **Prevention**: Follow initialization order: gateway → Redis config → Redis init → event handlers

9. **MongoDB Index Null Values** (KYC Service): Index options had `sparse: null` instead of omitting the option
   - **Lesson**: MongoDB doesn't accept `null` for boolean index options
   - **Prevention**: Only include index options with explicit boolean values

---

**Remember**: Quality and consistency are more important than speed. When in doubt, take time to understand the full context before making changes.
