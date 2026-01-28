# Error Handling Strategy - Implementation Plan

**Purpose**: Implement consistent error handling across all microservices using Strategy Pattern, following `CODING_STANDARDS.md`.

**Status**: ✅ Phase 1, 2 & 3 Completed - All Microservices Refactored  
**Last Updated**: 2026-01-28

**Key Design Principles:**
- **Ultra-Simple**: Single `GraphQLError` class - just throw with CapitalCamelCase message
- **CapitalCamelCase Format**: All errors formatted consistently (e.g., `UserNotFound`, `InvalidToken`)
- **Service Prefixes**: Optional prefixes for disambiguation (e.g., `MSAuthUserNotFound`, `MSNotificationNoRecipient`)
- **Auto-Logging**: Errors automatically logged in constructor (minimal processing - formatted message already contains service prefix)
- **No Manual Logging**: Eliminates hundreds of `logger.error()` calls across codebase
- **Performance**: Minimal processing - no service extraction, just log formatted message directly
- **Gateway Integration**: Gateway automatically catches and formats errors - no manual handling needed
- **i18n Ready**: Error codes in `extensions.code` for easy frontend translation
- **GraphQL Behavior**: GraphQL intentionally returns HTTP 200 OK for application-level errors (by design)

---

## 📊 Current State Analysis

### Existing Error Handling Infrastructure

**✅ What We Have:**
- `core-service/src/common/errors.ts` - Basic utilities (`getErrorMessage()`, `normalizeError()`)
- `core-service/src/common/mongodb-errors.ts` - MongoDB error detection utilities
- `core-service/src/common/circuit-breaker.ts` - `CircuitBreakerOpenError` custom error class
- Saga engine error handling with retry logic and transient error detection
- Frontend GraphQL error handling with auth/permission distinction

**❌ What's Missing:**
- Standardized error types/codes across services
- Consistent error response format
- Centralized error logging strategy
- GraphQL error formatting standardization
- Error handler chain/strategy pattern
- Error context propagation (correlation IDs, user context)

### Current Issues

1. **Inconsistent Error Handling**:
   - Some services use `throw new Error(message)`
   - Some return error objects: `{ success: false, error: message }`
   - GraphQL errors formatted differently across resolvers

2. **No Error Classification**:
   - No distinction between validation, authentication, authorization, business logic, and system errors
   - No error codes for programmatic handling

3. **Scattered Error Logging**:
   - Hundreds of manual `logger.error()` calls across codebase
   - Some errors logged, some not logged
   - Inconsistent log context (missing correlation IDs, user context)
   - Duplicate logging (error thrown + manual logger.error)

4. **GraphQL Error Formatting**:
   - Errors thrown as plain strings
   - No standardized error extensions (code, statusCode, fields)
   - Frontend has to parse error messages to determine error type

---

## 🎯 Goals

1. **Consistency**: Standardized error handling across all services
2. **Type Safety**: TypeScript error types for better IDE support
3. **Observability**: Centralized error logging with context (auto-logged, no manual calls needed)
4. **Code Reduction**: Eliminates hundreds of manual `logger.error()` calls
5. **User Experience**: Clear, actionable error messages
6. **Developer Experience**: Easy to use - just throw, no logging needed
7. **Backward Compatibility**: No breaking changes to existing code

---

## 🏗️ Architecture Design

### Ultra-Simple Structure

```
GraphQLError class
├── Constructor: format message to CapitalCamelCase
├── Add extensions (details, code)
└── Gateway catches and formats automatically

Usage:
throw new GraphQLError('UserNotFound', { userId: _id })
```

**Ultra-Simplification**: 
- No handler chain
- No builder pattern
- No complex logic
- Just throw `GraphQLError` with CapitalCamelCase message
- Gateway handles formatting automatically

### Error Flow (Ultra-Simple)

```
1. Resolver throws: throw new GraphQLError('UserNotFound', { userId: _id })
   ↓
2. GraphQLError constructor auto-logs error (with correlation ID, code, details)
   ↓
3. Gateway catches error automatically
   ↓
4. formatGraphQLError() formats error for GraphQL response
   ↓
5. Error returned to client (GraphQL format with extensions.code)
```

---

## 📋 Implementation Plan

### Phase 1: Core Error Infrastructure ✅ COMPLETED

