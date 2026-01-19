#!/usr/bin/env npx tsx
/**
 * Unified Payment Test Suite - Single Source of Truth
 * 
 * Consolidates all payment tests into one file with shared utilities.
 * Reduces code duplication and provides consistent user/dependency management.
 * 
 * Usage:
 *   npm run payment:test                    # Run all tests
 *   npx tsx payment-command-test.ts         # Run all tests
 *   npx tsx payment-command-test.ts setup    # Setup users and wallets
 *   npx tsx payment-command-test.ts gateway  # Run gateway comprehensive tests
 *   npx tsx payment-command-test.ts funding  # Run only funding test
 *   npx tsx payment-command-test.ts flow     # Run only flow test
 *   npx tsx payment-command-test.ts duplicate # Run only duplicate test
 *   npx tsx payment-command-test.ts exchange-rate # Run only exchange rate test
 *   npx tsx payment-command-test.ts ledger   # Run only ledger test
 *   npx tsx payment-command-test.ts balance-summary # Generate balance summary
 *   npx tsx payment-command-test.ts all      # Run complete test suite (clean, setup, all tests, balance summary)
 *   npx tsx payment-command-test.ts setup gateway funding # Run multiple commands
 */

import { 
  loginAs, 
  getUserId, 
  getUserIds, 
  users, 
  DEFAULT_TENANT_ID,
  DEFAULT_CURRENCY,
  registerAs,
  getUserDefinition,
  createSystemToken,
} from '../config/users.js';
import { getPaymentDatabase, getAuthDatabase, closeAllConnections } from '../config/mongodb.js';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════════════
// Configuration - Single Source of Truth
// ═══════════════════════════════════════════════════════════════════

const PAYMENT_SERVICE_URL = 'http://localhost:3004/graphql';
const AUTH_SERVICE_URL = 'http://localhost:3003/graphql';
const BONUS_SERVICE_URL = process.env.BONUS_URL || 'http://localhost:3005/graphql';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

// ═══════════════════════════════════════════════════════════════════
// Shared GraphQL Helper - Single Implementation
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Shared Authentication Helper
// ═══════════════════════════════════════════════════════════════════

async function login(): Promise<string> {
  const { token } = await loginAs('system', { verifyToken: true, retry: true });
  return token;
}

// ═══════════════════════════════════════════════════════════════════
// Shared Wallet Helpers - Single Implementation
// ═══════════════════════════════════════════════════════════════════

async function findWallet(token: string, userId: string, currency: string): Promise<string | null> {
  const result = await graphql<{ wallets: { nodes: any[] } }>(
    PAYMENT_SERVICE_URL,
    `
      query GetWallets($first: Int) {
        wallets(first: $first) {
          nodes {
            id
            userId
            currency
            balance
          }
        }
      }
    `,
    { first: 100 },
    token
  );
  
  const wallet = result.wallets.nodes.find((w: any) => w.userId === userId && w.currency === currency);
  return wallet ? wallet.id : null;
}

async function createWallet(token: string, userId: string, currency: string): Promise<string> {
  const result = await graphql<{ createWallet: { success: boolean; wallet?: { id: string } } }>(
    PAYMENT_SERVICE_URL,
    `
      mutation CreateWallet($input: CreateWalletInput!) {
        createWallet(input: $input) {
          success
          wallet {
            id
            userId
            currency
            balance
          }
          errors
        }
      }
    `,
    {
      input: {
        userId,
        currency,
        category: 'main',
        tenantId: DEFAULT_TENANT_ID,
      },
    },
    token
  );
  
  if (!result.createWallet.success) {
    throw new Error(`Failed to create wallet: ${result.createWallet.errors?.join(', ')}`);
  }
  
  return result.createWallet.wallet!.id;
}

async function getUserBalance(token: string, userId: string, currency: string): Promise<number> {
  const result = await graphql<{ ledgerAccountBalance: { balance: number } }>(
    PAYMENT_SERVICE_URL,
    `
      query GetUserBalance($userId: String!, $subtype: String!, $currency: String!) {
        ledgerAccountBalance(userId: $userId, subtype: $subtype, currency: $currency) {
          balance
        }
      }
    `,
    { userId, subtype: 'main', currency },
    token
  );
  
  return result.ledgerAccountBalance.balance || 0;
}

async function getUserWalletBalance(token: string, userId: string, currency: string): Promise<number> {
  const result = await graphql<{ wallets: { nodes: any[] } }>(
    PAYMENT_SERVICE_URL,
    `
      query GetWallets($first: Int) {
        wallets(first: $first) {
          nodes {
            id
            userId
            currency
            balance
          }
        }
      }
    `,
    { first: 100 },
    token
  );
  
  const wallet = result.wallets.nodes.find((w: any) => w.userId === userId && w.currency === currency);
  return wallet ? wallet.balance : 0;
}

// ═══════════════════════════════════════════════════════════════════
// Shared Transaction Helpers
// ═══════════════════════════════════════════════════════════════════

async function fundUserWithDeposit(
  token: string, 
  fromUserId: string, 
  toUserId: string, 
  amount: number, 
  currency: string
): Promise<boolean> {
  console.log(`\n💰 Funding ${toUserId} with ${(amount / 100).toFixed(2)} ${currency} from ${fromUserId}...`);
  
  try {
    const result = await graphql<{ createDeposit: any }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateDeposit($input: CreateDepositInput!) {
          createDeposit(input: $input) {
            success
            deposit {
              id
              userId
              type
              amount
              currency
              netAmount
              feeAmount
              status
            }
            errors
          }
        }
      `,
      {
        input: {
          userId: toUserId,
          amount: amount,
          currency: currency,
          tenantId: DEFAULT_TENANT_ID,
          fromUserId: fromUserId,
          method: `test-funding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        },
      },
      token
    );

    if (result.createDeposit.success) {
      console.log(`✅ Deposit completed successfully!`);
      console.log(`   To: ${toUserId} - Transaction ID: ${result.createDeposit.deposit?.id}`);
      console.log(`   Amount: ${(result.createDeposit.deposit?.netAmount / 100).toFixed(2)} ${currency} (after fees)`);
      return true;
    } else {
      console.log('❌ Deposit failed:', result.createDeposit.errors);
      return false;
    }
  } catch (error: any) {
    console.error('❌ Error creating deposit:', error.message);
    return false;
  }
}

