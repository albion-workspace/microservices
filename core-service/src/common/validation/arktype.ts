/**
 * Validation Utilities
 * 
 * Common validation helpers used across services
 */

import { type } from 'arktype';

/**
 * Validates input using an arktype schema validator and returns standardized error format
 * 
 * @param schemaResult - Result from schema validation (e.g., type() validator)
 * @returns Either the validated input or an errors object
 * 
 * @example
 * ```typescript
 * import { validateInput } from 'core-service/common/validation';
 * import { type } from 'arktype';
 * 
 * const schema = type({ name: 'string', age: 'number' });
 * 
 * const validate = (input: unknown) => {
 *   const result = schema(input);
 *   return validateInput(result);
 * };
 * ```
 */
export function validateInput<T>(
  schemaResult: T | InstanceType<typeof type.errors>
): T | { errors: string[] } {
  // Check if result is a validation error (arktype pattern)
  if (schemaResult instanceof type.errors) {
    return { errors: [(schemaResult as any).summary] };
  }
  
  return schemaResult as T;
}
