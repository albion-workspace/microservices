/**
 * GraphQL Schema ↔ TypeScript Type Verification Script
 * 
 * Basic validation to check if GraphQL schema types match TypeScript types.
 * 
 * Usage: tsx scripts/typescript/verify-graphql-types.ts
 * 
 * This is a lightweight check - not a full type system validator.
 * For comprehensive validation, consider using graphql-code-generator.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Scripts are in scripts/typescript/, root is 2 levels up (scripts/typescript -> scripts -> root)
const rootDir = join(__dirname, '../..');

/**
 * GraphQL-only input types that don't require TypeScript interfaces.
 * These are simple pass-through types used only in resolvers with (args as any).input
 */
const GRAPHQL_ONLY_INPUT_TYPES = new Set([
  'UpdateUserRolesInput',
  'UpdateUserPermissionsInput',
  'UpdateUserStatusInput',
  'SendNotificationInput',
]);

interface VerificationResult {
  service: string;
  issues: string[];
  warnings: string[];
  graphqlOnlyTypes: string[]; // Track GraphQL-only types for reporting
}

/**
 * Extract GraphQL input types from schema string
 */
function extractGraphQLInputs(schema: string): Map<string, Record<string, string>> {
  const inputs = new Map<string, Record<string, string>>();
  const inputRegex = /input\s+(\w+)\s*\{([^}]+)\}/g;
  
  let match;
  while ((match = inputRegex.exec(schema)) !== null) {
    const inputName = match[1];
    const fieldsStr = match[2];
    const fields: Record<string, string> = {};
    
    // Remove comments (lines starting with #)
    const fieldsWithoutComments = fieldsStr.split('\n')
      .map(line => line.split('#')[0]) // Remove everything after #
      .join('\n');
    
    // Extract fields: "fieldName: Type!" or "fieldName: Type"
    // Match field definitions (not comments or other text)
    const fieldRegex = /^\s*(\w+)\s*:\s*([^!\n#]+)(!)?/gm;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(fieldsWithoutComments)) !== null) {
      const fieldName = fieldMatch[1].trim();
      const fieldType = fieldMatch[2].trim();
      const required = fieldMatch[3] === '!';
      // Only add if it looks like a valid field (has a type)
      if (fieldType && fieldName) {
        fields[fieldName] = required ? 'required' : 'optional';
      }
    }
    
    inputs.set(inputName, fields);
  }
  
  return inputs;
}

/**
 * Extract TypeScript interface fields from source file
 */
function extractTypeScriptInterface(fileContent: string, interfaceName: string): Record<string, string> | null {
  // Match interface definition
  const interfaceRegex = new RegExp(`(?:export\\s+)?(?:interface|type)\\s+${interfaceName}\\s*[=:]?\\s*\\{([^}]+)\\}`, 's');
  const match = fileContent.match(interfaceRegex);
  
  if (!match) return null;
  
  const fieldsStr = match[1];
  const fields: Record<string, string> = {};
  
  // Remove comments (single-line // and multi-line /* */)
  const fieldsWithoutComments = fieldsStr
    .replace(/\/\/.*$/gm, '') // Remove // comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove /* */ comments
  
  // Extract fields: "fieldName?: Type" or "fieldName: Type"
  // Match field definitions on their own lines (not in comments or other text)
  const fieldRegex = /^\s*(\w+)(\?)?\s*:\s*([^;,\n]+)/gm;
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(fieldsWithoutComments)) !== null) {
    const fieldName = fieldMatch[1].trim();
    const optional = fieldMatch[2] === '?';
    const fieldType = fieldMatch[3].trim();
    // Only add if it looks like a valid field (has a type and field name is not a keyword)
    if (fieldType && fieldName && !['Optional', 'Required', 'Readonly'].includes(fieldName)) {
      fields[fieldName] = optional ? 'optional' : 'required';
    }
  }
  
  return fields;
}

/**
 * Find TypeScript files in a directory
 */
function findTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist') {
        files.push(...findTypeScriptFiles(fullPath));
      } else if (stat.isFile() && entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors (permissions, etc.)
  }
  
  return files;
}

/**
 * Verify GraphQL types for a service
 */
