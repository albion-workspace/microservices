# Coding Standards - Pending Items

**Last Updated**: 2026-01-27 (Updated: TypeScript `any` usage reviewed and improved)

**Purpose**: Track pending improvements to align with `CODING_STANDARDS.md`.

**Note**: All high-priority violations have been fixed. This document focuses on remaining improvements.

---

## 🎯 Pending Items

### 🟡 Medium Priority

#### 1. Review TypeScript `any` Usage ✅ **PARTIALLY ADDRESSED**

**File**: `core-service/src/gateway/server.ts`

**Status**: Reviewed and improved where practical without increasing complexity

**Changes Made** (2026-01-27):
- ✅ **Error handling**: Changed `catch (error: any)` → `catch (error: unknown)` with proper type guards
- ✅ **Socket.IO callbacks**: Added specific types for callback responses `{ success: boolean; room?: string; error?: string }`
- ✅ **Documentation**: Added inline comments explaining why `any` is used for GraphQL dynamic building

**Remaining `any` Usage** (Justified):
- **GraphQL dynamic field building** (lines 310, 331, 437, 444, 475, 560): GraphQL's type system is complex and dynamic. Using strict types would require extensive type definitions that would significantly increase code size and complexity without practical benefit.
- **GraphQL context functions** (lines 767, 778): `graphql-http` and `graphql-sse` expect specific context types that don't match our `GatewayContext`. Type assertion is necessary for compatibility.

**Justification**: 
- GraphQL schema building is inherently dynamic - fields are added at runtime from service definitions
- GraphQL's type system (`GraphQLType`, `GraphQLFieldConfig`, etc.) is complex and doesn't map cleanly to TypeScript's type system
- Attempting to use strict types would require extensive type definitions (~200+ lines) for minimal benefit
- The current approach balances type safety with code maintainability

**Impact**: Type safety improved where practical (error handling, Socket.IO), GraphQL `any` usage documented and justified

**Status**: ✅ **ACCEPTABLE** - Remaining `any` usage is justified and documented

---

#### 2. Add GraphQL Schema ↔ TypeScript Type Sync Verification

**Issue**: No automated verification found for schema/type consistency

**Action Required**:
- Add automated checks OR
- Document manual verification process
- Add to CODING_STANDARDS.md

**Impact**: Risk of schema/type drift

**Effort**: Medium (requires tooling or process)

---

### 🟢 Low Priority

#### 3. Resolve TODO Comment

**File**: `payment-service/src/services/exchange-rate.ts` (line 215)

**TODO**: `TODO: Integrate with actual exchange rate API`

**Action Required**:
- Implement exchange rate API integration OR
- Document as future enhancement with timeline

**Impact**: Minor documentation gap

**Effort**: Low

---

#### 4. Standardize Import Grouping

**Issue**: Minor inconsistencies in import grouping across some files

**Current Pattern** (should be standard):
- External packages first
- Internal imports second
- Type imports last

**Action Required**:
- Create linting rule OR
- Document standard in CODING_STANDARDS.md
- Gradually refactor files to match standard

**Impact**: Code readability

**Effort**: Low-Medium (many files)

---

### 🧪 Testing (From Duplicate Code Analysis)

#### 5. Add Tests for Circular Inheritance Protection

**Context**: After refactoring `store.getRolePermissions()` to use `RoleResolver`, verify circular inheritance protection works correctly.

**Action Required**:
- Add test cases for circular role inheritance
- Verify `RoleResolver` prevents infinite loops
- Test with `maxDepth` protection

**Impact**: Ensures safety feature works correctly

**Effort**: Low-Medium

---

#### 6. Add Tests for Role Expiration Filtering

**Context**: After refactoring `CachedAccessEngine.compileUserPermissions()` to use `RoleResolver`, verify role expiration filtering works.

**Action Required**:
- Add test cases for expired roles
- Verify expired roles are filtered out
- Test with `UserRole[]` format with `expiresAt` field

**Impact**: Ensures expired roles don't grant permissions

**Effort**: Low-Medium

---

#### 7. Add Tests for Active Role Filtering

**Context**: After refactoring to use `RoleResolver`, verify inactive roles are filtered correctly.

**Action Required**:
- Add test cases for inactive roles (`active: false`)
- Verify inactive roles are filtered out
- Test with `UserRole[]` format with `active` field

**Impact**: Ensures inactive roles don't grant permissions

**Effort**: Low-Medium

---

## 📊 Summary

| Priority | Item | Status | Effort |
|----------|------|--------|--------|
| 🟡 Medium | Review TypeScript `any` usage | ✅ Partially Addressed | Done |
| 🟡 Medium | Add Schema/Type sync verification | Pending | Medium |
| 🟢 Low | Resolve TODO comment | Pending | Low |
| 🟢 Low | Standardize import grouping | Pending | Low-Medium |
| 🧪 Testing | Circular inheritance tests | Pending | Low-Medium |
| 🧪 Testing | Role expiration tests | Pending | Low-Medium |
| 🧪 Testing | Active role filtering tests | Pending | Low-Medium |

**Total Pending Items**: 6 (1 partially addressed)

---

## 🎯 Next Steps (Recommended Order)

### Immediate (Medium Priority)
1. **Add GraphQL Schema ↔ TypeScript Type Sync Verification**
   - **Why**: Prevents schema/type drift which can cause runtime errors
   - **Options**: 
     - Add automated checks using `graphql-code-generator` or similar
     - Document manual verification process in CODING_STANDARDS.md
   - **Effort**: Medium

### Short-term (Low Priority)
2. **Resolve TODO Comment** - Quick win
   - Document as future enhancement OR implement basic exchange rate API integration
   - **Effort**: Low

3. **Standardize Import Grouping** - Code quality improvement
   - Document standard in CODING_STANDARDS.md
   - Gradually refactor files during regular development
   - **Effort**: Low-Medium (can be done incrementally)

### Testing (When Time Permits)
4-6. **Add Tests for Role Resolution Features**
   - Circular inheritance protection tests
   - Role expiration filtering tests  
   - Active role filtering tests
   - **Effort**: Low-Medium each (can be done incrementally)

---

## ✅ Completed Items (Reference)

### High Priority - All Fixed ✅

1. ✅ **Access Engine Direct Imports** - Fixed (2026-01-27)
   - All microservices now use `core-service/access`
   - No direct `access-engine` imports in microservices
   - `common/permissions.ts` routes through `core-service/access`

2. ✅ **Duplicate Code Elimination** - Fixed (2026-01-27)
   - `store.getRolePermissions()` now uses `RoleResolver`
   - `CachedAccessEngine.compileUserPermissions()` now uses `RoleResolver`
   - All safety features from `access-engine` are now utilized

---

**Last Updated**: 2026-01-27 (Updated: TypeScript `any` usage reviewed and improved)