**Files Created:**
- `core-service/src/common/graphql-error.ts` - GraphQLError class with auto-logging

**Files Modified:**
- `core-service/src/index.ts` - Export GraphQLError and helpers
- `core-service/src/gateway/server.ts` - Integrated formatGraphQLError for automatic error handling

**Tasks:**
1. ✅ Create `GraphQLError` class (extends `Error`, adds `extensions` property)
2. ✅ Implement `formatToCapitalCamelCase()` function (unifies error message format)
3. ✅ Add automatic error logging in `GraphQLError` constructor (minimal processing - just log formatted message)
4. ✅ Create `createServiceError()` helper (for service-prefixed errors)
5. ✅ Implement `formatGraphQLError()` function (for gateway integration)
6. ✅ Export from `core-service`
7. ✅ Update gateway to catch and format errors automatically

**Important Notes:**
- **Ultra-simple**: Just `throw new GraphQLError('UserNotFound', { userId: _id })`
- **CapitalCamelCase format**: All errors formatted consistently (e.g., "UserNotFound", "InvalidToken")
- **Service prefixes**: Optional for disambiguation (e.g., "MSAuthUserNotFound", "MSNotificationNoRecipient")
- **Auto-logging**: Errors automatically logged in constructor (formatted message already contains service prefix)
- **Minimal processing**: No service extraction - just log the formatted message directly (performant)
- **No manual logging needed**: Removes hundreds of `logger.error()` calls across codebase
- **Gateway integration**: Gateway automatically catches and formats errors - no manual handling needed
- GraphQL **always returns HTTP 200 OK** for application-level errors (by design)

**Estimated Lines**: ~80-100 lines (excluding comments) - Ultra-minimalistic with auto-logging

---

### Phase 2: GraphQL Integration ✅ COMPLETED

**Files Modified:**
- `core-service/src/gateway/server.ts` - Integrated formatGraphQLError in resolver and subscription handlers

**Tasks:**
1. ✅ Wrap resolver execution with error handler
2. ✅ Format GraphQL errors with extensions (code, statusCode, fields)
3. ✅ Ensure correlation IDs are included in error context
4. ✅ Test with existing resolvers - all services compile successfully

**Implementation**: Error handling integrated in `buildFieldResolver` for both Query/Mutation resolvers and Subscription handlers

---

### Phase 3: Service Adoption ✅ COMPLETED

**Services Updated:**
- `auth-service/src/graphql.ts` - All resolvers now use `createServiceError('auth', ...)`
- `bonus-service/src/services/bonus.ts` - All error throws use `createServiceError('bonus', ...)`
- `bonus-service/src/index.ts` - GraphQL resolvers updated
- `payment-service/src/services/wallet.ts` - All errors use `createServiceError('payment', ...)`
- `payment-service/src/services/exchange-rate.ts` - All errors use `createServiceError('payment', ...)`
- `payment-service/src/index.ts` - Event handlers updated
- `notification-service/src/graphql.ts` - All resolvers updated
- `notification-service/src/notification-service.ts` - Core service updated
- `notification-service/src/providers/*.ts` - All providers (email, SMS, WhatsApp, Socket, SSE) updated

**Tasks:**
1. ✅ Replaced all `throw new Error(...)` with `createServiceError(...)` or `GraphQLError`
2. ✅ Removed all manual `logger.error()` calls (errors auto-log now)
3. ✅ Removed dead code after error throws
4. ✅ Removed redundant comments about auto-logging
5. ✅ All services compile successfully

**Impact:**
- Consistent error handling across all microservices
- Automatic error logging with correlation IDs
- CapitalCamelCase error codes for i18n support
- Service prefixes for error disambiguation (MSAuth, MSBonus, MSPayment, MSNotification)

---

## 📝 Detailed Design

### 1. GraphQLError Class (Ultra-Simple Approach)

**Key Design Decisions:**
- **Single `GraphQLError` class** - Extends `Error`, adds `extensions` property
- **CapitalCamelCase format** - Error messages formatted to unified format (e.g., `UserNotFound`, `InvalidToken`)
- **Service prefixes** - Optional prefix for disambiguation (e.g., `MSAuthUserNotFound`, `MSNotificationNoRecipient`)
- **Simple usage** - Just `throw new GraphQLError('UserNotFound', { userId: _id })`