function verifyService(serviceDir: string, serviceName: string): VerificationResult {
  const result: VerificationResult = {
    service: serviceName,
    issues: [],
    warnings: [],
    graphqlOnlyTypes: [],
  };
  
  // Find GraphQL schema file (usually graphql.ts)
  const graphqlFile = join(serviceDir, 'src', 'graphql.ts');
  let schemaContent: string;
  
  try {
    schemaContent = readFileSync(graphqlFile, 'utf-8');
  } catch (error) {
    result.warnings.push(`No graphql.ts found in ${serviceName} - skipping`);
    return result;
  }
  
  // Extract GraphQL input types
  const graphQLInputs = extractGraphQLInputs(schemaContent);
  
  if (graphQLInputs.size === 0) {
    result.warnings.push(`No input types found in GraphQL schema`);
    return result;
  }
  
  // Find TypeScript type files
  const srcDir = join(serviceDir, 'src');
  const tsFiles = findTypeScriptFiles(srcDir);
  
  // Check each GraphQL input type
  for (const [inputName, graphQLFields] of graphQLInputs) {
    // Skip GraphQL-only types (whitelisted)
    if (GRAPHQL_ONLY_INPUT_TYPES.has(inputName)) {
      result.graphqlOnlyTypes.push(inputName);
      continue;
    }
    
    let found = false;
    
    // Search in all TypeScript files
    for (const tsFile of tsFiles) {
      const tsContent = readFileSync(tsFile, 'utf-8');
      const tsFields = extractTypeScriptInterface(tsContent, inputName);
      
      if (tsFields) {
        found = true;
        
        // Compare fields
        for (const [fieldName, graphQLRequired] of Object.entries(graphQLFields)) {
          if (!(fieldName in tsFields)) {
            result.issues.push(`${inputName}.${fieldName}: Missing in TypeScript interface`);
          } else {
            const tsRequired = tsFields[fieldName];
            if (graphQLRequired !== tsRequired) {
              result.warnings.push(
                `${inputName}.${fieldName}: GraphQL ${graphQLRequired}, TypeScript ${tsRequired}`
              );
            }
          }
        }
        
        // Check for extra fields in TypeScript
        for (const fieldName of Object.keys(tsFields)) {
          if (!(fieldName in graphQLFields)) {
            result.warnings.push(`${inputName}.${fieldName}: Exists in TypeScript but not in GraphQL`);
          }
        }
        
        break;
      }
    }
    
    if (!found) {
      result.issues.push(`${inputName}: TypeScript interface not found`);
    }
  }
  
  return result;
}

/**
 * Main verification function
 */
function main() {
  console.log('GraphQL Schema <-> TypeScript Type Verification\n');
  
  const results: VerificationResult[] = [];
  
  // Check each service (services are in rootDir, same level as scripts/)
  const services = ['auth-service', 'bonus-service', 'payment-service', 'notification-service'];
  
  for (const serviceName of services) {
    const serviceDir = join(rootDir, serviceName);
    try {
      const stat = statSync(serviceDir);
      if (stat.isDirectory()) {
        const result = verifyService(serviceDir, serviceName);
        results.push(result);
      }
    } catch (error) {
      // Service doesn't exist, skip silently
    }
  }
  
  // If no results, services might not be found
  if (results.length === 0) {
    console.log('WARNING: No services found. Check that services are in the correct location.');
    console.log(`   Looking in: ${rootDir}`);
    process.exit(0);
  }
  
  // Print results
  let totalIssues = 0;
  let totalWarnings = 0;
  
  for (const result of results) {
    const hasIssues = result.issues.length > 0;
    const hasWarnings = result.warnings.length > 0;
    const hasGraphQLOnly = result.graphqlOnlyTypes.length > 0;
    
    if (!hasIssues && !hasWarnings && !hasGraphQLOnly) {
      console.log(`[OK] ${result.service}: No issues found`);
    } else {
      console.log(`\n[${result.service}]:`);
      
      if (hasGraphQLOnly) {
        console.log('  [GRAPHQL-ONLY] (skipped - no TypeScript interface needed):');
        for (const typeName of result.graphqlOnlyTypes) {
          console.log(`    - ${typeName}`);
        }
      }
      
      if (hasIssues) {
        console.log('  [ISSUES]:');
        for (const issue of result.issues) {
          console.log(`    - ${issue}`);
        }
        totalIssues += result.issues.length;
      }
      
      if (hasWarnings) {
        console.log('  [WARNINGS]:');
        for (const warning of result.warnings) {
          console.log(`    - ${warning}`);
        }
        totalWarnings += result.warnings.length;
      }
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Total Issues: ${totalIssues}`);
  console.log(`Total Warnings: ${totalWarnings}`);
  
  if (totalIssues === 0 && totalWarnings === 0) {
    console.log('\n[SUCCESS] All GraphQL types verified successfully!');
    process.exit(0);
  } else if (totalIssues === 0) {
    console.log('\n[WARNING] Verification completed with warnings (non-blocking)');
    process.exit(0);
  } else {
    console.log('\n[FAILED] Verification failed - please fix issues above');
    process.exit(1);
  }
}

// Run if executed directly
main();
