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
 * 1. Clean payment data (--full) - Removes all payment-related collections (at START)
 * 2. Wait for services - Ensures payment and auth services are ready
 * 3. Setup payment users - Creates users with proper roles/permissions via API
 * 4. Run payment tests:
 *    - User-to-User Funding: Tests user-to-user transfers
 *    - Complete Payment Flow: Tests full deposit flow with balance checks
 *    - Duplicate Protection: Tests idempotency and duplicate prevention
 *    - Ledger Funding Check: Diagnostic tool to verify ledger transactions
 * 5. Balance Summary - Shows comprehensive balance summary and verifies system integrity (at END, NO cleanup)
 * 
 * Note: Cleanup happens at the START only. Data is preserved at the end for inspection.
 * 
 * Usage: npx tsx scripts/typescript/payment/payment-test-all.ts
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
  
  try {
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
  } catch (error: any) {
    // If login fails, try to register the admin user first
    if (error.message?.includes('Login failed') || error.message?.includes('Invalid credentials')) {
      console.log('⚠️  Admin user not found. Attempting to register...');
      
      try {
        const registerData = await graphql<{ register: { success: boolean; user?: { id: string } } }>(
          AUTH_SERVICE_URL,
          `
            mutation Register($input: RegisterInput!) {
              register(input: $input) {
                success
                user {
                  id
                }
              }
            }
          `,
          {
            input: {
              tenantId: 'default-tenant',
              email: ADMIN_EMAIL,
              password: ADMIN_PASSWORD,
              autoVerify: true,
            },
          }
        );

        if (registerData.register.success && registerData.register.user) {
          const userId = registerData.register.user.id;
          console.log('✅ Admin user registered. Promoting to admin...');
          
          // Promote user to admin directly via MongoDB (bypasses permission checks)
          const { getAuthDatabase } = await import('../config/mongodb.js');
          const db = await getAuthDatabase();
          const usersCollection = db.collection('users');
          
          try {
            
            await usersCollection.updateOne(
              { id: userId },
              {
                $set: {
                  roles: ['admin', 'system'],
                  permissions: ['allowNegative', 'acceptFee', 'bonuses', '*:*:*'],
                  updatedAt: new Date(),
                },
              }
            );
            
            console.log('✅ User promoted to admin with full permissions');
          } finally {
            // Connection managed by centralized config
          }
          
          await sleep(1000); // Wait a moment for changes to propagate
          
          // Retry login
          const retryData = await graphql<{ login: { success: boolean; tokens?: { accessToken: string } } }>(
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

          if (!retryData.login.success || !retryData.login.tokens) {
            throw new Error('Login failed after registration and promotion');
          }

          return retryData.login.tokens.accessToken;
        } else {
          throw new Error('Registration failed');
        }
      } catch (regError: any) {
        throw new Error(`Login failed and registration also failed: ${regError.message}`);
      }
    }
    
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 1: Clean Payment Data
// ═══════════════════════════════════════════════════════════════════

async function step1_CleanPaymentData() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           STEP 1: CLEAN PAYMENT DATA (--full)                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  try {
    execSync('npx tsx scripts/typescript/payment/payment-clean.ts --full', {
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
    execSync('npx tsx scripts/typescript/payment/payment-setup.ts', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    console.log('\n✅ Payment users setup completed!\n');
    
    // Wait a moment for permissions to propagate
    await sleep(2000);
  } catch (error) {
    console.error('❌ Failed to setup payment users:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 4-7: Run Tests
// ═══════════════════════════════════════════════════════════════════

async function step4_RunTests(token: string) {
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
      console.log(`⏳ Running: ${test.script}...\n`);
      execSync(`npx tsx scripts/typescript/payment/${test.script}`, {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 300000, // 5 minutes timeout per test
      });
      console.log(`\n✅ ${test.name} - PASSED\n`);
      passed++;
    } catch (error: any) {
      if (error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
        console.error(`\n⏱️  ${test.name} - TIMED OUT (exceeded 5 minutes)`);
      } else {
        console.error(`\n❌ ${test.name} - FAILED: ${error.message || 'Unknown error'}`);
      }
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
  
  // Generate comprehensive balance summary (with timeout)
  console.log('⏳ Generating balance summary...\n');
  try {
    await Promise.race([
      step5_BalanceSummary(token),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Balance summary timeout after 2 minutes')), 120000)
      )
    ]);
  } catch (error: any) {
    console.error(`\n⚠️  Balance summary failed or timed out: ${error.message}`);
    console.log('Continuing without balance summary...\n');
  }
  
  if (failed > 0) {
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 5: Balance Summary & Verification
// ═══════════════════════════════════════════════════════════════════

async function step5_BalanceSummary(token: string) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           STEP 5: BALANCE SUMMARY & VERIFICATION                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  try {
    // Fetch all users - try GraphQL first, fallback to MongoDB if permissions fail
    let systemUsers: Array<{ id: string; email: string; roles: string[] }> = [];
    let gatewayUsers: Array<{ id: string; email: string; roles: string[] }> = [];
    let providerUsers: Array<{ id: string; email: string; roles: string[] }> = [];
    let allUsers: Array<{ id: string; email: string; roles: string[] }> = [];
    let endUsers: Array<{ id: string; email: string; roles: string[] }> = [];
    let allSystemUsers: Array<{ id: string; email: string; roles: string[] }> = [];
    
    try {
      const [systemUsersResult, gatewayUsersResult, providerUsersResult, systemRoleResult, allUsersResult] = await Promise.all([
        graphql<{ usersByRole: { nodes: Array<{ id: string; email: string; roles: string[] }> } }>(
          AUTH_SERVICE_URL,
          `query GetSystemUsers($first: Int) {
            usersByRole(role: "admin", first: $first) {
              nodes { id email roles }
            }
          }`,
          { first: 100 },
          token
        ).catch(() => ({ usersByRole: { nodes: [] } })),
      
      graphql<{ usersByRole: { nodes: Array<{ id: string; email: string; roles: string[] }> } }>(
        AUTH_SERVICE_URL,
        `query GetGatewayUsers($first: Int) {
          usersByRole(role: "payment-gateway", first: $first) {
            nodes { id email roles }
          }
        }`,
        { first: 100 },
        token
      ).catch(() => ({ usersByRole: { nodes: [] } })),
      
      graphql<{ usersByRole: { nodes: Array<{ id: string; email: string; roles: string[] }> } }>(
        AUTH_SERVICE_URL,
        `query GetProviderUsers($first: Int) {
          usersByRole(role: "payment-provider", first: $first) {
            nodes { id email roles }
          }
        }`,
        { first: 100 },
        token
      ).catch(() => ({ usersByRole: { nodes: [] } })),
      
      graphql<{ usersByRole: { nodes: Array<{ id: string; email: string; roles: string[] }> } }>(
        AUTH_SERVICE_URL,
        `query GetSystemRoleUsers($first: Int) {
          usersByRole(role: "system", first: $first) {
            nodes { id email roles }
          }
        }`,
        { first: 100 },
        token
      ).catch(() => ({ usersByRole: { nodes: [] } })),
      
      graphql<{ users: { nodes: Array<{ id: string; email: string; roles: string[] }> } }>(
        AUTH_SERVICE_URL,
        `query GetAllUsers($first: Int) {
          users(first: $first) {
            nodes { id email roles }
          }
        }`,
        { first: 100 },
        token
      ).catch(() => ({ users: { nodes: [] } })),
    ]);
    
    // Categorize users
    systemUsers = systemUsersResult.usersByRole?.nodes || [];
    gatewayUsers = gatewayUsersResult.usersByRole?.nodes || [];
    providerUsers = providerUsersResult.usersByRole?.nodes || [];
    const systemRoleUsers = systemRoleResult.usersByRole?.nodes || [];
    allUsers = allUsersResult.users?.nodes || [];
    
    let allSystemUsers = [...systemUsers, ...systemRoleUsers].filter((u, idx, arr) => 
      arr.findIndex(v => v.id === u.id) === idx
    );
    } catch (queryError: any) {
      // If GraphQL queries fail, fetch from MongoDB directly
      console.log('⚠️  GraphQL queries failed. Fetching users from MongoDB directly...');
      const { getAuthDatabase } = await import('../config/mongodb.js');
      const db = await getAuthDatabase();
      const usersCollection = db.collection('users');
      
      try {
        const allUsersDocs = await usersCollection.find({}).toArray();
        
        allUsers = allUsersDocs.map((doc: any) => ({
          id: doc.id || doc._id?.toString() || doc._id, // Handle both id and _id fields
          email: doc.email || (doc.id || doc._id?.toString() || doc._id)?.substring(0, 8),
          roles: Array.isArray(doc.roles) ? doc.roles : [],
        }));
        
        // Categorize by roles (handle UserRole[] format)
        allSystemUsers = allUsers.filter((u: any) => {
          const roles = Array.isArray(u.roles) ? u.roles : [];
          const roleNames = roles.map((r: any) => typeof r === 'string' ? r : r.role);
          return roleNames.includes('admin') || roleNames.includes('system');
        });
        gatewayUsers = allUsers.filter((u: any) => {
          const roles = Array.isArray(u.roles) ? u.roles : [];
          const roleNames = roles.map((r: any) => typeof r === 'string' ? r : r.role);
          return roleNames.includes('payment-gateway');
        });
        providerUsers = allUsers.filter((u: any) => {
          const roles = Array.isArray(u.roles) ? u.roles : [];
          const roleNames = roles.map((r: any) => typeof r === 'string' ? r : r.role);
          return roleNames.includes('payment-provider');
        });
        
        const allSystemIdsMongo = new Set(allSystemUsers.map((u: any) => u.id));
        const allGatewayIdsMongo = new Set(gatewayUsers.map((u: any) => u.id));
        const allProviderIdsMongo = new Set(providerUsers.map((u: any) => u.id));
        
        // End users: exclude system, gateway, and provider users
        endUsers = allUsers.filter((u: any) => {
          const roles = Array.isArray(u.roles) ? u.roles : [];
          const roleNames = roles.map((r: any) => typeof r === 'string' ? r : r.role);
          // Exclude if has any system/gateway/provider role
          return !roleNames.includes('admin') && 
                 !roleNames.includes('system') && 
                 !roleNames.includes('payment-gateway') && 
                 !roleNames.includes('payment-provider') &&
                 // Also exclude by ID set (double-check)
                 !allSystemIdsMongo.has(u.id) && 
                 !allGatewayIdsMongo.has(u.id) && 
                 !allProviderIdsMongo.has(u.id);
        });
        
        console.log(`✅ Found ${allUsers.length} users via MongoDB`);
      } finally {
        // Connection managed by centralized config
      }
    }
    
    // Filter regular users (end users) if not already done
    if (endUsers.length === 0 && allUsers.length > 0) {
      const systemIds = new Set(allSystemUsers.map((u: any) => u.id));
      const gatewayIds = new Set(gatewayUsers.map((u: any) => u.id));
      const providerIds = new Set(providerUsers.map((u: any) => u.id));
      endUsers = allUsers.filter((u: any) => 
        !systemIds.has(u.id) && !gatewayIds.has(u.id) && !providerIds.has(u.id)
      );
    }
    
    // Collect all user IDs
    let allUserIds: string[] = [
      ...allSystemUsers.map((u: any) => u.id),
      ...gatewayUsers.map((u: any) => u.id),
      ...providerUsers.map((u: any) => u.id),
      ...endUsers.map((u: any) => u.id),
    ];
    
    if (allUserIds.length === 0) {
      console.log('⚠️  No users found. Skipping balance summary.');
      return;
    }
    
    console.log('📊 Fetching ledger balances for all users...');
    
    // Check for duplicate transactions first (before balance summary)
    const { getPaymentDatabase } = await import('../config/mongodb.js');
    const db = await getPaymentDatabase();
    
    try {
      // Check for duplicate externalRefs in transactions collection
      const transactionsCollection = db.collection('transactions');
      const duplicateCheck = await transactionsCollection.aggregate([
        {
          $match: {
            'metadata.externalRef': { $exists: true, $ne: null }
          }
        },
        {
          $group: {
            _id: '$metadata.externalRef',
            count: { $sum: 1 },
            transactionIds: { $push: '$_id' }
          }
        },
        {
          $match: {
            count: { $gt: 1 }
          }
        }
      ]).toArray();
      
      if (duplicateCheck.length > 0) {
        console.log(`\n❌ WARNING: Found ${duplicateCheck.length} duplicate externalRefs in transactions:`);
        duplicateCheck.forEach((dup: any) => {
          console.log(`   - externalRef: ${dup._id} appears ${dup.count} times`);
          console.log(`     Transaction IDs: ${dup.transactionIds.slice(0, 3).map((id: any) => id.toString()).join(', ')}${dup.transactionIds.length > 3 ? '...' : ''}`);
        });
        console.log('');
      } else {
        console.log('✅ No duplicate externalRefs found in transactions\n');
      }
      
      // Also check ledger_transactions collection
      const ledgerTransactionsCollection = db.collection('ledger_transactions');
      const ledgerDuplicateCheck = await ledgerTransactionsCollection.aggregate([
        {
          $match: {
            externalRef: { $exists: true, $ne: null }
          }
        },
        {
          $group: {
            _id: '$externalRef',
            count: { $sum: 1 },
            transactionIds: { $push: '$_id' }
          }
        },
        {
          $match: {
            count: { $gt: 1 }
          }
        }
      ]).toArray();
      
      if (ledgerDuplicateCheck.length > 0) {
        console.log(`❌ WARNING: Found ${ledgerDuplicateCheck.length} duplicate externalRefs in ledger_transactions:`);
        ledgerDuplicateCheck.forEach((dup: any) => {
          console.log(`   - externalRef: ${dup._id} appears ${dup.count} times`);
          console.log(`     Transaction IDs: ${dup.transactionIds.slice(0, 3).map((id: any) => id.toString()).join(', ')}${dup.transactionIds.length > 3 ? '...' : ''}`);
        });
        console.log('');
      } else {
        console.log('✅ No duplicate externalRefs found in ledger_transactions\n');
      }
    } catch (error: any) {
      console.log(`⚠️  Could not check for duplicate transactions: ${error.message}\n`);
    }
    
    // Create balance map
    const balanceMap = new Map<string, number>();
    
    // Try GraphQL first, fallback to MongoDB if permissions fail
    try {
      const balancesResult = await graphql<{ bulkLedgerBalances: { balances: Array<{ userId: string; balance: number; availableBalance: number }> } }>(
        PAYMENT_SERVICE_URL,
        `query BulkLedgerBalances($userIds: [String!]!, $subtype: String!, $currency: String!) {
          bulkLedgerBalances(userIds: $userIds, subtype: $subtype, currency: $currency) {
            balances {
              userId
              balance
              availableBalance
            }
          }
        }`,
        {
          userIds: allUserIds,
          subtype: 'main',
          currency: 'EUR',
        },
        token
      );
      
      balancesResult.bulkLedgerBalances?.balances?.forEach(b => {
        balanceMap.set(b.userId, b.balance || 0);
      });
    } catch (balanceError: any) {
      // If GraphQL fails, fetch balances directly from MongoDB
      console.log('⚠️  GraphQL balance query failed. Fetching balances from MongoDB directly...');
      // db is already available from duplicate check above (reuse it)
      const ledgerAccountsCollection = db.collection('ledger_accounts');
      
      try {
        
        // Fetch all user accounts for the given user IDs
        const accountDocs = await ledgerAccountsCollection.find({
          ownerId: { $in: allUserIds },
          type: 'user',
          subtype: 'main',
          currency: 'EUR',
        }).toArray();
        
        accountDocs.forEach((doc: any) => {
          balanceMap.set(doc.ownerId, doc.balance || 0);
        });
        
        console.log(`✅ Fetched ${accountDocs.length} balances from MongoDB`);
      } finally {
        // Connection managed by centralized config
      }
    }
    
    // Calculate totals by category
    const systemBalances = allSystemUsers.map((u: any) => ({
      id: u.id,
      email: u.email || u.id.substring(0, 8),
      balance: balanceMap.get(u.id) || 0,
    }));
    const systemTotal = systemBalances.reduce((sum, u) => sum + u.balance, 0);
    
    const gatewayBalances = gatewayUsers.map((u: any) => ({
      id: u.id,
      email: u.email || u.id.substring(0, 8),
      balance: balanceMap.get(u.id) || 0,
    }));
    const gatewayTotal = gatewayBalances.reduce((sum, u) => sum + u.balance, 0);
    
    const providerBalances = providerUsers.map((u: any) => ({
      id: u.id,
      email: u.email || u.id.substring(0, 8),
      balance: balanceMap.get(u.id) || 0,
    }));
    const providerTotal = providerBalances.reduce((sum, u) => sum + u.balance, 0);
    
    const endUserBalances = endUsers.map((u: any) => ({
      id: u.id,
      email: u.email || u.id.substring(0, 8),
      balance: balanceMap.get(u.id) || 0,
    }));
    const endUserTotal = endUserBalances.reduce((sum, u) => sum + u.balance, 0);
    
    // Get fee-collection account balance (fees accumulate here)
    // db is already available from duplicate check above (reuse it)
    const feeCollectionAccount = await db.collection('ledger_accounts').findOne({
      ownerId: 'fee-collection',
      type: 'user',
      currency: 'EUR',
    });
    const feeCollectionBalance = feeCollectionAccount?.balance || 0;
    
    // Calculate grand total (include fee-collection as system account)
    const grandTotal = systemTotal + gatewayTotal + providerTotal + endUserTotal + feeCollectionBalance;
    
    // Format currency
    const formatAmount = (amount: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount / 100);
    };
    
    // Display summary
    console.log('\n' + '═'.repeat(75));
    console.log('💰 BALANCE SUMMARY (EUR)');
    console.log('═'.repeat(75));
    
    console.log('\n📌 SYSTEM USERS (Admin/System):');
    if (systemBalances.length === 0) {
      console.log('   (none)');
    } else {
      systemBalances.forEach(u => {
        const sign = u.balance >= 0 ? '+' : '';
        console.log(`   ${u.email.padEnd(30)} ${sign}${formatAmount(u.balance)}`);
      });
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL SYSTEM:${' '.repeat(20)} ${formatAmount(systemTotal)}`);
    }
    
    console.log('\n🏦 GATEWAY USERS (Payment Gateway):');
    if (gatewayBalances.length === 0) {
      console.log('   (none)');
    } else {
      gatewayBalances.forEach(u => {
        console.log(`   ${u.email.padEnd(30)} ${formatAmount(u.balance)}`);
      });
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL GATEWAY:${' '.repeat(19)} ${formatAmount(gatewayTotal)}`);
    }
    
    console.log('\n💳 PROVIDER USERS (Payment Providers):');
    if (providerBalances.length === 0) {
      console.log('   (none)');
    } else {
      providerBalances.forEach(u => {
        console.log(`   ${u.email.padEnd(30)} ${formatAmount(u.balance)}`);
      });
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL PROVIDERS:${' '.repeat(17)} ${formatAmount(providerTotal)}`);
    }
    
    console.log('\n👥 END USERS (Regular Users):');
    if (endUserBalances.length === 0) {
      console.log('   (none)');
    } else {
      const topEndUsers = endUserBalances
        .filter(u => u.balance !== 0)
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .slice(0, 10);
      
      if (topEndUsers.length === 0) {
        console.log('   (all zero balance)');
      } else {
        topEndUsers.forEach(u => {
          console.log(`   ${u.email.padEnd(30)} ${formatAmount(u.balance)}`);
        });
        if (endUserBalances.length > 10) {
          console.log(`   ... and ${endUserBalances.length - 10} more users`);
        }
      }
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL END USERS:${' '.repeat(16)} ${formatAmount(endUserTotal)}`);
    }
    
    console.log('\n' + '═'.repeat(75));
    console.log('📊 GRAND TOTALS');
    console.log('═'.repeat(75));
    console.log(`   System Users:     ${formatAmount(systemTotal).padStart(15)}`);
    console.log(`   Gateway Users:    ${formatAmount(gatewayTotal).padStart(15)}`);
    console.log(`   Provider Users:   ${formatAmount(providerTotal).padStart(15)}`);
    console.log(`   End Users:        ${formatAmount(endUserTotal).padStart(15)}`);
    console.log(`   Fee Collection:   ${formatAmount(feeCollectionBalance).padStart(15)}`);
    console.log(`   ${'─'.repeat(50)}`);
    console.log(`   GRAND TOTAL:      ${formatAmount(grandTotal).padStart(15)}`);
    console.log('═'.repeat(75));
    
    // Verification: Check for money loss
    console.log('\n🔍 VERIFICATION:');
    
    // In a user-to-user ledger system, the sum should be zero (conservation of money)
    // System can go negative (represents platform net position)
    // Providers and end users should be positive or zero
    const isBalanced = Math.abs(grandTotal) < 1; // Allow for rounding errors (1 cent)
    
    if (isBalanced) {
      console.log('   ✅ System is balanced (sum ≈ 0) - No money lost!');
    } else {
      console.log(`   ⚠️  System imbalance detected: ${formatAmount(grandTotal)}`);
      console.log('   ⚠️  This may indicate:');
      console.log('      - System user (admin@demo.com) has negative balance (normal for platform net position)');
      console.log('      - Or there is a data inconsistency');
      
      if (grandTotal < 0) {
        console.log(`   ℹ️  System is ${formatAmount(Math.abs(grandTotal))} in debt (normal if platform owes money)`);
      } else {
        console.log(`   ⚠️  System has ${formatAmount(grandTotal)} extra (investigate!)`);
      }
    }
    
    // Check for negative balances where they shouldn't be
    // System users (admin/system) can go negative - that's expected
    // Only check providers and end users
    const negativeProviders = providerBalances.filter(u => u.balance < 0);
    const negativeEndUsers = endUserBalances.filter(u => {
      // Double-check: exclude any users that might have admin/system roles
      const user = endUsers.find(eu => eu.id === u.id);
      if (!user) return false;
      const roles = Array.isArray(user.roles) ? user.roles : [];
      const roleNames = roles.map((r: any) => typeof r === 'string' ? r : r.role);
      // Only flag if truly an end user (no admin/system roles)
      return u.balance < 0 && !roleNames.includes('admin') && !roleNames.includes('system');
    });
    
    if (negativeProviders.length > 0) {
      console.log(`\n   ⚠️  WARNING: ${negativeProviders.length} provider(s) have negative balances:`);
      negativeProviders.forEach(u => {
        console.log(`      ${u.email}: ${formatAmount(u.balance)}`);
      });
    }
    
    if (negativeEndUsers.length > 0) {
      console.log(`\n   ⚠️  WARNING: ${negativeEndUsers.length} end user(s) have negative balances:`);
      negativeEndUsers.slice(0, 5).forEach(u => {
        console.log(`      ${u.email}: ${formatAmount(u.balance)}`);
      });
      if (negativeEndUsers.length > 5) {
        console.log(`      ... and ${negativeEndUsers.length - 5} more`);
      }
    }
    
    if (negativeProviders.length === 0 && negativeEndUsers.length === 0) {
      console.log('   ✅ No unexpected negative balances found');
    }
    
    // Show fee collection balance
    if (feeCollectionBalance > 0) {
      console.log(`\n   ℹ️  Fee Collection Account: ${formatAmount(feeCollectionBalance)} (fees collected from transactions)`);
    }
    
    console.log('\n' + '═'.repeat(75) + '\n');
    
  } catch (error: any) {
    console.error('\n❌ Failed to generate balance summary:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    // Close MongoDB connections
    const { closeAllConnections } = await import('../config/mongodb.js');
    await closeAllConnections();
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
    // Step 1: Clean data at the start (fresh start for tests)
    await step1_CleanPaymentData();
    
    // Step 2: Wait for services
    await step2_WaitForServices();
    
    // Step 3: Setup payment users (creates users with proper roles/permissions)
    // Get initial token for setup (may not have full permissions yet)
    const initialToken = await login();
    await step3_SetupPaymentUsers(initialToken);
    
    // Ensure admin user has correct permissions (verify and promote if needed)
    console.log('\n🔍 Verifying admin user permissions...\n');
            const { getAuthDatabase } = await import('../config/mongodb.js');
            const db = await getAuthDatabase();
            
            try {
      const usersCollection = db.collection('users');
      const adminUser = await usersCollection.findOne({ email: ADMIN_EMAIL });
      
      if (adminUser) {
        // Check if roles are in UserRole[] format (array of objects) or string[] format
        const rolesArray = Array.isArray(adminUser.roles) ? adminUser.roles : [];
        const roleNames = rolesArray.map((r: any) => typeof r === 'string' ? r : r.role);
        const hasAdminRole = roleNames.includes('admin');
        const hasFullPermissions = Array.isArray(adminUser.permissions) && 
          (adminUser.permissions.includes('*:*:*') || adminUser.permissions.includes('*'));
        
        if (!hasAdminRole || !hasFullPermissions) {
          console.log('⚠️  Admin user missing permissions. Promoting...');
          // Convert roles to UserRole[] format
          const newRolesArray = [
            { role: 'admin', assignedAt: new Date(), active: true },
            { role: 'system', assignedAt: new Date(), active: true },
          ];
          
          await usersCollection.updateOne(
            { email: ADMIN_EMAIL },
            {
              $set: {
                roles: newRolesArray,
                permissions: ['allowNegative', 'acceptFee', 'bonuses', '*:*:*'],
                updatedAt: new Date(),
              },
            }
          );
          console.log('✅ Admin user promoted with full permissions');
          
          // Verify the update was successful
          const updatedUser = await usersCollection.findOne({ email: ADMIN_EMAIL });
          console.log(`   Roles: ${JSON.stringify(updatedUser?.roles)}`);
          console.log(`   Permissions: ${JSON.stringify(updatedUser?.permissions)}`);
          
          await sleep(3000); // Wait longer for changes to propagate
        } else {
          console.log('✅ Admin user has correct permissions');
          console.log(`   Roles: ${JSON.stringify(adminUser.roles)}`);
          console.log(`   Permissions: ${JSON.stringify(adminUser.permissions)}`);
        }
      } else {
        console.log('⚠️  Admin user not found in database!');
      }
      } finally {
        const { closeAllConnections } = await import('../config/mongodb.js');
        await closeAllConnections();
      }
    
    // Re-login after setup to get fresh token with updated permissions
    console.log('\n🔄 Refreshing admin token with updated permissions...\n');
    await sleep(2000); // Wait for permissions to propagate
    const token = await login();
    
    // Verify token has admin permissions by trying a simple admin query
    try {
      await graphql<{ me: { roles: string[] } }>(
        AUTH_SERVICE_URL,
        `query { me { roles } }`,
        {},
        token
      );
      console.log('✅ Token verified - admin permissions active\n');
    } catch (error: any) {
      console.log(`⚠️  Token verification failed: ${error.message}\n`);
    }
    
    // Step 4: Run all tests (includes balance summary at the end - NO cleanup)
    await step4_RunTests(token);
    
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