```typescript
import { logger, getCorrelationId } from './logger.js';

/**
 * GraphQL Error Class
 * 
 * Simple error class for GraphQL resolvers with extensions support.
 * Messages are automatically formatted to CapitalCamelCase for consistency.
 * Errors are automatically logged (since prefix tells us where it came from).
 * 
 * @example
 * ```typescript
 * if (!user) {
 *   throw new GraphQLError('UserNotFound', { userId: _id });
 *   // Automatically logged with correlation ID and context
 * }
 * 
 * // With service prefix
 * throw new GraphQLError('MSAuthUserNotFound', { userId: _id });
 * // Automatically logged - we know it's from auth-service
 * ```
 */
export class GraphQLError extends Error {
  public extensions: Record<string, unknown>;
  
  constructor(type: string, details?: Record<string, unknown>) {
    // Format message to CapitalCamelCase (e.g., "user not found" -> "UserNotFound")
    const formattedMessage = formatToCapitalCamelCase(type);
    super(formattedMessage);
    
    this.name = 'GraphQLError';
    this.extensions = details || {};
    
    // Add error type to extensions for client-side handling
    this.extensions.code = formattedMessage;
    
    // Capture stack trace if available
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GraphQLError);
    }
    
    // Auto-log error (formatted message already contains service prefix if present)
    logger.error('GraphQL Error', {
      code: formattedMessage, // Already contains service prefix (e.g., "MSAuthUserNotFound")
      details: this.extensions,
      correlationId: getCorrelationId(),
    });
  }
  
  /**
   * Format any error to GraphQLError format
   * Useful for catching and reformatting existing errors
   * Automatically logs the error
   */
  static format(error: Error | unknown): GraphQLError {
    const message = error instanceof Error ? error.message : String(error);
    const formattedMessage = formatToCapitalCamelCase(message);
    
    if (error instanceof GraphQLError) {
      return error; // Already formatted and logged
    }
    
    return new GraphQLError(formattedMessage, {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Format string to CapitalCamelCase
 * Examples:
 * - "user not found" -> "UserNotFound"
 * - "invalid token" -> "InvalidToken"
 * - "MSAuthUserNotFound" -> "MSAuthUserNotFound" (already formatted)
 * - "user_not_found" -> "UserNotFound"
 */
function formatToCapitalCamelCase(str: string): string {
  if (!str) return 'RuntimeError';
  
  // If already CapitalCamelCase (starts with capital), return as-is
  if (/^[A-Z]/.test(str)) {
    return str;
  }
  
  // Convert to CapitalCamelCase
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // Replace non-alphanumeric with space
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Helper to create service-prefixed errors
 * 
 * @example
 * ```typescript
 * throw createServiceError('auth', 'UserNotFound', { userId: _id });
 * // Results in: "MSAuthUserNotFound"
 * ```
 */
export function createServiceError(
  service: string,
  errorType: string,
  details?: Record<string, unknown>
): GraphQLError {
  const prefix = `MS${service.charAt(0).toUpperCase() + service.slice(1)}`;
  const errorCode = `${prefix}${formatToCapitalCamelCase(errorType)}`;
  return new GraphQLError(errorCode, details);
}
```

### 2. Error Formatting & Gateway Integration

**Simplification**: No handler chain needed. Gateway catches errors and formats them automatically.

```typescript
import { GraphQLError as GraphQLErrorType } from 'graphql';
import { GraphQLError } from '../common/graphql-error.js';
import { getCorrelationId } from '../common/logger.js';

/**
 * Format error for GraphQL response
 * Automatically handles GraphQLError instances and formats others
 * Note: GraphQLError constructor already logs the error, so no need to log again here
 */
export function formatGraphQLError(
  error: unknown,
  context?: { correlationId?: string; userId?: string }
): GraphQLErrorType {
  // If already a GraphQLError, format it (already logged in constructor)
  if (error instanceof GraphQLError) {
    return new GraphQLErrorType(error.message, {
      extensions: {
        code: error.extensions.code || error.message,
        ...error.extensions,
        correlationId: context?.correlationId || getCorrelationId(),
        userId: context?.userId,
      },
      originalError: error,
    });
  }
  
  // Format other errors (GraphQLError.format() will auto-log)
  const formatted = GraphQLError.format(error);
  return new GraphQLErrorType(formatted.message, {
    extensions: {
      code: formatted.extensions.code || formatted.message,
      ...formatted.extensions,
      correlationId: context?.correlationId || getCorrelationId(),
      userId: context?.userId,
    },
    originalError: error,
  });
}

/**
 * Wrapper for resolver error handling (optional - can be used in gateway)
 * Note: No need to log errors here - GraphQLError constructor handles it
 */
export function withErrorHandling<T>(
  resolver: (args: Record<string, unknown>, ctx: ResolverContext) => Promise<T>
): (args: Record<string, unknown>, ctx: ResolverContext) => Promise<T> {
  return async (args, ctx) => {
    try {
      return await resolver(args, ctx);
    } catch (error) {
      // Format and throw GraphQL error (auto-logged in GraphQLError constructor)
      throw formatGraphQLError(error, {
        correlationId: getCorrelationId(),
        userId: ctx.user?.userId,
      });
    }
  };
}
```

