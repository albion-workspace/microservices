# Coding Standards & Best Practices

**Purpose**: This document defines coding standards, best practices, and patterns to follow when working on this codebase. Always review this document before making changes.

**Project Status**: Pre-Production - This project has not yet been released to production. Code cleanup rules are simplified (no backward compatibility concerns). After production/release, these rules will be updated to include backward compatibility and legacy code management.

**Last Updated**: 2026-01-28

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
   import { logger, getDatabase } from 'core-service';
   import { matchAnyUrn } from 'core-service/access';
   ```

4. **Local Imports** (relative paths: `./`, `../`)
   ```typescript
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
import { logger, getDatabase } from 'core-service';
import { matchAnyUrn } from 'core-service/access';

// Local imports
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
- **Core-Service is Generic Only**: Contains only shared, generic utilities and patterns
- **Microservices Extend Core-Service**: Each microservice adds specialized functionality on top
- **Never**: Add service-specific logic to `core-service`
- **Never**: Include infrastructure dependencies (MongoDB, Redis) in `core-service` - these belong in microservices
- **Always**: Keep `core-service` dependency-free from databases and caches
- **Pattern**: `core-service` provides abstractions (e.g., `createService`, `emit`, `on`), microservices implement specifics

### Microservices
- **Always**: Build services in dependency order
- **Always**: Verify dependencies are correctly declared
- **Always**: Check for circular dependencies
- **Never**: Import services directly (use through `core-service`)
- **Always**: Extend `core-service` patterns rather than duplicating code

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
- **Never**: Include MongoDB or Redis clients in `core-service` - event system uses Redis but is abstracted
- **Always**: Services define their own event types - `core-service` provides generic pub/sub infrastructure

### Dependencies & Infrastructure
- **Core-Service**: Must NOT include:
  - MongoDB client dependencies
  - Redis client dependencies
  - Service-specific database schemas
  - Service-specific business logic
- **Core-Service**: SHOULD include:
  - Generic utilities (logging, retry, circuit breaker)
  - Generic patterns (saga, gateway, event system abstractions)
  - Type definitions and interfaces
  - Shared helpers (pagination, validation)
- **Microservices**: Include their own:
  - MongoDB connections and models
  - Redis connections (if needed)
  - Database-specific schemas
  - Business logic implementations

### GraphQL
- **Always**: Keep GraphQL schemas and TypeScript types in sync
- **Always**: Use cursor-based pagination (not offset)
- **Always**: Remove deprecated fields from both schema and types immediately (no backward compatibility needed pre-production)

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
- **Examples**: `extractDocumentId()`, `retry()`, `circuitBreaker()`, pagination helpers
- **Never**: Add service-specific logic to `core-service`
- **Pattern**: If a helper can be used by multiple services, it belongs in `core-service`

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
- **Always**: Import access-engine through `core-service/access`, not directly
- **Never**: Add generic utilities to service code - use `core-service` instead

### Test Scripts (`scripts/typescript/`)
- **Always**: Update test scripts when APIs change
- **Always**: Verify test scripts use latest patterns
- **Always**: Check for dynamic imports and their necessity

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

- `README.md` - Project overview, database strategy, and dynamic configuration
- `ARCHITECTURE_IMPROVEMENTS.md` - Architectural improvements and patterns

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

---

**Remember**: Quality and consistency are more important than speed. When in doubt, take time to understand the full context before making changes.
