#!/usr/bin/env npx tsx
/**
 * Quick Service Health Check
 * 
 * Tests if all services are running and responding before running full test suite.
 * 
 * Usage:
 *   npx tsx typescript/test-services.ts
 */

import { 
  AUTH_SERVICE_URL,
  PAYMENT_SERVICE_URL,
  BONUS_SERVICE_URL,
  loadScriptConfig,
  initializeConfig,
} from './config/scripts.js';
import { initializeConfig as initUserConfig } from './config/users.js';

async function checkServiceHealth(url: string, serviceName: string): Promise<boolean> {
  const healthUrl = url.replace('/graphql', '/health');
  
  console.log(`\n🔍 Checking ${serviceName}...`);
  console.log(`   URL: ${healthUrl}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ Status: ${data.status || 'healthy'}`);
        console.log(`   📊 Response:`, JSON.stringify(data, null, 2));
        return true;
      } else {
        console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
        return false;
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.log(`   ⏱️  Timeout after 5 seconds`);
      } else {
        console.log(`   ❌ Error: ${fetchError.message}`);
      }
      return false;
    }
  } catch (error: any) {
    console.log(`   ❌ Failed: ${error.message}`);
    return false;
  }
}

async function testGraphQL(url: string, serviceName: string): Promise<boolean> {
  console.log(`\n🔍 Testing ${serviceName} GraphQL endpoint...`);
  console.log(`   URL: ${url}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    // Simple introspection query to test GraphQL
    const query = `query { __typename }`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const result = await response.json();
        if (result.errors) {
          console.log(`   ⚠️  GraphQL errors:`, result.errors);
          return false;
        }
        console.log(`   ✅ GraphQL responding`);
        console.log(`   📊 Response:`, JSON.stringify(result, null, 2));
        return true;
      } else {
        console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
        const text = await response.text();
        console.log(`   Response body: ${text.substring(0, 200)}`);
        return false;
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.log(`   ⏱️  Timeout after 10 seconds`);
      } else {
        console.log(`   ❌ Error: ${fetchError.message}`);
      }
      return false;
    }
  } catch (error: any) {
    console.log(`   ❌ Failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           SERVICE HEALTH CHECK                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  try {
    // Initialize config
    console.log('📋 Loading configuration...');
    await initUserConfig();
    await loadScriptConfig();
    console.log('✅ Configuration loaded\n');
    
    // Check service URLs are defined
    if (!AUTH_SERVICE_URL) {
      console.error('❌ AUTH_SERVICE_URL is not defined');
      process.exit(1);
    }
    if (!PAYMENT_SERVICE_URL) {
      console.error('❌ PAYMENT_SERVICE_URL is not defined');
      process.exit(1);
    }
    
    console.log('📡 Service URLs:');
    console.log(`   Auth: ${AUTH_SERVICE_URL}`);
    console.log(`   Payment: ${PAYMENT_SERVICE_URL}`);
    if (BONUS_SERVICE_URL) {
      console.log(`   Bonus: ${BONUS_SERVICE_URL}`);
    }
    
    // Test each service
    const results: Record<string, { health: boolean; graphql: boolean }> = {};
    
    // Auth Service
    const authHealth = await checkServiceHealth(AUTH_SERVICE_URL, 'Auth Service');
    const authGraphQL = await testGraphQL(AUTH_SERVICE_URL, 'Auth Service');
    results.auth = { health: authHealth, graphql: authGraphQL };
    
    // Payment Service
    const paymentHealth = await checkServiceHealth(PAYMENT_SERVICE_URL, 'Payment Service');
    const paymentGraphQL = await testGraphQL(PAYMENT_SERVICE_URL, 'Payment Service');
    results.payment = { health: paymentHealth, graphql: paymentGraphQL };
    
    // Bonus Service (optional)
    if (BONUS_SERVICE_URL) {
      const bonusHealth = await checkServiceHealth(BONUS_SERVICE_URL, 'Bonus Service');
      const bonusGraphQL = await testGraphQL(BONUS_SERVICE_URL, 'Bonus Service');
      results.bonus = { health: bonusHealth, graphql: bonusGraphQL };
    }
    
    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         SUMMARY                                   ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    let allHealthy = true;
    for (const [service, result] of Object.entries(results)) {
      const status = result.health && result.graphql ? '✅' : '❌';
      console.log(`${status} ${service.toUpperCase()}:`);
      console.log(`   Health: ${result.health ? '✅' : '❌'}`);
      console.log(`   GraphQL: ${result.graphql ? '✅' : '❌'}`);
      if (!result.health || !result.graphql) {
        allHealthy = false;
      }
    }
    
    if (allHealthy) {
      console.log('\n✅ All services are healthy and responding!\n');
      process.exit(0);
    } else {
      console.log('\n❌ Some services are not responding. Please check the services are running.\n');
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