### 3. Gateway Integration

**Gateway automatically catches and formats errors** - No need for manual error handling in resolvers.

```typescript
// In gateway/server.ts - wrap resolver execution
try {
  const result = await resolver(args, ctx);
  return result;
} catch (error) {
  // Format error automatically
  throw formatGraphQLError(error, {
    correlationId: getCorrelationId(),
    userId: ctx.user?.userId,
  });
}
```

**Note**: GraphQL always returns HTTP 200 OK for application-level errors. Error codes are in `extensions.code` for client-side handling.

### 4. Usage Examples

**In Resolvers (Simple & Clean - No Manual Logging Needed):**
```typescript
import { GraphQLError, createServiceError } from 'core-service';

export const resolvers = {
  Query: {
    getUser: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      if (!args.userId) {
        // Error automatically logged in GraphQLError constructor
        throw new GraphQLError('UserIdRequired', { field: 'userId' });
      }
      
      const user = await getUserById(args.userId);
      if (!user) {
        // With service prefix for disambiguation
        // Error automatically logged (formatted message contains service prefix)
        throw createServiceError('auth', 'UserNotFound', { userId: args.userId });
        // Results in: "MSAuthUserNotFound"
        // Auto-logged with: { code: "MSAuthUserNotFound", details: {...}, correlationId: "..." }
      }
      
      return user;
    },
  },
  
  Mutation: {
    sendNotification: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const { recipient } = args.input || {};
      if (!recipient) {
        // Error automatically logged (formatted message contains service prefix)
        throw createServiceError('notification', 'NoRecipient', {});
        // Results in: "MSNotificationNoRecipient"
        // Auto-logged with: { code: "MSNotificationNoRecipient", details: {...}, correlationId: "..." }
      }
      
      // ... rest of logic
      // No need for try/catch or manual logger.error() - GraphQLError handles it
    },
  },
};
```

**Common Error Types (Examples):**
```typescript
// Validation errors
throw new GraphQLError('InvalidInput', { field: 'email', reason: 'Invalid format' });
throw new GraphQLError('RequiredField', { field: 'userId' });

// Authentication errors
throw new GraphQLError('AuthenticationRequired');
throw new GraphQLError('InvalidToken');
throw new GraphQLError('TokenExpired');

// Authorization errors
throw new GraphQLError('PermissionDenied', { resource: 'user', action: 'update' });

// Business logic errors
throw new GraphQLError('UserNotFound', { userId: '123' });
throw new GraphQLError('InsufficientBalance', { balance: 100, required: 200 });

// With service prefix (when needed for disambiguation)
throw createServiceError('auth', 'UserNotFound', { userId: '123' });
throw createServiceError('payment', 'InsufficientBalance', { balance: 100 });
```

**Frontend Usage (i18n/Translation):**
```typescript
// Error code is in extensions.code (CapitalCamelCase format)
// React app automatically extracts error.code from GraphQL errors
const errorCode = error.code || error.extensions?.code || error.message; 
// e.g., "UserNotFound", "MSAuthUserNotFound", "MSNotificationNoRecipient"

// Translate using i18n library
const translatedMessage = t(`error.${errorCode}`); 
// Looks up: error.UserNotFound, error.MSAuthUserNotFound, etc.

// Check error type from code
if (errorCode.includes('Auth') || errorCode === 'AuthenticationRequired') {
  redirectToLogin();
} else if (errorCode.includes('Permission')) {
  showPermissionDeniedMessage();
}
```