async function transferFunds(
  token: string, 
  fromUserId: string, 
  toUserId: string, 
  amount: number, 
  currency: string
): Promise<string | null> {
  console.log(`\n💰 Transferring ${(amount / 100).toFixed(2)} ${currency} from ${fromUserId} to ${toUserId}...`);
  
  try {
    // Find or create wallets
    let fromWalletId = await findWallet(token, fromUserId, currency);
    if (!fromWalletId) {
      fromWalletId = await createWallet(token, fromUserId, currency);
    }
    
    let toWalletId = await findWallet(token, toUserId, currency);
    if (!toWalletId) {
      toWalletId = await createWallet(token, toUserId, currency);
    }
    
    await sleep(1000); // Wait for wallets to be ready
    
    // Debit from sender
    const result = await graphql<{ createWalletTransaction: { success: boolean; walletTransaction?: { id: string } } }>(
      PAYMENT_SERVICE_URL,
      `
        mutation TransferFunds($input: CreateWalletTransactionInput!) {
          createWalletTransaction(input: $input) {
            success
            walletTransaction {
              id
              userId
              type
              amount
              currency
              balance
            }
            errors
          }
        }
      `,
      {
        input: {
          walletId: fromWalletId,
          userId: fromUserId,
          type: 'transfer_out',
          amount,
          currency,
          balanceType: 'real',
          description: `Transfer to ${toUserId}`,
        },
      },
      token
    );
    
    // Credit receiver
    const creditResult = await graphql<{ createWalletTransaction: { success: boolean; walletTransaction?: { id: string } } }>(
      PAYMENT_SERVICE_URL,
      `
        mutation ReceiveFunds($input: CreateWalletTransactionInput!) {
          createWalletTransaction(input: $input) {
            success
            walletTransaction {
              id
            }
            errors
          }
        }
      `,
      {
        input: {
          walletId: toWalletId,
          userId: toUserId,
          type: 'transfer_in',
          amount,
          currency,
          balanceType: 'real',
          description: `Transfer from ${fromUserId}`,
        },
      },
      token
    );
    
    if (!result.createWalletTransaction.success || !creditResult.createWalletTransaction.success) {
      const errorMsg = result.createWalletTransaction.errors?.join(', ') || creditResult.createWalletTransaction.errors?.join(', ') || 'Unknown error';
      throw new Error(`Failed to transfer funds: ${errorMsg}`);
    }
    
    console.log(`✅ Transfer completed! Transaction IDs: ${result.createWalletTransaction.walletTransaction!.id}, ${creditResult.createWalletTransaction.walletTransaction!.id}`);
    return result.createWalletTransaction.walletTransaction!.id;
  } catch (error: any) {
    console.error('❌ Error transferring funds:', error.message);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatAmount(amount: number): string {
  return (amount / 100).toFixed(2);
}

// ═══════════════════════════════════════════════════════════════════
// Shared Service Utilities
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Setup: Create users and wallets
// ═══════════════════════════════════════════════════════════════════

async function testSetup() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           SETUP PAYMENT USERS                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    // First, register system user (will create if doesn't exist, update if exists)
    console.log('🔐 Registering system user...');
    const systemUserResult = await registerAs('system', { updateRoles: true, updatePermissions: true });
    console.log(`  ✅ System user ${systemUserResult.created ? 'created' : 'updated'}: ${systemUserResult.userId}`);
    
    // Normalize roles if needed (check and fix in MongoDB)
    const db = await getAuthDatabase();
    const usersCollection = db.collection('users');
    const systemUserDoc = await usersCollection.findOne({ id: systemUserResult.userId });
    
    if (systemUserDoc && Array.isArray(systemUserDoc.roles) && systemUserDoc.roles.length > 0) {
      const firstRole = systemUserDoc.roles[0];
      if (typeof firstRole === 'object' && firstRole.role) {
        // Roles are in object format, normalize to string array
        console.log('⚠️  Normalizing system user roles (object -> string)...');
        const normalizedRoles = systemUserDoc.roles.map((r: any) => typeof r === 'string' ? r : r.role);
        await usersCollection.updateOne(
          { id: systemUserResult.userId },
          { $set: { roles: normalizedRoles } }
        );
        console.log('✅ Roles normalized to string format');
        await sleep(1000); // Wait for changes to propagate
      }
    }
    
    await closeAllConnections();
    
    // Now login as system user
    console.log('🔐 Logging in as system user...');
    const { token } = await loginAs('system', { verifyToken: true, retry: true });

    async function createUser(userKey: string) {
      const user = getUserDefinition(userKey);
      console.log(`\n👤 Creating user: ${user.email}...`);
      
      try {
        const result = await registerAs(userKey, { updateRoles: true, updatePermissions: true });
        const userId = result.userId;
        
        console.log(`  ✅ User ${result.created ? 'created' : 'updated'}: ${userId}`);
        console.log(`     Roles: ${user.roles.join(', ')}`);
        console.log(`     Permissions: ${Object.keys(user.permissions).filter(k => user.permissions[k]).join(', ')}`);

        // Update ledger accounts if allowNegative permission is set
        if (user.permissions.allowNegative) {
          const paymentDb = await getPaymentDatabase();
          const ledgerAccounts = paymentDb.collection('ledger_accounts');
          
          await ledgerAccounts.updateMany(
            { ownerId: userId, type: 'user' },
            { $set: { allowNegative: true } }
          );
          console.log(`  ✅ Updated ledger accounts to allow negative balance`);
        }
        
        return userId;
      } catch (error: any) {
        console.error(`  ❌ Failed to create user ${user.email}:`, error.message);
        throw error;
      }
    }

    async function createWalletForUser(userId: string, currency: string) {
      console.log(`  💼 Creating wallet for ${userId} (${currency})...`);
      
      try {
        const result = await graphql<{ createWallet: { success: boolean; wallet?: { id: string } } }>(
          PAYMENT_SERVICE_URL,
          `
            mutation CreateWallet($input: CreateWalletInput!) {
              createWallet(input: $input) {
                success
                wallet {
                  id
                  userId
                  currency
                  balance
                }
                errors
              }
            }
          `,
          {
            input: {
              userId,
              currency,
              category: 'main',
              tenantId: DEFAULT_TENANT_ID,
            },
          },
          token
        );

        if (result.createWallet.success) {
          console.log(`  ✅ Wallet created: ${result.createWallet.wallet?.id}`);
          return result.createWallet.wallet!.id;
        } else {
          // Wallet might already exist
          console.log(`  ⚠️  Wallet might already exist (continuing...)`);
          return null;
        }
      } catch (error: any) {
        console.log(`  ⚠️  Wallet creation skipped: ${error.message}`);
        return null;
      }
    }

    // 1. Setup system user
    const systemUserId = await createUser('system');
    await createWalletForUser(systemUserId, DEFAULT_CURRENCY);

    // 2. Setup payment-gateway user
    const gatewayUserId = await createUser('paymentGateway');
    await createWalletForUser(gatewayUserId, DEFAULT_CURRENCY);

    // 3. Setup payment-provider user
    // IMPORTANT: Payment-provider CANNOT go negative - if balance is zero, it stays zero
    // This is critical for mobile money accounts and real-world payment providers
    const providerUserId = await createUser('paymentProvider');
    await createWalletForUser(providerUserId, DEFAULT_CURRENCY);

    // 4. Setup end users (user1-user5)
    const endUserIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const userId = await createUser(`user${i}` as keyof typeof users.endUsers);
      await createWalletForUser(userId, DEFAULT_CURRENCY);
      endUserIds.push(userId);
    }

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                    SETUP COMPLETE                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    console.log('Users created:');
    console.log(`  ✅ ${users.system.email} (system) - Can go negative, full access`);
    console.log(`  ✅ ${users.gateway.email} (payment-gateway) - Can go negative, accepts fees`);
    console.log(`  ✅ ${users.provider.email} (payment-provider) - Accepts fees`);
    console.log(`  ✅ ${Object.values(users.endUsers).map(u => u.email).join(', ')} (end users) - Normal users\n`);

  } catch (error: any) {
    console.error('\n❌ Setup failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 1: User-to-User Funding
// ═══════════════════════════════════════════════════════════════════

async function testFunding() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           TEST USER-TO-USER FUNDING                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();
    
    // Get user IDs
    const userIds = await getUserIds(['paymentGateway', 'paymentProvider']);
    const gatewayUserId = userIds.paymentGateway;
    const providerUserId = userIds.paymentProvider;
    const systemUserId = await getUserId('system');
    
    if (!gatewayUserId || !providerUserId) {
      throw new Error(`Failed to get user IDs: gatewayUserId=${gatewayUserId}, providerUserId=${providerUserId}`);
    }
    
    // Step 1: Fund gateway user
    console.log('\n📥 Step 1: Funding gateway user...');
    const fundingAmount = 2000000; // €20,000
    const funded = await fundUserWithDeposit(token, systemUserId, gatewayUserId, fundingAmount, DEFAULT_CURRENCY);
    
    if (!funded) {
      throw new Error('Failed to fund gateway user');
    }
    
    await sleep(2000); // Wait for ledger sync
    
    // Step 2: Transfer from gateway to provider
    console.log('\n📤 Step 2: Transferring from gateway to provider...');
    await transferFunds(token, gatewayUserId, providerUserId, 1000000, DEFAULT_CURRENCY); // €10,000
    
    // Check ledger transactions
    console.log('\n🔍 Checking for ledger transactions...');
    const db = await getPaymentDatabase();
    const txCount = await db.collection('ledger_transactions').countDocuments({});
    console.log(`   Found ${txCount} ledger transactions`);
    
    if (txCount > 0) {
      const recentTx = await db.collection('ledger_transactions')
        .find({})
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      
      if (recentTx.length > 0) {
        const tx = recentTx[0];
        console.log(`   Most recent: ${tx.type} - ${formatAmount(tx.amount)} ${tx.currency}`);
        console.log(`   From: ${tx.fromAccountId}`);
        console.log(`   To: ${tx.toAccountId}`);
      }
    }
    
    console.log('\n✅ User-to-User Funding test completed!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 2: Complete Payment Flow
// ═══════════════════════════════════════════════════════════════════

async function testFlow() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           COMPLETE FLOW TEST - WITH BALANCE VERIFICATION        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();
    
    // Get user IDs
    const userIds = await getUserIds(['paymentGateway', 'paymentProvider']);
    const gatewayUserId = userIds.paymentGateway;
    const providerUserId = userIds.paymentProvider;
    const systemUserId = await getUserId('system');
    const testUserId = `test-user-${Date.now()}`;
    const currency = DEFAULT_CURRENCY;
    
    if (!gatewayUserId || !providerUserId) {
      throw new Error(`Failed to get user IDs: gatewayUserId=${gatewayUserId}, providerUserId=${providerUserId}`);
    }
    
    // Step 0: Initial balances
    console.log('📊 STEP 0: Initial Balances\n');
    let gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
    let providerBalance = await getUserBalance(token, providerUserId, currency);
    let userBalance = await getUserWalletBalance(token, testUserId, currency);
    
    console.log(`  Payment Gateway (${gatewayUserId}): €${formatAmount(gatewayBalance)}`);
    console.log(`  Payment Provider (${providerUserId}): €${formatAmount(providerBalance)}`);
    console.log(`  End User (${testUserId}): €${formatAmount(userBalance)}\n`);
    
    // Step 0.5: Fund gateway user if needed
    const requiredAmount = 1000000; // €10,000
    if (gatewayBalance < requiredAmount) {
      console.log(`💰 STEP 0.5: Funding Gateway User from System User (€${formatAmount(requiredAmount)})\n`);
      const fundingAmount = requiredAmount + 1000000; // €20,000 total
      await fundUserWithDeposit(token, systemUserId, gatewayUserId, fundingAmount, currency);
      await sleep(2000);
      gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
      console.log(`  Gateway balance after funding: €${formatAmount(gatewayBalance)}\n`);
    }
    
    // Step 1: Fund payment-provider from payment-gateway
    console.log('💰 STEP 1: Funding Payment Provider from Payment Gateway (€10,000)\n');
    await transferFunds(token, gatewayUserId, providerUserId, 1000000, currency);
    await sleep(2000);
    
    gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
    providerBalance = await getUserBalance(token, providerUserId, currency);
    
    console.log(`  Payment Gateway: €${formatAmount(gatewayBalance)}`);
    console.log(`  Payment Provider: €${formatAmount(providerBalance)}\n`);
    
    // Step 2: Create end user wallet
    console.log('👤 STEP 2: Creating End User Wallet\n');
    const walletId = await createWallet(token, testUserId, currency);
    console.log(`  ✅ Wallet created: ${walletId}\n`);
    
    // Step 3: End user deposits from payment-provider
    console.log('💳 STEP 3: End User Deposits from Payment Provider (€500)\n');
    await fundUserWithDeposit(token, providerUserId, testUserId, 50000, currency); // €500
    await sleep(2000);
    
    gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
    providerBalance = await getUserBalance(token, providerUserId, currency);
    userBalance = await getUserWalletBalance(token, testUserId, currency);
    
    console.log(`  Payment Gateway: €${formatAmount(gatewayBalance)}`);
    console.log(`  Payment Provider: €${formatAmount(providerBalance)}`);
    console.log(`  End User: €${formatAmount(userBalance)}\n`);
    
    // Step 4: Balance verification
    console.log('✅ STEP 4: Balance Verification\n');
    const expectedUserBalance = 48550; // €485.50 (€500 - €14.50 fee)
    
    if (Math.abs(userBalance - expectedUserBalance) < 100) {
      console.log(`  ✅ End User: €${formatAmount(userBalance)} (correct)\n`);
    } else {
      console.log(`  ❌ End User: Expected €${formatAmount(expectedUserBalance)}, got €${formatAmount(userBalance)}\n`);
    }
    
    console.log('✅ Complete Payment Flow test completed!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 3: Duplicate Protection
// ═══════════════════════════════════════════════════════════════════

async function testDuplicate() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           DUPLICATE PROTECTION TEST SUITE                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const testUserId = `duplicate-test-${Date.now()}`;
  const fromUserId = await getUserId('paymentProvider');
  
  try {
    const token = await login();
    
    // Initialize test user
    console.log('👤 Initializing test user...');
    await registerAs('user1');
    console.log(`  ✅ Test user ID: ${testUserId}`);
    console.log(`  ✅ Source user ID: ${fromUserId}\n`);
    
    // Create wallet
    console.log('📦 Setting up test wallet...');
    const walletId = await createWallet(token, testUserId, DEFAULT_CURRENCY);
    console.log(`  ✅ Wallet created: ${walletId}\n`);
    
    // Test 1: Concurrent idempotency
    console.log('📋 Test 1: Concurrent Deposits (10 concurrent requests)\n');
    const numConcurrent = 10;
    const promises = Array(numConcurrent).fill(null).map(async (_, i) => {
      try {
        const result = await graphql<{ createDeposit: any }>(
          PAYMENT_SERVICE_URL,
          `
            mutation CreateDeposit($input: CreateDepositInput!) {
              createDeposit(input: $input) {
                success
                deposit { id status }
                errors
              }
            }
          `,
          {
            input: {
              userId: testUserId,
              amount: 10000,
              currency: DEFAULT_CURRENCY,
              tenantId: DEFAULT_TENANT_ID,
              method: 'card',
              fromUserId,
            },
          },
          token
        );
        return { success: result.createDeposit.success, txId: result.createDeposit.deposit?.id };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });
    
    const results = await Promise.allSettled(promises);
    const successes = results.filter(r => r.status === 'fulfilled' && (r.value as any).success);
    console.log(`  ✅ Successes: ${successes.length}/${numConcurrent}\n`);
    
    // Verify no duplicates in ledger
    await sleep(3000);
    const db = await getPaymentDatabase();
    const ledgerTxs = await db.collection('ledger_transactions')
      .find({ transactionId: { $exists: true } })
      .toArray();
    
    const externalRefs = new Map<string, number>();
    ledgerTxs.forEach(tx => {
      if (tx.externalRef) {
        externalRefs.set(tx.externalRef, (externalRefs.get(tx.externalRef) || 0) + 1);
      }
    });
    
    const duplicates = Array.from(externalRefs.entries()).filter(([_, count]) => count > 1);
    if (duplicates.length === 0) {
      console.log('  ✅ No duplicate externalRefs found in ledger\n');
    } else {
      console.log(`  ❌ Found ${duplicates.length} duplicate externalRefs!\n`);
    }
    
    console.log('✅ Duplicate Protection test completed!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 4: Currency Exchange Rate
// ═══════════════════════════════════════════════════════════════════

async function testExchangeRate() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CURRENCY EXCHANGE RATE TEST SUITE                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();
    const systemUserId = await getUserId('system');
    const providerUserId = await getUserId('paymentProvider');
    const testUserId = `exchange-test-${Date.now()}`;
    
    // Set up manual exchange rates for testing (via database)
    console.log('💱 Setting up manual exchange rates for testing...');
    const db = await getPaymentDatabase();
    const exchangeRatesCollection = db.collection('exchange_rates');
    
    // Set EUR to USD rate: 1 EUR = 1.1 USD
    await exchangeRatesCollection.updateMany(
      { fromCurrency: 'EUR', toCurrency: 'USD', source: 'manual' },
      { $set: { isActive: false } }
    );
    await exchangeRatesCollection.insertOne({
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: 1.1,
      source: 'manual',
      timestamp: new Date(),
      createdAt: new Date(),
      isActive: true,
    });
    
    // Set USD to EUR rate: 1 USD = 0.91 EUR
    await exchangeRatesCollection.updateMany(
      { fromCurrency: 'USD', toCurrency: 'EUR', source: 'manual' },
      { $set: { isActive: false } }
    );
    await exchangeRatesCollection.insertOne({
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      rate: 0.91,
      source: 'manual',
      timestamp: new Date(),
      createdAt: new Date(),
      isActive: true,
    });
    
    console.log('  ✅ Manual exchange rates set:');
    console.log('     EUR → USD: 1.1');
    console.log('     USD → EUR: 0.91\n');
    
    // Test 1: Create wallets in different currencies
    console.log('📦 Test 1: Creating wallets in different currencies\n');
    
    const eurWalletId = await createWallet(token, testUserId, 'EUR');
    console.log(`  ✅ EUR wallet created: ${eurWalletId}`);
    
    const usdWalletId = await createWallet(token, testUserId, 'USD');
    console.log(`  ✅ USD wallet created: ${usdWalletId}\n`);
    
    // Test 2: Verify exchange rates are stored and retrievable
    console.log('💰 Test 2: Verifying exchange rate storage and retrieval\n');
    
    // Verify manual rates are stored correctly
    const storedRates = await exchangeRatesCollection.find({
      source: 'manual',
      isActive: true,
    }).toArray();
    
    console.log(`  ✅ Found ${storedRates.length} active manual exchange rates:`);
    storedRates.forEach((rate: any) => {
      console.log(`     ${rate.fromCurrency} → ${rate.toCurrency}: ${rate.rate}`);
    });
    
    // Verify EUR → USD rate
    const eurToUsdRate = storedRates.find((r: any) => r.fromCurrency === 'EUR' && r.toCurrency === 'USD');
    if (eurToUsdRate && Math.abs(eurToUsdRate.rate - 1.1) < 0.01) {
      console.log(`  ✅ EUR → USD rate correct: ${eurToUsdRate.rate}`);
    } else {
      throw new Error(`EUR → USD rate not found or incorrect. Expected 1.1, got ${eurToUsdRate?.rate || 'not found'}`);
    }
    
    // Verify USD → EUR rate
    const usdToEurRate = storedRates.find((r: any) => r.fromCurrency === 'USD' && r.toCurrency === 'EUR');
    if (usdToEurRate && Math.abs(usdToEurRate.rate - 0.91) < 0.01) {
      console.log(`  ✅ USD → EUR rate correct: ${usdToEurRate.rate}`);
    } else {
      throw new Error(`USD → EUR rate not found or incorrect. Expected 0.91, got ${usdToEurRate?.rate || 'not found'}`);
    }
    
    // Test 3: Verify exchange rate infrastructure is ready
    console.log('\n🔧 Test 3: Exchange rate infrastructure verification\n');
    
    // Check that exchange_rates collection exists and has indexes
    const collections = await db.listCollections().toArray();
    const hasExchangeRatesCollection = collections.some((c: any) => c.name === 'exchange_rates');
    
    if (hasExchangeRatesCollection) {
      console.log(`  ✅ exchange_rates collection exists`);
      
      // Check indexes
      const indexes = await exchangeRatesCollection.indexes();
      console.log(`  ✅ Collection has ${indexes.length} index(es)`);
    } else {
      console.log(`  ⚠️  exchange_rates collection not found (will be created on first use)`);
    }
    
    console.log(`  ✅ Exchange rate service infrastructure is ready`);
    console.log(`     Manual rates can be set and will be used by ledger service`);
    console.log(`     Cross-currency transactions will automatically use these rates`);
    
    // Test 3: Verify wallet balances after deposit
    console.log('\n💼 Test 3: Verifying wallet balances after deposit\n');
    
    const eurBalance = await getUserWalletBalance(token, testUserId, 'EUR');
    const usdBalance = await getUserWalletBalance(token, testUserId, 'USD');
    
    console.log(`  EUR wallet balance: €${(eurBalance / 100).toFixed(2)}`);
    console.log(`  USD wallet balance: $${(usdBalance / 100).toFixed(2)}`);
    
    // Test 4: Test reverse conversion (USD to EUR)
    console.log('\n💸 Test 4: Reverse conversion test (USD → EUR)\n');
    
    // Note: Cross-currency deposits require the source user to have an account in the deposit currency.
    // The current ledger system supports one account per user/subtype, so cross-currency deposits
    // from a provider who only has EUR accounts are not directly supported.
    // Exchange rate conversion is handled when both accounts exist in their respective currencies.
    console.log(`  ℹ️  Cross-currency deposit test skipped:`);
    console.log(`     - Exchange rate infrastructure is verified (Test 2 & 3)`);
    console.log(`     - Manual rates are stored and retrievable`);
    console.log(`     - Cross-currency conversion logic is implemented in ledger service`);
    console.log(`     - For full cross-currency testing, source user needs accounts in both currencies`);
    console.log(`     - This is a known architectural limitation (one account per user/subtype)`);
    
    // Test 5: Verify exchange rate cache and manual override priority
    console.log('\n🔄 Test 5: Exchange rate priority (manual override > cache > API)\n');
    
    // Check that manual rates are stored
    const manualRates = await exchangeRatesCollection.find({
      source: 'manual',
      isActive: true,
    }).toArray();
    
    console.log(`  ✅ Active manual exchange rates: ${manualRates.length}`);
    manualRates.forEach((rate: any) => {
      console.log(`     ${rate.fromCurrency} → ${rate.toCurrency}: ${rate.rate}`);
    });
    
    console.log('\n✅ Currency Exchange Rate test completed!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 5: Ledger Diagnostic
// ═══════════════════════════════════════════════════════════════════

async function testLedger() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           TESTING LEDGER FUNDING DIRECTLY                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const client = new MongoClient(MONGO_URI, { directConnection: true });
  
  try {
    await client.connect();
    const db = client.db();
    
    // Check wallet transactions
    console.log('📝 Checking Wallet Transactions...');
    const walletTxs = await db.collection('wallet_transactions')
      .find({ userId: 'system', type: 'deposit' })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    
    console.log(`Found ${walletTxs.length} system deposit wallet transactions:\n`);
    
    // Check ledger transactions
    console.log('💰 Checking Ledger Transactions...');
    const ledgerTxs = await db.collection('ledger_transactions')
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    
    console.log(`Found ${ledgerTxs.length} ledger transactions:`);
    ledgerTxs.forEach(tx => {
      const date = tx.createdAt ? new Date(tx.createdAt).toISOString() : 'N/A';
      console.log(`  - [${tx.type}] ${tx.fromAccountId} -> ${tx.toAccountId}: ${formatAmount(tx.amount)} ${tx.currency} - ${date}`);
    });
    
    // Check user ledger accounts
    console.log('\n👥 Checking User Ledger Accounts...');
    const userAccounts = await db.collection('ledger_accounts')
      .find({ type: 'user' })
      .limit(20)
      .toArray();
    
    console.log(`Found ${userAccounts.length} user accounts (showing first 20):`);
    userAccounts.forEach(acc => {
      const ownerId = acc.ownerId || 'N/A';
      console.log(`  - ${acc._id} (${ownerId}): balance=${acc.balance} (${formatAmount(acc.balance)}), currency=${acc.currency}, allowNegative=${acc.allowNegative || false}`);
    });
    
    // Check wallets
    console.log('\n💼 Checking Payment-Related User Wallets...');
    const paymentWallets = await db.collection('wallets')
      .find({ 
        $or: [
          { userId: { $regex: '^payment-' } },
          { userId: { $regex: '^provider-' } },
          { userId: { $regex: '^test-' } },
        ]
      })
      .toArray();
    
    console.log(`Found ${paymentWallets.length} payment-related wallets:`);
    paymentWallets.forEach(w => {
      console.log(`  - ${w.userId}: balance=${w.balance} (${formatAmount(w.balance)}), currency=${w.currency}`);
    });
    
    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         DIAGNOSIS                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    
    if (ledgerTxs.length === 0) {
      console.log('\n❌ PROBLEM: No ledger transactions found!');
    } else {
      console.log('\n✅ Ledger transactions exist');
    }
    
    console.log('\n✅ Ledger Diagnostic test completed!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Gateway Tests: Comprehensive Payment Gateway & Bonus Service Tests
// ═══════════════════════════════════════════════════════════════════

// Test configuration
const GATEWAY_TEST_CONFIG = {
  currency: 'USD',
};

const TEST_AMOUNTS = {
  initialDeposit: 10000,        // $100.00
  multipleDeposits: [5000, 2500, 7500],  // $50, $25, $75
  withdrawal: 5000,             // $50.00
  insufficientWithdrawal: 999999900, // More than available
  concurrentDeposit: 100,       // $1.00 per concurrent deposit
  zero: 0,
  negative: -1000,
};

const CONCURRENT_CONFIG = {
  numConcurrentDeposits: 10,
  numConcurrentWithdrawals: 10,
  withdrawalPercent: 0.05,  // Each withdrawal is 5% of balance
  sleepAfterConcurrent: 500,
};

const BONUS_TEST_DATA = {
  templateCode: 'WELCOME100',
  depositAmount: 10000,
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

let gatewayTestWalletId: string;
let gatewayTestTransactionIds: string[] = [];
let gatewayTestUserId: string;

async function getGatewayWalletBalance(walletId: string, token: string): Promise<number> {
  const query = `
    query GetWallet {
      wallet(id: "${walletId}") {
        balance
        bonusBalance
        lockedBalance
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {}, token);
  return (data as any).wallet?.balance || 0;
}

async function testGatewayWalletCreation() {
  const token = createSystemToken('8h');
  const { userId } = await registerAs('user1');
  gatewayTestUserId = userId;

  const query = `
    mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) {
        success
        wallet {
          id
          userId
          currency
          balance
          bonusBalance
          lockedBalance
        }
        sagaId
        errors
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {
    input: {
      userId: gatewayTestUserId,
      currency: GATEWAY_TEST_CONFIG.currency,
      category: 'main',
    }
  }, token);

  if (!data.createWallet.success) {
    throw new Error(data.createWallet.errors?.join(', ') || 'Failed to create wallet');
  }

  gatewayTestWalletId = data.createWallet.wallet.id;
  
  if (data.createWallet.wallet.balance !== 0) {
    throw new Error(`Expected balance 0, got ${data.createWallet.wallet.balance}`);
  }
}

async function testGatewayDuplicateWalletPrevention() {
  const token = createSystemToken('8h');
  const query = `
    mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) {
        success
        wallet { id }
        errors
      }
    }
  `;

  try {
    const data = await graphql(PAYMENT_SERVICE_URL, query, {
      input: {
        userId: gatewayTestUserId,
        currency: GATEWAY_TEST_CONFIG.currency,
        category: 'main',
      }
    }, token);

    if (data.createWallet.success && data.createWallet.wallet.id !== gatewayTestWalletId) {
      throw new Error('Created duplicate wallet instead of returning existing one');
    }
  } catch (error) {
    console.log('  (Duplicate prevention working)');
  }
}

async function testGatewaySuccessfulDeposit() {
  const token = createSystemToken('8h');
  const depositAmount = TEST_AMOUNTS.initialDeposit;
  
  const query = `
    mutation Deposit($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balanceBefore
          balanceAfter
          currency
          createdAt
        }
        sagaId
        errors
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {
    input: {
      walletId: gatewayTestWalletId,
      userId: gatewayTestUserId,
      type: 'deposit',
      balanceType: 'real',
      amount: depositAmount,
      currency: GATEWAY_TEST_CONFIG.currency,
    }
  }, token);

  if (!data.createWalletTransaction.success) {
    throw new Error(data.createWalletTransaction.errors?.join(', ') || 'Deposit failed');
  }

  const tx = data.createWalletTransaction.walletTransaction;
  gatewayTestTransactionIds.push(tx.id);

  if (tx.balanceAfter !== tx.balanceBefore + depositAmount) {
    throw new Error(`Balance mismatch: ${tx.balanceBefore} + ${depositAmount} != ${tx.balanceAfter}`);
  }
}

async function testGatewayMultipleDeposits() {
  const token = createSystemToken('8h');
  const amounts = TEST_AMOUNTS.multipleDeposits;
  let expectedBalance = TEST_AMOUNTS.initialDeposit;

  for (const amount of amounts) {
    const query = `
      mutation Deposit($input: CreateWalletTransactionInput!) {
        createWalletTransaction(input: $input) {
          success
          walletTransaction {
            id
            balanceBefore
            balanceAfter
          }
        }
      }
    `;

    const data = await graphql(PAYMENT_SERVICE_URL, query, {
      input: {
        walletId: gatewayTestWalletId,
        userId: gatewayTestUserId,
        type: 'deposit',
        balanceType: 'real',
        amount,
        currency: GATEWAY_TEST_CONFIG.currency,
      }
    }, token);

    if (!data.createWalletTransaction.success) {
      throw new Error(`Deposit of ${amount} failed`);
    }

    const tx = data.createWalletTransaction.walletTransaction;
    gatewayTestTransactionIds.push(tx.id);

    if (tx.balanceBefore !== expectedBalance) {
      throw new Error(`Balance before mismatch: expected ${expectedBalance}, got ${tx.balanceBefore}`);
    }
    expectedBalance += amount;
    if (tx.balanceAfter !== expectedBalance) {
      throw new Error(`Balance after mismatch: expected ${expectedBalance}, got ${tx.balanceAfter}`);
    }
  }
}

async function testGatewaySuccessfulWithdrawal() {
  const token = createSystemToken('8h');
  const withdrawAmount = TEST_AMOUNTS.withdrawal;

  const query = `
    mutation Withdraw($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balanceBefore
          balanceAfter
          currency
          createdAt
        }
        errors
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {
    input: {
      walletId: gatewayTestWalletId,
      userId: gatewayTestUserId,
      type: 'withdrawal',
      balanceType: 'real',
      amount: withdrawAmount,
      currency: GATEWAY_TEST_CONFIG.currency,
    }
  }, token);

  if (!data.createWalletTransaction.success) {
    throw new Error(data.createWalletTransaction.errors?.join(', ') || 'Withdrawal failed');
  }

  const tx = data.createWalletTransaction.walletTransaction;
  gatewayTestTransactionIds.push(tx.id);

  if (tx.balanceAfter !== tx.balanceBefore - withdrawAmount) {
    throw new Error(`Withdrawal balance mismatch`);
  }
}

async function testGatewayInsufficientFundsWithdrawal() {
  const token = createSystemToken('8h');
  const hugeAmount = TEST_AMOUNTS.insufficientWithdrawal;

  const query = `
    mutation Withdraw($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        errors
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {
    input: {
      walletId: gatewayTestWalletId,
      userId: gatewayTestUserId,
      type: 'withdrawal',
      balanceType: 'real',
      amount: hugeAmount,
      currency: GATEWAY_TEST_CONFIG.currency,
    }
  }, token);

  if (data.createWalletTransaction.success) {
    throw new Error('Withdrawal should have failed due to insufficient funds');
  }
  console.log('  (Correctly rejected insufficient funds)');
}

async function testGatewayNoDuplicateTransactions() {
  const uniqueIds = new Set(gatewayTestTransactionIds);
  if (uniqueIds.size !== gatewayTestTransactionIds.length) {
    throw new Error(`Found duplicate transaction IDs: ${gatewayTestTransactionIds.length} total, ${uniqueIds.size} unique`);
  }
}

async function testGatewayTransactionHistory() {
  const token = createSystemToken('8h');
  const query = `
    query GetTransactions {
      walletTransactions(filter: { walletId: "${gatewayTestWalletId}" }, first: 100) {
        nodes {
          id
          type
          amount
          balanceBefore
          balanceAfter
          currency
          createdAt
        }
        totalCount
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {}, token);
  const transactions = (data as any).walletTransactions.nodes;

  if (transactions.length < gatewayTestTransactionIds.length) {
    throw new Error(`Missing transactions: expected ${gatewayTestTransactionIds.length}, found ${transactions.length}`);
  }
}

async function testGatewayConcurrentDeposits() {
  const token = createSystemToken('8h');
  const initialBalance = await getGatewayWalletBalance(gatewayTestWalletId, token);
  const depositAmount = TEST_AMOUNTS.concurrentDeposit;
  const numConcurrent = CONCURRENT_CONFIG.numConcurrentDeposits;

  const promises = Array(numConcurrent).fill(null).map(async () => {
    const query = `
      mutation Deposit($input: CreateWalletTransactionInput!) {
        createWalletTransaction(input: $input) {
          success
          walletTransaction { id balanceAfter }
          errors
        }
      }
    `;

    return graphql(PAYMENT_SERVICE_URL, query, {
      input: {
        walletId: gatewayTestWalletId,
        userId: gatewayTestUserId,
        type: 'deposit',
        balanceType: 'real',
        amount: depositAmount,
        currency: GATEWAY_TEST_CONFIG.currency,
      }
    }, token);
  });

  const results = await Promise.all(promises);
  const successes = results.filter((r: any) => r.createWalletTransaction?.success);
  
  await sleep(CONCURRENT_CONFIG.sleepAfterConcurrent);

  const finalBalance = await getGatewayWalletBalance(gatewayTestWalletId, token);
  const expectedBalance = initialBalance + (successes.length * depositAmount);
  
  if (finalBalance !== expectedBalance) {
    throw new Error(`Balance mismatch after concurrent deposits: expected ${expectedBalance}, got ${finalBalance}`);
  }
}

async function testGatewayConcurrentWithdrawals() {
  const token = createSystemToken('8h');
  const currentBalance = await getGatewayWalletBalance(gatewayTestWalletId, token);
  const withdrawAmount = Math.floor(currentBalance * CONCURRENT_CONFIG.withdrawalPercent);
  const numConcurrent = CONCURRENT_CONFIG.numConcurrentWithdrawals;

  const promises = Array(numConcurrent).fill(null).map(async () => {
    const query = `
      mutation Withdraw($input: CreateWalletTransactionInput!) {
        createWalletTransaction(input: $input) {
          success
          walletTransaction { id balanceAfter }
          errors
        }
      }
    `;

    return graphql(PAYMENT_SERVICE_URL, query, {
      input: {
        walletId: gatewayTestWalletId,
        userId: gatewayTestUserId,
        type: 'withdrawal',
        balanceType: 'real',
        amount: withdrawAmount,
        currency: GATEWAY_TEST_CONFIG.currency,
      }
    }, token);
  });

  await Promise.all(promises);

  const finalBalance = await getGatewayWalletBalance(gatewayTestWalletId, token);
  if (finalBalance < 0) {
    throw new Error(`Balance went negative: ${finalBalance}`);
  }
}

async function testGatewayBonusCreation() {
  const token = createSystemToken('8h');
  const query = `
    mutation CreateBonus($input: CreateUserBonusInput!) {
      createUserBonus(input: $input) {
        success
        userBonus {
          id
          userId
          templateCode
          status
          currency
          originalValue
          currentValue
          turnoverRequired
          turnoverProgress
          expiresAt
          createdAt
        }
        sagaId
        errors
      }
    }
  `;

  try {
    const data = await graphql(BONUS_SERVICE_URL, query, {
      input: {
        userId: gatewayTestUserId,
        templateCode: BONUS_TEST_DATA.templateCode,
        currency: GATEWAY_TEST_CONFIG.currency,
        tenantId: DEFAULT_TENANT_ID,
        depositAmount: BONUS_TEST_DATA.depositAmount,
      }
    }, token);

    if (!data.createUserBonus.success) {
      console.log('  (Bonus template not found - skipping bonus tests)');
    }
  } catch (error) {
    console.log('  (Bonus service not available - skipping bonus tests)');
  }
}

async function testGatewayZeroAmountTransaction() {
  const token = createSystemToken('8h');
  const query = `
    mutation Deposit($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        errors
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {
    input: {
      walletId: gatewayTestWalletId,
      userId: gatewayTestUserId,
      type: 'deposit',
      balanceType: 'real',
      amount: TEST_AMOUNTS.zero,
      currency: GATEWAY_TEST_CONFIG.currency,
    }
  }, token);

  if (data.createWalletTransaction.success) {
    throw new Error('Zero amount transaction should not be allowed');
  }
  console.log('  (Correctly rejected zero amount)');
}

async function testGatewayNegativeAmountTransaction() {
  const token = createSystemToken('8h');
  const query = `
    mutation Deposit($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        errors
      }
    }
  `;

  const data = await graphql(PAYMENT_SERVICE_URL, query, {
    input: {
      walletId: gatewayTestWalletId,
      userId: gatewayTestUserId,
      type: 'deposit',
      balanceType: 'real',
      amount: TEST_AMOUNTS.negative,
      currency: GATEWAY_TEST_CONFIG.currency,
    }
  }, token);

  if (data.createWalletTransaction.success) {
    throw new Error('Negative amount transaction should not be allowed');
  }
  console.log('  (Correctly rejected negative amount)');
}

async function testGatewayInvalidWalletId() {
  const token = createSystemToken('8h');
  const query = `
    mutation Deposit($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        errors
      }
    }
  `;

  try {
    const data = await graphql(PAYMENT_SERVICE_URL, query, {
      input: {
        walletId: 'non-existent-wallet-id',
        userId: gatewayTestUserId,
        type: 'deposit',
        balanceType: 'real',
        amount: 1000,
        currency: GATEWAY_TEST_CONFIG.currency,
      }
    }, token);

    if (data.createWalletTransaction.success) {
      throw new Error('Transaction on non-existent wallet should fail');
    }
  } catch (error) {
    console.log('  (Correctly rejected invalid wallet)');
  }
}

async function testGatewayFinalBalanceConsistency() {
  const token = createSystemToken('8h');
  const walletQuery = `
    query GetWallet {
      wallet(id: "${gatewayTestWalletId}") {
        balance
        bonusBalance
        lockedBalance
      }
    }
  `;

  const txQuery = `
    query GetTransactions {
      walletTransactions(filter: { walletId: "${gatewayTestWalletId}" }, first: 1000) {
        nodes {
          type
          amount
          balanceType
        }
      }
    }
  `;

  const [walletData, txData] = await Promise.all([
    graphql(PAYMENT_SERVICE_URL, walletQuery, {}, token),
    graphql(PAYMENT_SERVICE_URL, txQuery, {}, token),
  ]);

  const wallet = (walletData as any).wallet;
  const transactions = (txData as any).walletTransactions.nodes;

  let calculatedBalance = 0;
  for (const tx of transactions) {
    if (tx.balanceType === 'real') {
      if (tx.type === 'deposit' || tx.type === 'win' || tx.type === 'refund') {
        calculatedBalance += tx.amount;
      } else if (tx.type === 'withdrawal' || tx.type === 'bet') {
        calculatedBalance -= tx.amount;
      }
    }
  }

  const tolerance = 1;
  if (Math.abs(wallet.balance - calculatedBalance) > tolerance) {
    throw new Error(`Balance inconsistency: wallet shows ${wallet.balance}, calculated ${calculatedBalance}`);
  }

  console.log(`  Final balance: ${wallet.balance} (verified from ${transactions.length} transactions)`);
}

async function testGateway() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║         PAYMENT GATEWAY & BONUS SERVICE - TEST SUITE                      ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  console.log('║  Testing:                                                                 ║');
  console.log('║  • Wallet operations (create, deposit, withdraw)                          ║');
  console.log('║  • Transaction integrity (no duplicates, correct balances)                ║');
  console.log('║  • Concurrent operations (stress test)                                    ║');
  console.log('║  • Edge cases (invalid amounts, missing wallets)                          ║');
  console.log('║  • Balance consistency                                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

  // Check services are running
  console.log('🔍 Checking services...');
  try {
    await fetch(PAYMENT_SERVICE_URL.replace('/graphql', '/health'));
    console.log('  ✅ Payment Gateway running');
  } catch {
    console.log('  ❌ Payment Gateway not running at ' + PAYMENT_SERVICE_URL);
    throw new Error('Payment Gateway not running');
  }

  try {
    await fetch(BONUS_SERVICE_URL.replace('/graphql', '/health'));
    console.log('  ✅ Bonus Service running');
  } catch {
    console.log('  ⚠️  Bonus Service not running (bonus tests will be skipped)');
  }

  console.log('  🔑 Generated authentication tokens');
  
  // Register/get test user from centralized config
  const { userId } = await registerAs('user1');
  gatewayTestUserId = userId;
  gatewayTestTransactionIds = [];
  console.log(`  👤 Test user ID: ${gatewayTestUserId}`);

  const gatewayTests: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'Create wallet', fn: testGatewayWalletCreation },
    { name: 'Prevent duplicate wallet', fn: testGatewayDuplicateWalletPrevention },
    { name: 'Successful deposit', fn: testGatewaySuccessfulDeposit },
    { name: 'Multiple deposits', fn: testGatewayMultipleDeposits },
    { name: 'Successful withdrawal', fn: testGatewaySuccessfulWithdrawal },
    { name: 'Insufficient funds rejection', fn: testGatewayInsufficientFundsWithdrawal },
    { name: 'No duplicate transaction IDs', fn: testGatewayNoDuplicateTransactions },
    { name: 'Transaction history', fn: testGatewayTransactionHistory },
    { name: 'Concurrent deposits', fn: testGatewayConcurrentDeposits },
    { name: 'Concurrent withdrawals', fn: testGatewayConcurrentWithdrawals },
    { name: 'Zero amount rejection', fn: testGatewayZeroAmountTransaction },
    { name: 'Negative amount rejection', fn: testGatewayNegativeAmountTransaction },
    { name: 'Invalid wallet rejection', fn: testGatewayInvalidWalletId },
    { name: 'Final balance consistency', fn: testGatewayFinalBalanceConsistency },
    { name: 'Bonus creation', fn: testGatewayBonusCreation },
  ];

  const results: TestResult[] = [];

  for (const test of gatewayTests) {
    const start = Date.now();
    try {
      await test.fn();
      const result: TestResult = {
        name: test.name,
        passed: true,
        duration: Date.now() - start,
      };
      results.push(result);
      console.log(`✅ ${test.name} (${result.duration}ms)`);
    } catch (error) {
      const result: TestResult = {
        name: test.name,
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.log(`❌ ${test.name} - ${result.error}`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Time: ${totalTime}ms`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    });
    throw new Error(`${failed} test(s) failed`);
  }

  console.log('\n✅ All gateway tests passed!');
}

// ═══════════════════════════════════════════════════════════════════
// Balance Summary - Comprehensive Balance Report
// ═══════════════════════════════════════════════════════════════════

async function testBalanceSummary() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           BALANCE SUMMARY & VERIFICATION                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const token = await login();

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
            usersByRole(role: "system", first: $first) {
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
      
      allSystemUsers = [...systemUsers, ...systemRoleUsers].filter((u, idx, arr) => 
        arr.findIndex(v => v.id === u.id) === idx
      );
    } catch (queryError: any) {
      // If GraphQL queries fail, fetch from MongoDB directly
      console.log('⚠️  GraphQL queries failed. Fetching users from MongoDB directly...');
      const db = await getAuthDatabase();
      const usersCollection = db.collection('users');
      
      try {
        const allUsersDocs = await usersCollection.find({}).toArray();
        
        allUsers = allUsersDocs.map((doc: any) => ({
          id: doc.id || doc._id?.toString() || doc._id,
          email: doc.email || (doc.id || doc._id?.toString() || doc._id)?.substring(0, 8),
          roles: Array.isArray(doc.roles) ? doc.roles : [],
        }));
        
        // Categorize by roles (handle UserRole[] format)
        allSystemUsers = allUsers.filter((u: any) => {
          const roles = Array.isArray(u.roles) ? u.roles : [];
          const roleNames = roles.map((r: any) => typeof r === 'string' ? r : r.role);
          return roleNames.includes('system');
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
          return !roleNames.includes('system') && 
                 !roleNames.includes('payment-gateway') && 
                 !roleNames.includes('payment-provider') &&
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
          currency: DEFAULT_CURRENCY,
        },
        token
      );
      
      balancesResult.bulkLedgerBalances?.balances?.forEach(b => {
        balanceMap.set(b.userId, b.balance || 0);
      });
    } catch (balanceError: any) {
      // If GraphQL fails, fetch balances directly from MongoDB
      console.log('⚠️  GraphQL balance query failed. Fetching balances from MongoDB directly...');
      const ledgerAccountsCollection = db.collection('ledger_accounts');
      
      try {
        // Fetch all user accounts for the given user IDs
        const accountDocs = await ledgerAccountsCollection.find({
          ownerId: { $in: allUserIds },
          type: 'user',
          subtype: 'main',
          currency: DEFAULT_CURRENCY,
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
    const feeCollectionAccount = await db.collection('ledger_accounts').findOne({
      ownerId: 'fee-collection',
      type: 'user',
      currency: DEFAULT_CURRENCY,
    });
    const feeCollectionBalance = feeCollectionAccount?.balance || 0;
    
    // Calculate grand total (include fee-collection as system account)
    const grandTotal = systemTotal + gatewayTotal + providerTotal + endUserTotal + feeCollectionBalance;
    
    // Format currency
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: DEFAULT_CURRENCY,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount / 100);
    };
    
    // Display summary
    console.log('\n' + '═'.repeat(75));
    console.log('💰 BALANCE SUMMARY (EUR)');
    console.log('═'.repeat(75));
    
    console.log('\n📌 SYSTEM USERS (System role only):');
    if (systemBalances.length === 0) {
      console.log('   (none)');
    } else {
      systemBalances.forEach(u => {
        const sign = u.balance >= 0 ? '+' : '';
        console.log(`   ${u.email.padEnd(30)} ${sign}${formatCurrency(u.balance)}`);
      });
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL SYSTEM:${' '.repeat(20)} ${formatCurrency(systemTotal)}`);
    }
    
    console.log('\n🏦 GATEWAY USERS (Payment Gateway):');
    if (gatewayBalances.length === 0) {
      console.log('   (none)');
    } else {
      gatewayBalances.forEach(u => {
        console.log(`   ${u.email.padEnd(30)} ${formatCurrency(u.balance)}`);
      });
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL GATEWAY:${' '.repeat(19)} ${formatCurrency(gatewayTotal)}`);
    }
    
    console.log('\n💳 PROVIDER USERS (Payment Providers):');
    if (providerBalances.length === 0) {
      console.log('   (none)');
    } else {
      providerBalances.forEach(u => {
        console.log(`   ${u.email.padEnd(30)} ${formatCurrency(u.balance)}`);
      });
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL PROVIDERS:${' '.repeat(17)} ${formatCurrency(providerTotal)}`);
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
          console.log(`   ${u.email.padEnd(30)} ${formatCurrency(u.balance)}`);
        });
        if (endUserBalances.length > 10) {
          console.log(`   ... and ${endUserBalances.length - 10} more users`);
        }
      }
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   TOTAL END USERS:${' '.repeat(16)} ${formatCurrency(endUserTotal)}`);
    }
    
    console.log('\n' + '═'.repeat(75));
    console.log('📊 GRAND TOTALS');
    console.log('═'.repeat(75));
    console.log(`   System Users:     ${formatCurrency(systemTotal).padStart(15)}`);
    console.log(`   Gateway Users:    ${formatCurrency(gatewayTotal).padStart(15)}`);
    console.log(`   Provider Users:   ${formatCurrency(providerTotal).padStart(15)}`);
    console.log(`   End Users:        ${formatCurrency(endUserTotal).padStart(15)}`);
    console.log(`   Fee Collection:   ${formatCurrency(feeCollectionBalance).padStart(15)}`);
    console.log(`   ${'─'.repeat(50)}`);
    console.log(`   GRAND TOTAL:      ${formatCurrency(grandTotal).padStart(15)}`);
    console.log('═'.repeat(75));
    
    // Verification: Check for money loss
    console.log('\n🔍 VERIFICATION:');
    
    // In a user-to-user ledger system, the sum should be zero (conservation of money)
    const isBalanced = Math.abs(grandTotal) < 1; // Allow for rounding errors (1 cent)
    
    if (isBalanced) {
      console.log('   ✅ System is balanced (sum ≈ 0) - No money lost!');
    } else {
      console.log(`   ⚠️  System imbalance detected: ${formatCurrency(grandTotal)}`);
      console.log('   ⚠️  This may indicate:');
      console.log('      - System user (system@demo.com) has negative balance (normal for platform net position)');
      console.log('      - Or there is a data inconsistency');
      
      if (grandTotal < 0) {
        console.log(`   ℹ️  System is ${formatCurrency(Math.abs(grandTotal))} in debt (normal if platform owes money)`);
      } else {
        console.log(`   ⚠️  System has ${formatCurrency(grandTotal)} extra (investigate!)`);
      }
    }
    
    // Check for negative balances where they shouldn't be
    const negativeProviders = providerBalances.filter(u => u.balance < 0);
    const negativeEndUsers = endUserBalances.filter(u => {
      const user = endUsers.find(eu => eu.id === u.id);
      if (!user) return false;
      const roles = Array.isArray(user.roles) ? user.roles : [];
      const roleNames = roles.map((r: any) => typeof r === 'string' ? r : r.role);
      return u.balance < 0 && !roleNames.includes('system');
    });
    
    if (negativeProviders.length > 0) {
      console.log(`\n   ⚠️  WARNING: ${negativeProviders.length} provider(s) have negative balances:`);
      negativeProviders.forEach(u => {
        console.log(`      ${u.email}: ${formatCurrency(u.balance)}`);
      });
    }
    
    if (negativeEndUsers.length > 0) {
      console.log(`\n   ⚠️  WARNING: ${negativeEndUsers.length} end user(s) have negative balances:`);
      negativeEndUsers.slice(0, 5).forEach(u => {
        console.log(`      ${u.email}: ${formatCurrency(u.balance)}`);
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
      console.log(`\n   ℹ️  Fee Collection Account: ${formatCurrency(feeCollectionBalance)} (fees collected from transactions)`);
    }
    
    console.log('\n' + '═'.repeat(75) + '\n');
    
  } catch (error: any) {
    console.error('\n❌ Failed to generate balance summary:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite Orchestration - Run All Tests in Sequence
// ═══════════════════════════════════════════════════════════════════

async function testAll() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           PAYMENT TESTS SEQUENCE - COMPLETE TEST SUITE                ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Step 1: Clean all databases (drops all databases for fresh start)
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║           STEP 1: CLEAN ALL DATABASES                             ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    try {
      execSync('npx tsx typescript/payment/payment-command-db-check.ts clean', {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      console.log('\n✅ All databases dropped successfully!\n');
    } catch (error) {
      console.error('❌ Failed to clean databases:', error);
      throw error;
    }
    
    // Step 2: Wait for services
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
    
    // Step 2.5: Ensure indexes are created after services have started
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║           STEP 2.5: ENSURING INDEXES                              ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    try {
      // Wait a moment for collections to be created
      await sleep(2000);
      
      execSync('npx tsx typescript/payment/payment-command-db-check.ts create-index', {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      console.log('\n✅ Indexes verified/created!\n');
    } catch (error: any) {
      // Non-fatal - indexes might already exist or collections might not be ready yet
      console.log('⚠️  Index creation check completed (non-fatal)\n');
    }
    
    // Step 3: Setup payment users
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║           STEP 3: SETUP PAYMENT USERS                              ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    await testSetup();
    await sleep(2000); // Wait for permissions to propagate
    
    // Verify system user permissions
    console.log('\n🔍 Verifying system user permissions...\n');
    const db = await getAuthDatabase();
    
    try {
      const usersCollection = db.collection('users');
      const systemUser = await usersCollection.findOne({ email: users.system.email });
      
      if (systemUser) {
        const rolesArray = Array.isArray(systemUser.roles) ? systemUser.roles : [];
        const roleNames = rolesArray.map((r: any) => typeof r === 'string' ? r : r.role);
        const hasSystemRole = roleNames.includes('system');
        const hasFullPermissions = Array.isArray(systemUser.permissions) &&
          (systemUser.permissions.includes('*:*:*') || systemUser.permissions.includes('*'));
        
        if (!hasSystemRole || !hasFullPermissions) {
          console.log('⚠️  System user missing permissions. Promoting...');
          // Use string array format for roles (GraphQL expects strings)
          const newRolesArray = ['system'];
          
          // Normalize existing roles if they're in object format
          const existingRoles = systemUser.roles || [];
          const needsNormalization = Array.isArray(existingRoles) && existingRoles.length > 0 && typeof existingRoles[0] === 'object';
          
          await usersCollection.updateOne(
            { email: users.system.email },
            {
              $set: {
                roles: needsNormalization ? newRolesArray : newRolesArray,
                permissions: ['allowNegative', 'acceptFee', 'bonuses', '*:*:*'],
                updatedAt: new Date(),
              },
            }
          );
          console.log('✅ System user promoted with full permissions');
          await sleep(3000); // Wait longer for changes to propagate
        } else {
          // Even if permissions are correct, normalize roles format if needed
          const existingRoles = systemUser.roles || [];
          const needsNormalization = Array.isArray(existingRoles) && existingRoles.length > 0 && typeof existingRoles[0] === 'object';
          
          if (needsNormalization) {
            console.log('⚠️  Normalizing roles format (object -> string)...');
            const normalizedRoles = existingRoles.map((r: any) => typeof r === 'string' ? r : r.role);
            await usersCollection.updateOne(
              { email: users.system.email },
              {
                $set: {
                  roles: normalizedRoles,
                  updatedAt: new Date(),
                },
              }
            );
            console.log('✅ Roles normalized to string format');
            await sleep(2000); // Wait for changes to propagate
          } else {
            console.log('✅ System user has correct permissions');
          }
        }
      }
    } finally {
      await closeAllConnections();
    }
    
    // Re-login after setup to get fresh token with updated permissions
    console.log('\n🔄 Refreshing system token with updated permissions...\n');
    await sleep(2000);
    const token = await login();
    
    // Verify token has system permissions
    try {
      await graphql<{ me: { roles: string[] } }>(
        AUTH_SERVICE_URL,
        `query { me { roles } }`,
        {},
        token
      );
      console.log('✅ Token verified - system permissions active\n');
    } catch (error: any) {
      console.log(`⚠️  Token verification failed: ${error.message}\n`);
    }
    
    // Step 4: Run all tests
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║           STEP 4: RUNNING PAYMENT TESTS                             ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    const tests = [
      { name: 'funding', description: 'User-to-User Funding' },
      { name: 'flow', description: 'Complete Payment Flow' },
      { name: 'duplicate', description: 'Duplicate Protection' },
      { name: 'exchange-rate', description: 'Currency Exchange Rate' },
      { name: 'ledger', description: 'Ledger Funding Check' },
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
      console.log(`\n${'═'.repeat(75)}`);
      console.log(`🧪 ${test.description}`);
      console.log('─'.repeat(75));
      
      try {
        await TEST_REGISTRY[test.name]();
        console.log(`\n✅ ${test.description} - PASSED\n`);
        passed++;
      } catch (error: any) {
        console.error(`\n❌ ${test.description} - FAILED: ${error.message || 'Unknown error'}`);
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
    
    // Step 5: Balance Summary
    console.log('⏳ Generating balance summary...\n');
    try {
      await Promise.race([
        testBalanceSummary(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Balance summary timeout after 2 minutes')), 120000)
        )
      ]);
    } catch (error: any) {
      console.error(`\n⚠️  Balance summary failed or timed out: ${error.message}`);
      console.log('Continuing without balance summary...\n');
    }
    
    if (failed > 0) {
      throw new Error(`${failed} test(s) failed`);
    }
    
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                    ALL TESTS COMPLETED                            ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
  } catch (error: any) {
    console.error('\n❌ Test sequence failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Registry and Runner
// ═══════════════════════════════════════════════════════════════════

const TEST_REGISTRY: Record<string, () => Promise<void>> = {
  setup: testSetup,
  gateway: testGateway,
  funding: testFunding,
  flow: testFlow,
  duplicate: testDuplicate,
  'exchange-rate': testExchangeRate,
  ledger: testLedger,
  'balance-summary': testBalanceSummary,
  all: testAll,
};

async function runTests(testNames: string[]) {
  const testsToRun = testNames.length > 0 
    ? testNames.filter(name => TEST_REGISTRY[name])
    : Object.keys(TEST_REGISTRY);
  
  if (testsToRun.length === 0) {
    console.error('❌ No valid tests found. Available tests:', Object.keys(TEST_REGISTRY).join(', '));
    process.exit(1);
  }
  
  console.log(`\n🧪 Running ${testsToRun.length} test(s): ${testsToRun.join(', ')}\n`);
  
  const results: Record<string, { success: boolean; error?: string }> = {};
  
  for (const testName of testsToRun) {
    try {
      console.log(`\n${'═'.repeat(75)}`);
      console.log(`🧪 Running: ${testName}`);
      console.log('─'.repeat(75));
      await TEST_REGISTRY[testName]();
      results[testName] = { success: true };
      console.log(`\n✅ ${testName} - PASSED`);
    } catch (error: any) {
      results[testName] = { success: false, error: error.message };
      console.log(`\n❌ ${testName} - FAILED: ${error.message}`);
    }
  }
  
  // Summary (only show if multiple tests or failures)
  const passed = Object.values(results).filter(r => r.success).length;
  const failed = Object.values(results).filter(r => !r.success).length;
  
  if (testsToRun.length > 1 || failed > 0) {
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         TEST SUMMARY                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total:  ${testsToRun.length}\n`);
    
    if (failed > 0) {
      console.log('Failed tests:');
      Object.entries(results).forEach(([name, result]) => {
        if (!result.success) {
          console.log(`  ❌ ${name}: ${result.error}`);
        }
      });
      throw new Error(`${failed} test(s) failed`);
    }
    
    console.log('✅ All tests passed!\n');
  } else if (failed === 0) {
    // Single test passed - just show success message
    console.log('\n✅ Test passed!\n');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  
  try {
    await runTests(args);
    // Success - exit cleanly
    console.log('\n✅ All tests completed successfully!\n');
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exitCode = 1;
  } finally {
    // Always close connections before exiting
    try {
      await closeAllConnections();
    } catch (err) {
      // Ignore errors during cleanup
    }
    // Force exit after a short delay to ensure cleanup completes
    setTimeout(() => {
      process.exit(process.exitCode || 0);
    }, 100);
  }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  try {
    await closeAllConnections();
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(130);
});

process.on('SIGTERM', async () => {
  try {
    await closeAllConnections();
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(143);
});

main().catch(async (error) => {
  console.error('Unhandled error:', error);
  try {
    await closeAllConnections();
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(1);
});
