# Coding Standards & Best Practices

**Purpose**: This document defines coding standards, best practices, and patterns to follow when working on this codebase. Always review this document before making changes.

**Last Updated**: 2026-01-25

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

---

## 🔍 Code Review Checklist

Before making any changes, follow this checklist:

### Pre-Change Analysis
- [ ] Read the entire file being modified
- [ ] Search codebase for all usages of functions/variables being changed
- [ ] Check for related files that might be affected
- [ ] Understand the purpose and context of the code
- [ ] Check for similar patterns in other files
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
- **Always**: Remove unused imports
- **Always**: Group imports logically (external, internal, types)
- **Always**: Use consistent import styles across similar files
- **Never**: Remove imports without checking:
  - Dynamic imports (`import()`)
  - Re-exports from the same file
  - Type-only imports that might be used in type definitions
  - Imports used in JSDoc comments

### Exports
- **Always**: Remove unused exports
- **Always**: Check if exports are used in other files before removing
- **Always**: Maintain backward compatibility for public APIs (unless explicitly breaking)
- **Never**: Remove exports that are re-exported elsewhere

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

---

## 🏗️ Architecture Patterns

### Microservices
- **Always**: Build services in dependency order
- **Always**: Verify dependencies are correctly declared
- **Always**: Check for circular dependencies
- **Never**: Import services directly (use through `core-service`)

### Access Engine Usage
- **React App**: Import directly from `access-engine` package
- **Services**: Use through `core-service` (not direct imports)
- **Always**: Verify access-engine usage matches this pattern

### GraphQL
- **Always**: Keep GraphQL schemas and TypeScript types in sync
- **Always**: Use cursor-based pagination (not offset)
- **Always**: Remove deprecated fields from both schema and types
- **Never**: Leave backward compatibility code unless explicitly needed

---

## 🧹 Code Cleanup Rules

### Legacy Code Removal
- **Always**: Search entire codebase for usages before removing
- **Always**: Check test scripts and external consumers
- **Always**: Update all usages to new patterns
- **Never**: Remove backward compatibility without updating all consumers

### Unused Code
- **Always**: Verify code is truly unused:
  - Search for function/variable name across codebase
  - Check for dynamic access (`obj[name]`)
  - Verify not used in templates/strings
- **When removing**: Remove related comments and documentation

### Comments & Documentation
- **Always**: Remove outdated comments
- **Always**: Update comments when code changes
- **Always**: Keep comments that explain "why" not "what"
- **Never**: Leave TODO/FIXME comments without context

---

## 🎯 Refactoring Guidelines

### Before Refactoring
1. **Understand the full scope**: Read all related files
2. **Identify all usages**: Search codebase for patterns
3. **Plan the changes**: List all files that need updates
4. **Check dependencies**: Verify build order and dependencies

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
- ❌ **Wrong**: Removing deprecated code without updating consumers
- ✅ **Right**: Updating all usages before removing deprecated code

### 5. Type Mismatches
- ❌ **Wrong**: Ignoring type errors or using `any`
- ✅ **Right**: Fixing types properly to match schemas/interfaces

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

- `ARCHITECTURE_IMPROVEMENTS.md` - Architectural improvements and patterns
- `CODE_AUDIT_LEGACY_REMOVAL.md` - Legacy code removal guidelines
- `README.md` - Project overview and setup

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