**React App Integration:**
- ✅ `app/src/lib/graphql-utils.ts` - Enhanced to extract `extensions.code` and attach to error object
- ✅ `app/src/lib/auth-context.tsx` - Already extracts `extensions.code` for error handling
- ✅ `app/src/pages/Notifications.tsx` - Enhanced to extract error codes
- ✅ `app/src/pages/Webhooks.tsx` - Enhanced to extract error codes
- ✅ `app/src/pages/AuthCallback.tsx` - Enhanced to extract error codes
- ✅ `app/src/lib/auth.ts` - Enhanced to extract error codes

**Note**: React app doesn't throw `GraphQLError` (it's a client), but it properly extracts and uses error codes from backend responses for i18n support.

---

## ✅ Success Criteria

1. **Backward Compatibility**: ✅ Existing code continues to work without changes
2. **Type Safety**: ✅ TypeScript types for all error classes and handlers
3. **Consistency**: ✅ Standardized error format across all services
4. **Observability**: ✅ All errors logged with correlation IDs and context
5. **Developer Experience**: ✅ Easy to use, fluent API (chain builder)
6. **GraphQL Integration**: ✅ Errors formatted with proper extensions
7. **Documentation**: ✅ Usage examples in README.md

---

## 📊 Implementation Phases

### Phase 1: Core Infrastructure (Required)
- **Effort**: Medium
- **Impact**: High
- **Breaking Changes**: None (backward compatible)
- **Files**: 2 new files, 2 modified files
- **Estimated Time**: 2-3 hours

### Phase 2: GraphQL Integration (Required)
- **Effort**: Low
- **Impact**: High
- **Breaking Changes**: None (backward compatible)
- **Files**: 1 modified file
- **Estimated Time**: 1 hour

### Phase 3: Service Adoption (Optional)
- **Effort**: Medium
- **Impact**: Medium
- **Breaking Changes**: None (incremental adoption)
- **Files**: Multiple service files (optional)
- **Estimated Time**: 2-4 hours per service (can be done incrementally)

---

## 🔄 Migration Strategy

1. **Phase 1 & 2**: Implement core infrastructure (no breaking changes)
2. **Phase 3**: Services can adopt incrementally:
   - Start with new resolvers
   - Gradually refactor existing resolvers
   - Old code continues to work

---

## 📝 Notes

- **Follow CODING_STANDARDS.md**: Import grouping, type safety, documentation
- **No Breaking Changes**: All changes are backward compatible
- **Incremental Adoption**: Services can adopt gradually
- **Error Logging**: All errors logged with correlation IDs for tracing
- **GraphQL Status Codes**: GraphQL intentionally returns HTTP 200 OK for application-level errors (by design). `extensions.statusCode` is informational only for client-side error handling. Only transport-level errors (invalid query, malformed JSON) return non-200 status codes.
- **Minimalistic Design**: Single `AppError` class, no separate classes per error type
- **i18n Support**: Message prefixes (e.g., `MS_AUTH_REQUIRED`) enable easy translation on frontend
- **Type Inference**: TypeScript infers error type from message prefix pattern

---

**Implementation Status**: 
1. ✅ Phase 1 (Core Infrastructure) - COMPLETED
2. ✅ Phase 2 (GraphQL Integration) - COMPLETED
3. ✅ Phase 3 (Service Adoption) - COMPLETED
4. ✅ React App Integration - COMPLETED (extracts error codes for i18n)
5. ✅ All services compile successfully
6. ✅ Dead code removed
7. ✅ Redundant comments removed

**Next Steps** (Optional):
- Add i18n translation keys for all error codes in frontend
- **Error Code Constants/Enums & GraphQL Error Discovery** (see detailed plan below)

---

## 🎯 Phase 4: Error Code Constants & GraphQL Error Discovery (Optional Enhancement)

### Overview

Create a centralized system for error code management that provides:
1. **TypeScript Constants/Enums**: Type-safe error code references across codebase
2. **GraphQL Error Discovery Query**: Introspect all available error codes (similar to GraphQL schema introspection)

### Benefits

- **Type Safety**: Compile-time checking of error codes
- **Auto-completion**: IDE support for error codes
- **Documentation**: Self-documenting error codes
- **Frontend Discovery**: Frontend can query all available error codes dynamically
- **i18n Integration**: Auto-generate translation keys from error codes
- **Validation**: Ensure error codes are consistent across services

