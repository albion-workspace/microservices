/**
 * Validation Chain - Chain of Responsibility Pattern
 * 
 * Provides reusable validation logic for GraphQL resolvers and service methods.
 * Eliminates repetitive validation code and makes it easy to compose validation chains.
 * 
 * Usage:
 * ```typescript
 * const chain = new AuthValidator()
 *   .setNext(new RequiredFieldValidator(['userId', 'tenantId']))
 *   .setNext(new TypeValidator({ roles: 'array' }));
 * 
 * const result = chain.handle({ args, ctx });
 * if (!result.valid) {
 *   throw new Error(result.error);
 * }
 * ```
 */

import { requireAuth, getUserId, getTenantId } from './resolvers.js';
import type { ResolverContext } from '../types/index.js';
import { logger } from './logger.js';

/**
 * Validation context passed through the chain
 */
export interface ValidationContext {
  args: Record<string, unknown>;
  ctx: ResolverContext;
  input?: Record<string, unknown>; // For mutations with input wrapper
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  data?: Record<string, unknown>; // Validated/extracted data
}

/**
 * Base validation handler (Chain of Responsibility pattern)
 */
export abstract class ValidationHandler {
  private nextHandler?: ValidationHandler;
  
  /**
   * Set the next handler in the chain
   */
  setNext(handler: ValidationHandler): ValidationHandler {
    this.nextHandler = handler;
    return handler;
  }
  
  /**
   * Handle validation request
   */
  handle(context: ValidationContext): ValidationResult {
    const result = this.validate(context);
    
    if (!result.valid) {
      return result;
    }
    
    // Merge validated data into context for next handlers
    if (result.data) {
      context = { ...context, ...result.data };
    }
    
    // Pass to next handler if exists
    if (this.nextHandler) {
      return this.nextHandler.handle(context);
    }
    
    return { valid: true };
  }
  
  /**
   * Validate the context (implemented by subclasses)
   */
  protected abstract validate(context: ValidationContext): ValidationResult;
}

/**
 * Authentication validator
 * Checks if user is authenticated
 */
export class AuthValidator extends ValidationHandler {
  protected validate(context: ValidationContext): ValidationResult {
    try {
      requireAuth(context.ctx);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Authentication required',
      };
    }
  }
}

/**
 * Required field validator
 * Checks if specified fields are present and not empty
 */
export class RequiredFieldValidator extends ValidationHandler {
  constructor(
    private fields: string[],
    private source: 'args' | 'input' = 'args'
  ) {
    super();
  }
  
  protected validate(context: ValidationContext): ValidationResult {
    const source = this.source === 'input' && context.input ? context.input : context.args;
    
    for (const field of this.fields) {
      const value = source[field];
      if (value === undefined || value === null || value === '') {
        return {
          valid: false,
          error: `${field} is required`,
        };
      }
    }
    
    return { valid: true };
  }
}

/**
 * Type validator
 * Validates field types (array, string, number, etc.)
 */
export class TypeValidator extends ValidationHandler {
  constructor(
    private validations: Record<string, 'array' | 'string' | 'number' | 'object'>,
    private source: 'args' | 'input' = 'args'
  ) {
    super();
  }
  
  protected validate(context: ValidationContext): ValidationResult {
    const source = this.source === 'input' && context.input ? context.input : context.args;
    
    for (const [field, expectedType] of Object.entries(this.validations)) {
      const value = source[field];
      
      if (value === undefined || value === null) {
        continue; // Skip if field is not present (use RequiredFieldValidator for that)
      }
      
      let isValid = false;
      switch (expectedType) {
        case 'array':
          isValid = Array.isArray(value);
          break;
        case 'string':
          isValid = typeof value === 'string';
          break;
        case 'number':
          isValid = typeof value === 'number';
          break;
        case 'object':
          isValid = typeof value === 'object' && !Array.isArray(value) && value !== null;
          break;
      }
      
      if (!isValid) {
        return {
          valid: false,
          error: `${field} must be of type ${expectedType}`,
        };
      }
    }
    
    return { valid: true };
  }
}

/**
 * Extract input wrapper validator
 * Extracts input from args.input for mutations with input wrapper
 */
export class ExtractInputValidator extends ValidationHandler {
  protected validate(context: ValidationContext): ValidationResult {
    if (context.args.input && typeof context.args.input === 'object') {
      return {
        valid: true,
        data: { input: context.args.input as Record<string, unknown> },
      };
    }
    return { valid: true };
  }
}

/**
 * Permission validator
 * Checks if user has required permission
 */
export class PermissionValidator extends ValidationHandler {
  constructor(
    private resource: string,
    private action: string,
    private target: string = '*'
  ) {
    super();
  }
  
  protected validate(context: ValidationContext): ValidationResult {
    // Dynamic import to avoid circular dependency
    const accessModule = require('../../access/index.js');
    const matchAnyUrn = accessModule.matchAnyUrn || accessModule.default?.matchAnyUrn;
    
    if (!matchAnyUrn) {
      logger.warn('matchAnyUrn not available in PermissionValidator', { 
        availableExports: Object.keys(accessModule) 
      });
      return { valid: false, error: 'Permission checking not available' };
    }
    
    const user = context.ctx.user;
    
    if (!user) {
      return { valid: false, error: 'Authentication required' };
    }
    
    // Check system role
    if (user.roles?.includes('system')) {
      return { valid: true };
    }
    
    // Check permissions using access-engine
    const requiredUrn = `${this.resource}:${this.action}:${this.target}`;
    const permissions = user.permissions || [];
    
    if (matchAnyUrn(permissions, requiredUrn)) {
      return { valid: true };
    }
    
    return {
      valid: false,
      error: `Unauthorized: Insufficient permissions (required: ${requiredUrn})`,
    };
  }
}

/**
 * Helper function to create common validation chains
 */
export class ValidationChainBuilder {
  private handlers: ValidationHandler[] = [];
  
  /**
   * Add authentication check
   */
  requireAuth(): this {
    this.handlers.push(new AuthValidator());
    return this;
  }
  
  /**
   * Add required field validation
   */
  requireFields(fields: string[], source: 'args' | 'input' = 'args'): this {
    this.handlers.push(new RequiredFieldValidator(fields, source));
    return this;
  }
  
  /**
   * Add type validation
   */
  validateTypes(validations: Record<string, 'array' | 'string' | 'number' | 'object'>, source: 'args' | 'input' = 'args'): this {
    this.handlers.push(new TypeValidator(validations, source));
    return this;
  }
  
  /**
   * Extract input wrapper (for mutations)
   */
  extractInput(): this {
    this.handlers.push(new ExtractInputValidator());
    return this;
  }
  
  /**
   * Add permission check
   */
  requirePermission(resource: string, action: string, target: string = '*'): this {
    this.handlers.push(new PermissionValidator(resource, action, target));
    return this;
  }
  
  /**
   * Add custom validator
   */
  add(handler: ValidationHandler): this {
    this.handlers.push(handler);
    return this;
  }
  
  /**
   * Build the validation chain
   */
  build(): ValidationHandler {
    if (this.handlers.length === 0) {
      throw new Error('Validation chain must have at least one handler');
    }
    
    // Chain handlers together
    for (let i = 0; i < this.handlers.length - 1; i++) {
      this.handlers[i].setNext(this.handlers[i + 1]);
    }
    
    return this.handlers[0];
  }
}

/**
 * Convenience function to create validation chain
 */
export function createValidationChain(): ValidationChainBuilder {
  return new ValidationChainBuilder();
}
