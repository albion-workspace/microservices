#!/usr/bin/env npx tsx
/**
 * Payment Test Suite - Runs all payment tests in correct order
 * 
 * Naming Convention: payment-{action}.ts
 * - payment-clean.ts: Cleanup payment data
 * - payment-setup.ts: Setup payment users
 * - payment-test-funding.ts: User-to-user funding test
 * - payment-test-flow.ts: Complete payment flow test
 * - payment-test-duplicate.ts: Duplicate protection test
 * - payment-test-ledger.ts: Ledger diagnostic test
 * - payment-test-all.ts: Run all tests in sequence (this file)
 * 
 * Order:
 * 1. Clean payment data (--full) - Removes all payment-related collections
 * 2. Wait for services - Ensures payment and auth services are ready
 * 3. Setup payment users - Creates users with proper roles/permissions via API
 * 4. Run payment tests:
 *    - User-to-User Funding: Tests user-to-user transfers
 *    - Complete Payment Flow: Tests full deposit flow with balance checks
 *    - Duplicate Protection: Tests idempotency and duplicate prevention
 *    - Ledger Funding Check: Diagnostic tool to verify ledger transactions
 * 
 * Usage: npx tsx scripts/payment-test-all.ts
 */

import { execSync } from 'child_process';
import { createHmac } from 'crypto';

const PAYMENT_SERVICE_URL = 'http://localhost:3004/graphql';
const AUTH_SERVICE_URL = 'http://localhost:3003/graphql';
const JWT_SECRET = process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production';

const ADMIN_EMAIL = 'admin@demo.com';
const ADMIN_PASSWORD = 'Admin123!@#';

// ═══════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════

function createJWT(payload: object, expiresIn: string = '8h'): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  let exp = now + 8 * 60 * 60;
  if (expiresIn.endsWith('h')) exp = now + parseInt(expiresIn) * 60 * 60;
  if (expiresIn.endsWith('m')) exp = now + parseInt(expiresIn) * 60;
  
  const fullPayload = { ...payload, iat: now, exp };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  
  return `${base64Header}.${base64Payload}.${signature}`;
}

async function graphql<T = any>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result: any = await response.json();

  if (result.errors) {
    const errorMessage = result.errors.map((e: any) => e.message).join('; ');
    throw new Error(`GraphQL Error: ${errorMessage}`);
  }

  return result.data as T;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForService(url: string, maxAttempts: number = 30): Promise<boolean> {
  const healthUrl = url.replace('/graphql', '/health');
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(healthUrl, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'healthy' || data.healthy === true) {
          return true;
        }
      }
    } catch (error) {
      // Service not ready yet
    }
    
    if (i < maxAttempts - 1) {
      await sleep(2000);
    }
  }
  
  return false;
}

async function login(): Promise<string> {
  console.log('🔐 Logging in...');
  
  const data = await graphql<{ login: { success: boolean; tokens?: { accessToken: string } } }>(
    AUTH_SERVICE_URL,
    `
      mutation Login($input: LoginInput!) {
        login(input: $input) {
          success
          tokens {
            accessToken
          }
        }
      }
    `,
    {
      input: {
        tenantId: 'default-tenant',
        identifier: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },
    }
  );

  if (!data.login.success || !data.login.tokens) {
    throw new Error('Login failed');
  }

  return data.login.tokens.accessToken;
}

// ═══════════════════════════════════════════════════════════════════
// Step 1: Clean Payment Data
// ═══════════════════════════════════════════════════════════════════

async function step1_CleanPaymentData() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           STEP 1: CLEAN PAYMENT DATA (--full)                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  try {
    execSync('npx tsx scripts/payment-clean.ts --full', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    console.log('\n✅ Payment data cleaned successfully!\n');
  } catch (error) {
    console.error('❌ Failed to clean payment data:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 2: Wait for Services
// ═══════════════════════════════════════════════════════════════════

async function step2_WaitForServices() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           STEP 2: WAITING FOR SERVICES                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  console.log('⏳ Waiting for Payment Service...');
  const paymentReady = await waitForService(PAYMENT_SERVICE_URL);
  if (!paymentReady) {
    throw new Error('Payment service did not become ready');
  }
  console.log('✅ Payment Service is ready');
  
  console.log('\n⏳ Waiting for Auth Service...');
  const authReady = await waitForService(AUTH_SERVICE_URL);
  if (!authReady) {
    throw new Error('Auth service did not become ready');
  }
  console.log('✅ Auth Service is ready\n');
}

// ═══════════════════════════════════════════════════════════════════
// Step 3: Create System Wallet
// ═══════════════════════════════════════════════════════════════════

async function step3_SetupPaymentUsers(token: string) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           STEP 3: SETUP PAYMENT USERS                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  // Run payment-setup script to create all required users
  try {
    execSync('npx tsx scripts/payment-setup.ts', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    console.log('\n✅ Payment users setup completed!\n');
  } catch (error) {
    console.error('❌ Failed to setup payment users:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 4-7: Run Tests
// ═══════════════════════════════════════════════════════════════════

async function step4_RunTests() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           STEP 4: RUNNING PAYMENT TESTS                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  const tests = [
    { 
      name: '1. User-to-User Funding', 
      script: 'payment-test-funding.ts',
      description: 'Tests user-to-user transfer (payment-gateway → payment-provider)'
    },
    { 
      name: '2. Complete Payment Flow', 
      script: 'payment-test-flow.ts',
      description: 'Tests complete flow: fund provider → user deposit → balance verification'
    },
    { 
      name: '3. Duplicate Protection', 
      script: 'payment-test-duplicate.ts',
      description: 'Tests idempotency and duplicate transaction protection'
    },
    { 
      name: '4. Ledger Funding Check', 
      script: 'payment-test-ledger.ts',
      description: 'Diagnostic: Verifies ledger transactions are created correctly'
    },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log(`\n${'═'.repeat(75)}`);
    console.log(`🧪 ${test.name}`);
    console.log(`   ${test.description}`);
    console.log('─'.repeat(75));
    
    try {
      execSync(`npx tsx scripts/${test.script}`, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      console.log(`\n✅ ${test.name} - PASSED\n`);
      passed++;
    } catch (error) {
      console.error(`\n❌ ${test.name} - FAILED`);
      failed++;
      // Continue with next test
    }
  }
  
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                         TEST SUMMARY                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`\n✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${tests.length}\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           PAYMENT TESTS SEQUENCE - COMPLETE TEST SUITE                ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Step 1: Clean data
    await step1_CleanPaymentData();
    
    // Step 2: Wait for services
    await step2_WaitForServices();
    
    // Step 3: Setup payment users (creates users with proper roles/permissions)
    const token = await login();
    await step3_SetupPaymentUsers(token);
    
    // Step 4: Run all tests
    await step4_RunTests();
    
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                    ALL TESTS COMPLETED                            ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
  } catch (error: any) {
    console.error('\n❌ Test sequence failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
