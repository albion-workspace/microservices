#!/usr/bin/env npx tsx
/**
 * Simple API Test - Check GraphQL schema and health endpoints
 */

import { loadScriptConfig, AUTH_SERVICE_URL, PAYMENT_SERVICE_URL } from './config/scripts.js';

async function testHealthEndpoint(url: string, serviceName: string) {
  try {
    const healthUrl = url.replace('/graphql', '/health');
    console.log(`\n🔍 Testing ${serviceName} health endpoint: ${healthUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`   ❌ Health check failed: HTTP ${response.status}`);
      return false;
    }
    
    const data = await response.json();
    console.log(`   ✅ Health check passed:`, JSON.stringify(data, null, 2));
    return true;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log(`   ❌ Health check timed out after 5 seconds`);
    } else {
      console.log(`   ❌ Health check error: ${error.message}`);
    }
    return false;
  }
}

async function testGraphQLSchema(url: string, serviceName: string) {
  try {
    console.log(`\n🔍 Testing ${serviceName} GraphQL schema: ${url}`);
    
    // Test introspection query to check if schema is valid
    const introspectionQuery = {
      query: `
        query IntrospectionQuery {
          __schema {
            types {
              name
            }
          }
        }
      `
    };
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(introspectionQuery),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`   ❌ GraphQL request failed: HTTP ${response.status}`);
      const text = await response.text();
      console.log(`   Response: ${text.substring(0, 200)}`);
      return false;
    }
    
    const result = await response.json();
    
    if (result.errors) {
      console.log(`   ❌ GraphQL schema errors:`);
      result.errors.forEach((error: any) => {
        console.log(`      - ${error.message}`);
        if (error.locations) {
          error.locations.forEach((loc: any) => {
            console.log(`        Line ${loc.line}, Column ${loc.column}`);
          });
        }
      });
      return false;
    }
    
    if (result.data && result.data.__schema) {
      const typeCount = result.data.__schema.types?.length || 0;
      console.log(`   ✅ GraphQL schema is valid (${typeCount} types found)`);
      
      // Check for any types with __ prefix (should not exist)
      const invalidTypes = result.data.__schema.types?.filter((t: any) => 
        t.name && t.name.startsWith('__') && !['__Schema', '__Type', '__Field', '__InputValue', '__EnumValue', '__Directive', '__TypeKind', '__Query', '__Mutation', '__Subscription'].includes(t.name)
      ) || [];
      
      if (invalidTypes.length > 0) {
        console.log(`   ⚠️  Warning: Found types with reserved __ prefix:`);
        invalidTypes.forEach((t: any) => {
          console.log(`      - ${t.name}`);
        });
      }
      
      return true;
    }
    
    console.log(`   ⚠️  Unexpected response format`);
    return false;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log(`   ❌ GraphQL request timed out after 10 seconds`);
    } else {
      console.log(`   ❌ GraphQL request error: ${error.message}`);
      if (error.stack) {
        console.log(`   Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
      }
    }
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    API TEST - GraphQL Schema                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  try {
    // Load configuration
    await loadScriptConfig();
    
    console.log(`📡 Auth Service URL: ${AUTH_SERVICE_URL}`);
    console.log(`📡 Payment Service URL: ${PAYMENT_SERVICE_URL}\n`);
    
    // Test health endpoints
    const authHealth = await testHealthEndpoint(AUTH_SERVICE_URL, 'Auth Service');
    const paymentHealth = await testHealthEndpoint(PAYMENT_SERVICE_URL, 'Payment Service');
    
    // Test GraphQL schemas
    const authSchema = await testGraphQLSchema(AUTH_SERVICE_URL, 'Auth Service');
    const paymentSchema = await testGraphQLSchema(PAYMENT_SERVICE_URL, 'Payment Service');
    
    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         TEST SUMMARY                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    console.log(`Auth Service:`);
    console.log(`  Health: ${authHealth ? '✅' : '❌'}`);
    console.log(`  GraphQL Schema: ${authSchema ? '✅' : '❌'}`);
    
    console.log(`\nPayment Service:`);
    console.log(`  Health: ${paymentHealth ? '✅' : '❌'}`);
    console.log(`  GraphQL Schema: ${paymentSchema ? '✅' : '❌'}`);
    
    const allPassed = authHealth && authSchema && paymentHealth && paymentSchema;
    
    if (allPassed) {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed. Check logs above for details.');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