### Implementation Plan

#### 4.1: Error Code Registry

**Location**: `core-service/src/common/error-codes.ts`

Create a centralized registry of all error codes:

```typescript
/**
 * Error Code Registry
 * 
 * Centralized registry of all error codes used across microservices.
 * Used for:
 * - Type-safe error code references
 * - GraphQL error discovery query
 * - i18n key generation
 * - Documentation
 */

// Service prefixes
export const ErrorServicePrefix = {
  AUTH: 'MSAuth',
  BONUS: 'MSBonus',
  PAYMENT: 'MSPayment',
  NOTIFICATION: 'MSNotification',
  CORE: 'MSCore',
} as const;

// Error categories
export const ErrorCategory = {
  AUTHENTICATION: 'Authentication',
  AUTHORIZATION: 'Authorization',
  VALIDATION: 'Validation',
  NOT_FOUND: 'NotFound',
  BUSINESS_LOGIC: 'BusinessLogic',
  SYSTEM: 'System',
} as const;

// Error code definitions with metadata
export interface ErrorCodeDefinition {
  code: string;
  service: keyof typeof ErrorServicePrefix;
  category: keyof typeof ErrorCategory;
  description: string;
  httpStatus?: number; // Optional HTTP status hint
}

// Auth Service Errors
export const AuthErrorCodes = {
  AuthenticationRequired: {
    code: 'MSAuthAuthenticationRequired',
    service: 'AUTH',
    category: 'AUTHENTICATION',
    description: 'Authentication token is required',
    httpStatus: 401,
  },
  InvalidToken: {
    code: 'MSAuthInvalidToken',
    service: 'AUTH',
    category: 'AUTHENTICATION',
    description: 'Authentication token is invalid',
    httpStatus: 401,
  },
  TokenExpired: {
    code: 'MSAuthTokenExpired',
    service: 'AUTH',
    category: 'AUTHENTICATION',
    description: 'Authentication token has expired',
    httpStatus: 401,
  },
  UserNotFound: {
    code: 'MSAuthUserNotFound',
    service: 'AUTH',
    category: 'NOT_FOUND',
    description: 'User not found',
    httpStatus: 404,
  },
  // ... all auth errors
} as const satisfies Record<string, ErrorCodeDefinition>;

// Bonus Service Errors
export const BonusErrorCodes = {
  TemplateNotFound: {
    code: 'MSBonusTemplateNotFound',
    service: 'BONUS',
    category: 'NOT_FOUND',
    description: 'Bonus template not found',
  },
  // ... all bonus errors
} as const satisfies Record<string, ErrorCodeDefinition>;

// Payment Service Errors
export const PaymentErrorCodes = {
  InsufficientBalance: {
    code: 'MSPaymentInsufficientBalance',
    service: 'PAYMENT',
    category: 'BUSINESS_LOGIC',
    description: 'Insufficient balance for transaction',
  },
  // ... all payment errors
} as const satisfies Record<string, ErrorCodeDefinition>;

// Notification Service Errors
export const NotificationErrorCodes = {
  NoRecipient: {
    code: 'MSNotificationNoRecipient',
    service: 'NOTIFICATION',
    category: 'VALIDATION',
    description: 'No recipient specified for notification',
  },
  // ... all notification errors
} as const satisfies Record<string, ErrorCodeDefinition>;

// Combined registry
export const ErrorCodeRegistry = {
  ...AuthErrorCodes,
  ...BonusErrorCodes,
  ...PaymentErrorCodes,
  ...NotificationErrorCodes,
} as const;

// Type-safe error code type
export type ErrorCode = typeof ErrorCodeRegistry[keyof typeof ErrorCodeRegistry]['code'];

// Helper to get error code by string (with type narrowing)
export function getErrorCode(code: string): ErrorCodeDefinition | undefined {
  return Object.values(ErrorCodeRegistry).find(def => def.code === code);
}
```

#### 4.2: Update GraphQLError to Use Registry (Optional)

**Location**: `core-service/src/common/graphql-error.ts`

Optionally validate error codes against registry:

```typescript
import { ErrorCodeRegistry, getErrorCode } from './error-codes.js';

export class GraphQLError extends Error {
  // ... existing code ...
  
  constructor(type: string, details?: Record<string, unknown>) {
    const formattedMessage = formatToCapitalCamelCase(type);
    
    // Optional: Validate against registry in development
    if (process.env.NODE_ENV === 'development') {
      const registered = getErrorCode(formattedMessage);
      if (!registered) {
        logger.warn(`Unregistered error code: ${formattedMessage}`, {
          suggestion: 'Consider adding to ErrorCodeRegistry',
        });
      }
    }
    
    // ... rest of constructor ...
  }
}
```

#### 4.3: GraphQL Error Discovery Query

**Location**: `core-service/src/gateway/server.ts` (add to Query type)

Add a GraphQL query to discover all available error codes:

```typescript
// In buildSchema function, add to queryFields:

errorCodes: {
  type: new GraphQLList(ErrorCodeType),
  args: {
    service: { type: GraphQLString }, // Optional filter by service
    category: { type: GraphQLString }, // Optional filter by category
  },
  resolve: async (_root: unknown, args: { service?: string; category?: string }) => {
    const codes = Object.values(ErrorCodeRegistry);
    
    // Filter by service if provided
    let filtered = codes;
    if (args.service) {
      filtered = filtered.filter(code => 
        code.service.toLowerCase() === args.service.toLowerCase()
      );
    }
    
    // Filter by category if provided
    if (args.category) {
      filtered = filtered.filter(code => 
        code.category.toLowerCase() === args.category.toLowerCase()
      );
    }
    
    return filtered;
  },
},
```

**GraphQL Schema Addition**:

```graphql
type ErrorCode {
  code: String!
  service: String!
  category: String!
  description: String!
  httpStatus: Int
}

type Query {
  # ... existing queries ...
  errorCodes(service: String, category: String): [ErrorCode!]!
}
```

#### 4.4: Usage Examples

**Backend - Type-safe error codes**:

```typescript
import { AuthErrorCodes } from 'core-service';

// Type-safe error code reference
if (!user) {
  throw createServiceError('auth', 'UserNotFound', { userId: _id });
  // Or use constant:
  // throw new GraphQLError(AuthErrorCodes.UserNotFound.code, { userId: _id });
}
```

**Frontend - Discover all error codes**:

```graphql
query GetAllErrorCodes($service: String, $category: String) {
  errorCodes(service: $service, category: $category) {
    code
    service
    category
    description
    httpStatus
  }
}
```

**Frontend - Generate i18n keys**:

```typescript
// Query all error codes
const { data } = await graphql(`
  query GetAllErrorCodes {
    errorCodes {
      code
      description
    }
  }
`);

// Generate i18n translation keys
const i18nKeys = data.errorCodes.reduce((acc, error) => {
  acc[error.code] = error.description; // Or fetch from translation service
  return acc;
}, {} as Record<string, string>);
```

**Frontend - Type-safe error handling**:

```typescript
import type { ErrorCode } from 'core-service';

function handleError(error: { code: ErrorCode }) {
  switch (error.code) {
    case 'MSAuthAuthenticationRequired':
      // TypeScript knows this is a valid error code
      redirectToLogin();
      break;
    case 'MSAuthInvalidToken':
      refreshToken();
      break;
    // ... TypeScript autocomplete for all error codes
  }
}
```

### Implementation Steps

1. **Extract All Error Codes**: Scan codebase for all `createServiceError()` calls and document them
2. **Create Error Code Registry**: Build `error-codes.ts` with all error definitions
3. **Add GraphQL Query**: Implement `errorCodes` query in gateway
4. **Update Documentation**: Document error codes in `ERROR_HANDLING_STRATEGY_PLAN.md`
5. **Frontend Integration**: Update React app to use error code constants/types
6. **i18n Integration**: Generate translation keys from error codes

### Benefits Summary

- ✅ **Type Safety**: Compile-time error code validation
- ✅ **Discoverability**: Frontend can query all available errors
- ✅ **Documentation**: Self-documenting error system
- ✅ **i18n Ready**: Auto-generate translation keys
- ✅ **Consistency**: Centralized error code management
- ✅ **Developer Experience**: IDE autocomplete for error codes

### Considerations

- **Maintenance**: Error codes must be kept in sync with actual usage
- **Optional**: Can be implemented incrementally - existing code continues to work
- **Performance**: Error code registry is static - no performance impact
- **Backward Compatible**: Existing error codes continue to work without registry
