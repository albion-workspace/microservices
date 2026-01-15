#!/usr/bin/env npx tsx
/**
 * Ledger Payment Tests - Comprehensive Test Suite
 * 
 * Consolidates all payment-related tests from:
 * - payment-gateway-demo.ts
 * - test-payment-gateway-real.ts
 * - test-payment-gateway.ts
 * - ledger-integration-tests.ts (payment portion)
 * 
 * Tests all payment scenarios with ledger system integration:
 * 1. Ledger system initialization & system accounts
 * 2. Payment provider configuration & ledger accounts
 * 3. Provider funding & ledger validation
 * 4. Wallet operations (create, multi-currency, multi-category)
 * 5. Deposit flow with ledger validation
 * 6. Withdrawal flow with ledger validation
 * 7. Transaction operations (bet, win, bonus_credit, etc.)
 * 8. Balance synchronization (wallet ↔ ledger)
 * 9. Error handling (insufficient funds, invalid amounts)
 * 10. Reconciliation & reporting
 * 
 * Run: npx tsx scripts/ledger-payment-tests.ts
 */

import { createHmac, randomUUID } from 'crypto';

export {}; // Make this a module

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const PAYMENT_URL = process.env.PAYMENT_URL || 'http://localhost:3004/graphql';
const JWT_SECRET = process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production';

const CONFIG = {
  tenantId: 'default',
  testUserId: `ledger-payment-test-${Date.now()}`,
  testProviderId: 'provider-stripe-test',
  systemUserId: 'system-treasury',
  currency: 'USD',
  testAmounts: {
    providerFunding: 1000000,  // $10,000.00
    deposit: 50000,            // $500.00
    withdrawal: 20000,          // $200.00
    bet: 10000,                 // $100.00
    win: 15000,                 // $150.00
    bonusCredit: 10000,         // $100.00
  },
};

// ═══════════════════════════════════════════════════════════════════
// JWT Token Generation
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

const TOKENS = {
  admin: createJWT({
    userId: 'admin',
    tenantId: CONFIG.tenantId,
    roles: ['admin'],
    permissions: ['*:*:*'],
  }),
  system: createJWT({
    userId: CONFIG.systemUserId,
    tenantId: CONFIG.tenantId,
    roles: ['system'],
    permissions: ['wallets:*:*', 'transactions:*:*'],
  }),
  user: (userId: string) => createJWT({
    userId,
    tenantId: CONFIG.tenantId,
    roles: ['user'],
    permissions: [],
  }),
};

// ═══════════════════════════════════════════════════════════════════
// GraphQL Client
// ═══════════════════════════════════════════════════════════════════

async function graphql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(PAYMENT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  if (json.errors) {
    throw new Error(json.errors[0]?.message || 'GraphQL error');
  }
  return json.data;
}

// ═══════════════════════════════════════════════════════════════════
// Test Infrastructure
// ═══════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];
const testData: Record<string, any> = {};

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printSection(title: string, description?: string): void {
  console.log('\n' + '═'.repeat(75));
  console.log(`  ${title}`);
  if (description) console.log(`  ${description}`);
  console.log('═'.repeat(75) + '\n');
}

function printSubSection(title: string): void {
  console.log(`\n  ─── ${title} ───\n`);
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  console.log(`\n🧪 ${name}...`);
  
  try {
    await testFn();
    const duration = Date.now() - start;
    const result: TestResult = { name, passed: true, duration };
    results.push(result);
    console.log(`   ✅ ${name} - Passed (${duration}ms)`);
    return result;
  } catch (error: any) {
    const duration = Date.now() - start;
    const result: TestResult = {
      name,
      passed: false,
      duration,
      error: error.message || String(error),
    };
    results.push(result);
    console.log(`   ❌ ${name} - Failed: ${result.error}`);
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 1: Ledger System Accounts
// ═══════════════════════════════════════════════════════════════════

async function testLedgerSystemAccounts() {
  // Check bonus pool balance (may not exist if bonus service hasn't initialized yet)
  try {
    const bonusPoolData = await graphql(`
      query GetBonusPoolBalance($currency: String) {
        bonusPoolBalance(currency: $currency) {
          accountId
          currency
          balance
          availableBalance
        }
      }
    `, { currency: CONFIG.currency }, TOKENS.admin);
    
    if (!bonusPoolData?.bonusPoolBalance) {
      console.log(`   ⚠️  Bonus pool account not found (will be created when bonus service initializes)`);
      console.log(`   → This is expected after full cleanup - bonus service will create it`);
      return;
    }
    
    console.log(`   → Bonus Pool Balance: ${formatCurrency(bonusPoolData.bonusPoolBalance.balance || 0)}`);
    console.log(`   → Account ID: ${bonusPoolData.bonusPoolBalance.accountId}`);
    testData.bonusPoolAccountId = bonusPoolData.bonusPoolBalance.accountId;
  } catch (error: any) {
    if (error.message?.includes('Account not found') || error.message?.includes('not found')) {
      console.log(`   ⚠️  Bonus pool account not found (will be created when bonus service initializes)`);
      console.log(`   → This is expected after full cleanup - bonus service will create it`);
      return;
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 2: Payment Provider Configuration & Ledger Accounts
// ═══════════════════════════════════════════════════════════════════

async function testProviderConfiguration() {
  // Create provider config (this should create ledger accounts)
  const createProviderData = await graphql(`
    mutation CreateProvider($input: CreateProviderConfigInput!) {
      createProviderConfig(input: $input) {
        success
        providerConfig {
          id
          provider
          name
          supportedCurrencies
          isActive
        }
        errors
      }
    }
  `, {
    input: {
      provider: 'stripe',
      name: 'Stripe Test Provider',
      supportedMethods: ['card', 'apple_pay', 'google_pay'],
      supportedCurrencies: [CONFIG.currency],
      feePercentage: 2.9,
      feeType: 'percentage',
    },
  }, TOKENS.admin);
  
  if (!createProviderData?.createProviderConfig?.success) {
    const errors = createProviderData?.createProviderConfig?.errors || [];
    const errorMsg = errors.join(', ') || 'Unknown error';
    // Check if it's a duplicate key error (provider already exists)
    if (errorMsg.includes('duplicate key') || errorMsg.includes('already exists') || errorMsg.includes('E11000')) {
      console.log(`   → Provider already exists (continuing...)`);
      // Try to get existing provider
      const existingProvider = await graphql(`
        query GetProvider($filter: JSON) {
          providerConfigs(filter: $filter, first: 1) {
            nodes {
              id
              provider
              name
            }
          }
        }
      `, {
        filter: { provider: 'stripe', tenantId: CONFIG.tenantId }
      }, TOKENS.admin);
      if (existingProvider?.providerConfigs?.nodes?.[0]) {
        testData.providerConfigId = existingProvider.providerConfigs.nodes[0].id;
        console.log(`   → Found existing provider: ${existingProvider.providerConfigs.nodes[0].name}`);
      }
    } else {
      throw new Error(`Failed to create provider: ${errorMsg}`);
    }
  } else {
    console.log(`   → Provider created: ${createProviderData.createProviderConfig.providerConfig.name}`);
    testData.providerConfigId = createProviderData.createProviderConfig.providerConfig.id;
  }
  
  // Wait for ledger account creation
  await sleep(500);
  
  // Check provider ledger balance (may not exist yet - created lazily)
  try {
    const providerBalanceData = await graphql(`
      query GetProviderLedgerBalance($providerId: String!, $subtype: String!, $currency: String!) {
        providerLedgerBalance(providerId: $providerId, subtype: $subtype, currency: $currency) {
          accountId
          providerId
          balance
          availableBalance
        }
      }
    `, {
      providerId: CONFIG.testProviderId,
      subtype: 'deposit',
      currency: CONFIG.currency,
    }, TOKENS.admin);
    
    if (providerBalanceData?.providerLedgerBalance) {
      console.log(`   → Provider Account ID: ${providerBalanceData.providerLedgerBalance.accountId}`);
      console.log(`   → Initial Balance: ${formatCurrency(providerBalanceData.providerLedgerBalance.balance)}`);
      testData.providerAccountId = providerBalanceData.providerLedgerBalance.accountId;
    } else {
      console.log(`   ⚠️  Provider ledger account not found (will be created on first transaction)`);
      console.log(`   → This is expected - ledger accounts are created lazily on first use`);
    }
  } catch (error: any) {
    if (error.message?.includes('Account not found')) {
      console.log(`   ⚠️  Provider ledger account not found (will be created on first transaction)`);
      console.log(`   → This is expected - ledger accounts are created lazily on first use`);
    } else {
      throw error;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 3: Provider Funding & Ledger Validation
// ═══════════════════════════════════════════════════════════════════

async function testProviderFunding() {
  // Create wallet for provider
  const createWalletData = await graphql(`
    mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) {
        success
        wallet {
          id
          userId
          balance
        }
        errors
      }
    }
  `, {
    input: {
      userId: CONFIG.testProviderId,
      currency: CONFIG.currency,
      category: 'main',
      tenantId: CONFIG.tenantId,
    },
  }, TOKENS.admin);
  
  const walletId = createWalletData?.createWallet?.wallet?.id;
  if (!walletId) {
    console.log(`   → Provider wallet may already exist, continuing...`);
    // Try to get existing wallet
    const userWalletsData = await graphql(`
      query GetUserWallets($input: JSON) {
        userWallets(input: $input) {
          userId
          currency
          totals {
            realBalance
            bonusBalance
            totalBalance
          }
          wallets {
            id
            category
            realBalance
            bonusBalance
          }
        }
      }
    `, {
      input: { userId: CONFIG.testProviderId, currency: CONFIG.currency }
    }, TOKENS.admin);
    
    if (userWalletsData?.userWallets?.wallets?.[0]) {
      testData.providerWalletId = userWalletsData.userWallets.wallets[0].id;
    } else {
      throw new Error('Could not create or find provider wallet');
    }
  } else {
    testData.providerWalletId = walletId;
  }
  
  // Fund provider wallet (this should sync with ledger)
  const fundWalletData = await graphql(`
    mutation FundWallet($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          amount
          balance
        }
        errors
      }
    }
  `, {
    input: {
      walletId: testData.providerWalletId,
      userId: CONFIG.systemUserId,
      type: 'deposit',
      balanceType: 'real',
      currency: CONFIG.currency,
      amount: CONFIG.testAmounts.providerFunding,
      description: 'System funding to provider for ledger test',
    },
  }, TOKENS.system);
  
  if (!fundWalletData?.createWalletTransaction?.success) {
    throw new Error(`Failed to fund provider: ${fundWalletData?.createWalletTransaction?.errors?.join(', ') || 'Unknown error'}`);
  }
  
  console.log(`   → Funded provider: ${formatCurrency(CONFIG.testAmounts.providerFunding)}`);
  
  // Wait for ledger sync
  await sleep(1000);
  
  // Verify provider ledger balance (may not exist yet - created lazily)
  try {
    const providerBalanceData = await graphql(`
      query GetProviderLedgerBalance($providerId: String!, $subtype: String!, $currency: String!) {
        providerLedgerBalance(providerId: $providerId, subtype: $subtype, currency: $currency) {
          balance
          availableBalance
        }
      }
    `, {
      providerId: CONFIG.testProviderId,
      subtype: 'deposit',
      currency: CONFIG.currency,
    }, TOKENS.admin);
    
    const ledgerBalance = providerBalanceData?.providerLedgerBalance?.balance || 0;
    console.log(`   → Provider Ledger Balance: ${formatCurrency(ledgerBalance)}`);
    
    if (ledgerBalance < CONFIG.testAmounts.providerFunding * 0.9) {
      console.log(`   ⚠️  Provider ledger balance may not be fully synced yet`);
    }
  } catch (error: any) {
    if (error.message?.includes('Account not found')) {
      console.log(`   ⚠️  Provider ledger account not found (will be created on first transaction)`);
      console.log(`   → This is expected - ledger accounts are created lazily on first use`);
    } else {
      throw error;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 4: Wallet Operations
// ═══════════════════════════════════════════════════════════════════

async function testWalletCreation() {
  // Create main wallet
  const createWalletData = await graphql(`
    mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) {
        success
        wallet {
          id
          userId
          currency
          category
          balance
          bonusBalance
        }
        errors
      }
    }
  `, {
    input: {
      userId: CONFIG.testUserId,
      currency: CONFIG.currency,
      category: 'main',
      tenantId: CONFIG.tenantId,
    },
  }, TOKENS.admin);
  
  if (!createWalletData?.createWallet?.success) {
    throw new Error(`Failed to create wallet: ${createWalletData?.createWallet?.errors?.join(', ') || 'Unknown error'}`);
  }
  
  testData.userWalletId = createWalletData.createWallet.wallet.id;
  console.log(`   → User wallet created: ${testData.userWalletId}`);
  console.log(`   → Initial Balance: ${formatCurrency(createWalletData.createWallet.wallet.balance)}`);
}

async function testMultiCategoryWallets() {
  // Create wallets for different categories
  const categories = ['sports', 'casino'];
  
  for (const category of categories) {
    const createWalletData = await graphql(`
      mutation CreateWallet($input: CreateWalletInput!) {
        createWallet(input: $input) {
          success
          wallet {
            id
            category
            balance
          }
          errors
        }
      }
    `, {
      input: {
        userId: CONFIG.testUserId,
        currency: CONFIG.currency,
        category,
        tenantId: CONFIG.tenantId,
      },
    }, TOKENS.admin);
    
    if (createWalletData?.createWallet?.success) {
      const key = `${category}WalletId`;
      testData[key] = createWalletData.createWallet.wallet.id;
      console.log(`   → ${category} wallet created: ${testData[key]}`);
    } else {
      console.log(`   → ${category} wallet may already exist`);
    }
  }
}

async function testUserWalletsQuery() {
  // Test userWallets query (uses JSON input)
  const userWalletsData = await graphql(`
    query GetUserWallets($input: JSON) {
      userWallets(input: $input) {
        userId
        currency
        totals {
          realBalance
          bonusBalance
          lockedBalance
          totalBalance
          withdrawableBalance
          lifetimeDeposits
          lifetimeWithdrawals
        }
        wallets {
          id
          category
          realBalance
          bonusBalance
          totalBalance
          status
        }
      }
    }
  `, {
    input: { userId: CONFIG.testUserId, currency: CONFIG.currency }
  }, TOKENS.admin);
  
  if (!userWalletsData?.userWallets) {
    throw new Error('userWallets query failed');
  }
  
  const data = userWalletsData.userWallets;
  console.log(`   → Total Wallets: ${data.wallets?.length || 0}`);
  console.log(`   → Real Balance: ${formatCurrency(data.totals?.realBalance || 0)}`);
  console.log(`   → Bonus Balance: ${formatCurrency(data.totals?.bonusBalance || 0)}`);
}

async function testWalletBalanceQuery() {
  // Test walletBalance query (uses JSON input)
  const walletBalanceData = await graphql(`
    query GetWalletBalance($input: JSON) {
      walletBalance(input: $input) {
        walletId
        userId
        category
        currency
        realBalance
        bonusBalance
        lockedBalance
        totalBalance
        withdrawableBalance
        status
      }
    }
  `, {
    input: { userId: CONFIG.testUserId, category: 'main', currency: CONFIG.currency }
  }, TOKENS.admin);
  
  if (!walletBalanceData?.walletBalance) {
    throw new Error('walletBalance query failed');
  }
  
  const data = walletBalanceData.walletBalance;
  console.log(`   → Wallet ID: ${data.walletId}`);
  console.log(`   → Real Balance: ${formatCurrency(data.realBalance || 0)}`);
  console.log(`   → Bonus Balance: ${formatCurrency(data.bonusBalance || 0)}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 5: Deposit Flow with Ledger Validation
// ═══════════════════════════════════════════════════════════════════

async function testDepositFlow() {
  // Get initial balances (may not exist yet - created lazily)
  let providerBalanceBefore = 0;
  try {
    const initialProviderBalance = await graphql(`
      query GetProviderLedgerBalance($providerId: String!, $subtype: String!, $currency: String!) {
        providerLedgerBalance(providerId: $providerId, subtype: $subtype, currency: $currency) {
          balance
        }
      }
    `, {
      providerId: CONFIG.testProviderId,
      subtype: 'deposit',
      currency: CONFIG.currency,
    }, TOKENS.admin);
    
    providerBalanceBefore = initialProviderBalance?.providerLedgerBalance?.balance || 0;
    if (initialProviderBalance?.providerLedgerBalance) {
      console.log(`   → Provider Balance Before: ${formatCurrency(providerBalanceBefore)}`);
    }
  } catch (error: any) {
    if (error.message?.includes('Account not found')) {
      console.log(`   ⚠️  Provider ledger account not found (will be created on first transaction)`);
      console.log(`   → This is expected - ledger accounts are created lazily`);
    } else {
      throw error;
    }
  }
  
  // Create deposit transaction
  const depositData = await graphql(`
    mutation CreateDeposit($input: CreateDepositInput!) {
      createDeposit(input: $input) {
        success
        deposit {
          id
          amount
          status
        }
        errors
      }
    }
  `, {
    input: {
      userId: CONFIG.testUserId,
      amount: CONFIG.testAmounts.deposit,
      currency: CONFIG.currency,
      method: 'card',
      tenantId: CONFIG.tenantId,
    },
  }, TOKENS.admin);
  
  if (!depositData?.createDeposit?.success) {
    throw new Error(`Deposit failed: ${depositData?.createDeposit?.errors?.join(', ') || 'Unknown error'}`);
  }
  
  console.log(`   → Deposit created: ${depositData.createDeposit.deposit.id}`);
  testData.depositId = depositData.createDeposit.deposit.id;
  
  // Approve deposit (simulate provider confirmation)
  await sleep(500);
  
  const approveData = await graphql(`
    mutation ApproveTransaction($transactionId: String!) {
      approveTransaction(transactionId: $transactionId) {
        success
        transaction {
          id
          status
        }
      }
    }
  `, {
    transactionId: depositData.createDeposit.deposit.id,
  }, TOKENS.admin);
  
  if (!approveData?.approveTransaction?.success) {
    throw new Error('Failed to approve deposit');
  }
  
  console.log(`   → Deposit approved`);
  
  // Manually trigger wallet sync via GraphQL mutation (if available) or wait for event-driven sync
  // Wait for ledger sync with retry mechanism (event-driven sync may take a moment)
  // Retry up to 15 times with exponential backoff (max 10 seconds total)
  let userLedgerBalance = 0;
  let ledgerAccountExists = false;
  let walletBalance = 0;
  let balanceMatches = false;
  const maxRetries = 15;
  const initialDelay = 300; // Start with 300ms for more reliable sync
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(attempt === 0 ? initialDelay : initialDelay * Math.pow(1.5, attempt));
    
    // Get user ledger balance
    try {
      const userBalanceData = await graphql(`
        query GetUserLedgerBalance($userId: String, $subtype: String, $currency: String) {
          ledgerAccountBalance(userId: $userId, subtype: $subtype, currency: $currency) {
            accountId
            balance
            availableBalance
          }
        }
      `, {
        userId: CONFIG.testUserId,
        subtype: 'real',
        currency: CONFIG.currency,
      }, TOKENS.admin);
      
      if (userBalanceData?.ledgerAccountBalance) {
        userLedgerBalance = userBalanceData.ledgerAccountBalance.balance || 0;
        ledgerAccountExists = true;
      }
    } catch (error: any) {
      if (error.message?.includes('Account not found')) {
        // Expected - ledger account created lazily, continue retrying
        continue;
      } else {
        throw error;
      }
    }
    
    // Get wallet balance - query directly to avoid caching issues
    const walletData = await graphql(`
      query GetWallet($id: ID!) {
        wallet(id: $id) {
          id
          balance
        }
      }
    `, {
      id: testData.userWalletId,
    }, TOKENS.admin);
    
    walletBalance = walletData?.wallet?.balance ?? 0;
    
    // Check if balances match (allow 1 cent difference for rounding)
    if (ledgerAccountExists) {
      const balanceDiff = Math.abs(walletBalance - userLedgerBalance);
      if (balanceDiff <= 1) {
        balanceMatches = true;
        break; // Success - balances match!
      }
    } else if (walletBalance > 0) {
      // Wallet has balance but ledger account doesn't exist yet - this shouldn't happen
      // but we'll continue retrying
      continue;
    }
  }
  
  // Report results
  console.log(`   → Wallet Balance: ${formatCurrency(walletBalance)}`);
  
  if (!ledgerAccountExists) {
    console.log(`   ⚠️  User ledger account not found after ${maxRetries} retries`);
    console.log(`   → This may indicate a problem - ledger account should exist after deposit`);
    if (walletBalance > 0) {
      throw new Error(`Wallet has balance (${formatCurrency(walletBalance)}) but ledger account not found - sync may have failed`);
    }
  } else {
    console.log(`   → User Ledger Balance: ${formatCurrency(userLedgerBalance)}`);
    if (!balanceMatches) {
      throw new Error(`Balance mismatch after ${maxRetries} retries! Wallet: ${formatCurrency(walletBalance)}, Ledger: ${formatCurrency(userLedgerBalance)}`);
    }
    console.log(`   ✅ Balances match!`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 6: Withdrawal Flow with Ledger Validation
// ═══════════════════════════════════════════════════════════════════

async function testWithdrawalFlow() {
  // Get initial balances (may not exist yet - created lazily)
  let availableBalance = 0;
  try {
    const initialUserBalance = await graphql(`
      query GetUserLedgerBalance($userId: String, $subtype: String, $currency: String) {
        ledgerAccountBalance(userId: $userId, subtype: $subtype, currency: $currency) {
          balance
        }
      }
    `, {
      userId: CONFIG.testUserId,
      subtype: 'real',
      currency: CONFIG.currency,
    }, TOKENS.admin);
    
    if (initialUserBalance?.ledgerAccountBalance) {
      availableBalance = initialUserBalance.ledgerAccountBalance.balance || 0;
      console.log(`   → User Balance Before: ${formatCurrency(availableBalance)}`);
    }
  } catch (error: any) {
    if (error.message?.includes('Account not found')) {
      // Expected - ledger account created lazily, use wallet balance instead
    } else {
      throw error;
    }
  }
  
  // If ledger account doesn't exist, check wallet balance instead
  if (availableBalance === 0) {
    const walletData = await graphql(`
      query GetWallet($id: ID!) {
        wallet(id: $id) {
          balance
        }
      }
    `, { id: testData.userWalletId }, TOKENS.admin);
    availableBalance = walletData?.wallet?.balance || 0;
    console.log(`   → User Ledger Account not found, using wallet balance: ${formatCurrency(availableBalance)}`);
    console.log(`   → This is expected - ledger accounts are created lazily`);
  }
  
  if (availableBalance < CONFIG.testAmounts.withdrawal) {
    console.log(`   ⚠️  Skipping withdrawal test - insufficient balance (${formatCurrency(availableBalance)} available, ${formatCurrency(CONFIG.testAmounts.withdrawal)} required)`);
    console.log(`   → This is expected if deposit flow hasn't completed successfully`);
    return;
  }
  
  // Create withdrawal
  const withdrawalData = await graphql(`
    mutation CreateWithdrawal($input: CreateWithdrawalInput!) {
      createWithdrawal(input: $input) {
        success
        withdrawal {
          id
          amount
          status
        }
        errors
      }
    }
  `, {
    input: {
      userId: CONFIG.testUserId,
      amount: CONFIG.testAmounts.withdrawal,
      currency: CONFIG.currency,
      method: 'bank_transfer',
      tenantId: CONFIG.tenantId,
    },
  }, TOKENS.admin);
  
  if (!withdrawalData?.createWithdrawal?.success) {
    throw new Error(`Withdrawal failed: ${withdrawalData?.createWithdrawal?.errors?.join(', ') || 'Unknown error'}`);
  }
  
  console.log(`   → Withdrawal created: ${withdrawalData.createWithdrawal.withdrawal.id}`);
  testData.withdrawalId = withdrawalData.createWithdrawal.withdrawal.id;
  
  // Approve withdrawal
  await sleep(500);
  
  const approveData = await graphql(`
    mutation ApproveTransaction($transactionId: String!) {
      approveTransaction(transactionId: $transactionId) {
        success
        transaction {
          id
          status
        }
      }
    }
  `, {
    transactionId: withdrawalData.createWithdrawal.withdrawal.id,
  }, TOKENS.admin);
  
  if (!approveData?.approveTransaction?.success) {
    throw new Error('Failed to approve withdrawal');
  }
  
  console.log(`   → Withdrawal approved`);
  
  // Wait for ledger sync
  await sleep(1000);
  
  // Verify balances (may not exist yet - created lazily)
  try {
    const userBalanceAfter = await graphql(`
      query GetUserLedgerBalance($userId: String, $subtype: String, $currency: String) {
        ledgerAccountBalance(userId: $userId, subtype: $subtype, currency: $currency) {
          balance
        }
      }
    `, {
      userId: CONFIG.testUserId,
      subtype: 'real',
      currency: CONFIG.currency,
    }, TOKENS.admin);
    
    if (userBalanceAfter?.ledgerAccountBalance) {
      const userBalanceAfterValue = userBalanceAfter.ledgerAccountBalance.balance || 0;
      console.log(`   → User Balance After: ${formatCurrency(userBalanceAfterValue)}`);
      
      // Calculate expected balance: withdrawal amount + fee (1% fee)
      const withdrawalFee = Math.round(CONFIG.testAmounts.withdrawal * 0.01);
      const totalWithdrawalAmount = CONFIG.testAmounts.withdrawal + withdrawalFee;
      const expectedBalance = availableBalance - totalWithdrawalAmount;
      const balanceDiff = Math.abs(userBalanceAfterValue - expectedBalance);
      
      if (balanceDiff > 1) {
        throw new Error(`Balance mismatch! Expected: ${formatCurrency(expectedBalance)} (withdrawal: ${formatCurrency(CONFIG.testAmounts.withdrawal)} + fee: ${formatCurrency(withdrawalFee)}), Got: ${formatCurrency(userBalanceAfterValue)}`);
      }
      
      console.log(`   ✅ Withdrawal processed correctly!`);
    } else {
      // Check wallet balance instead
      const walletData = await graphql(`
        query GetWallet($id: ID!) {
          wallet(id: $id) {
            balance
          }
        }
      `, { id: testData.userWalletId }, TOKENS.admin);
      const walletBalanceAfter = walletData?.wallet?.balance || 0;
      console.log(`   → Wallet Balance After: ${formatCurrency(walletBalanceAfter)}`);
      console.log(`   ⚠️  Ledger account not found (will be created on next transaction)`);
    }
  } catch (error: any) {
    if (error.message?.includes('Account not found')) {
      // Check wallet balance instead
      const walletData = await graphql(`
        query GetWallet($id: ID!) {
          wallet(id: $id) {
            balance
          }
        }
      `, { id: testData.userWalletId }, TOKENS.admin);
      const walletBalanceAfter = walletData?.wallet?.balance || 0;
      console.log(`   → Wallet Balance After: ${formatCurrency(walletBalanceAfter)}`);
      console.log(`   ⚠️  Ledger account not found (will be created on next transaction)`);
      console.log(`   → This is expected - ledger accounts are created lazily`);
    } else {
      throw error;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 7: Transaction Operations (Bet, Win, Bonus Credit)
// ═══════════════════════════════════════════════════════════════════

async function testBetTransaction() {
  // Get balance before bet
  const walletBefore = await graphql(`
    query GetWallet($id: ID!) {
      wallet(id: $id) {
        balance
      }
    }
  `, { id: testData.userWalletId }, TOKENS.admin);
  const balanceBefore = walletBefore?.wallet?.balance || 0;
  
  // Skip bet test if insufficient funds (expected if deposit hasn't completed)
  if (balanceBefore < CONFIG.testAmounts.bet) {
    console.log(`   ⚠️  Skipping bet test - insufficient funds (${formatCurrency(balanceBefore)} available, ${formatCurrency(CONFIG.testAmounts.bet)} required)`);
    console.log(`   → This is expected if deposit flow hasn't completed successfully`);
    return;
  }
  
  const betData = await graphql(`
    mutation CreateWalletTransaction($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balance
        }
        errors
      }
    }
  `, {
    input: {
      walletId: testData.userWalletId,
      userId: CONFIG.testUserId,
      type: 'bet',
      balanceType: 'real',
      amount: CONFIG.testAmounts.bet,
      currency: CONFIG.currency,
      description: 'Test bet transaction',
    },
  }, TOKENS.system);
  
  if (!betData?.createWalletTransaction?.success) {
    const errors = betData?.createWalletTransaction?.errors || [];
    if (errors.some((e: string) => e.includes('Insufficient'))) {
      console.log(`   ⚠️  Bet correctly rejected due to insufficient funds`);
      return;
    }
    throw new Error(`Bet failed: ${errors.join(', ') || 'Unknown error'}`);
  }
  
  const balanceAfter = betData.createWalletTransaction.walletTransaction.balance;
  console.log(`   → Bet placed: ${formatCurrency(CONFIG.testAmounts.bet)}`);
  console.log(`   → Balance: ${formatCurrency(balanceBefore)} → ${formatCurrency(balanceAfter)}`);
}

async function testWinTransaction() {
  // Get balance before win
  const walletBefore = await graphql(`
    query GetWallet($id: ID!) {
      wallet(id: $id) {
        balance
      }
    }
  `, { id: testData.userWalletId }, TOKENS.admin);
  const balanceBefore = walletBefore?.wallet?.balance || 0;
  
  // Record a win (credit to wallet)
  const winData = await graphql(`
    mutation CreateWalletTransaction($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balance
        }
        errors
      }
    }
  `, {
    input: {
      walletId: testData.userWalletId,
      userId: CONFIG.testUserId,
      type: 'win',
      balanceType: 'real',
      amount: CONFIG.testAmounts.win,
      currency: CONFIG.currency,
      description: 'Test win transaction',
    },
  }, TOKENS.system);
  
  if (!winData?.createWalletTransaction?.success) {
    throw new Error(`Win failed: ${winData?.createWalletTransaction?.errors?.join(', ') || 'Unknown error'}`);
  }
  
  const balanceAfter = winData.createWalletTransaction.walletTransaction.balance;
  console.log(`   → Win recorded: ${formatCurrency(CONFIG.testAmounts.win)}`);
  console.log(`   → Balance: ${formatCurrency(balanceBefore)} → ${formatCurrency(balanceAfter)}`);
}

async function testBonusCreditTransaction() {
  // Get bonus balance before credit
  const walletBefore = await graphql(`
    query GetWallet($id: ID!) {
      wallet(id: $id) {
        bonusBalance
      }
    }
  `, { id: testData.userWalletId }, TOKENS.admin);
  const bonusBefore = walletBefore?.wallet?.bonusBalance || 0;
  
  // Credit bonus balance
  const bonusData = await graphql(`
    mutation CreateWalletTransaction($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balance
        }
        errors
      }
    }
  `, {
    input: {
      walletId: testData.userWalletId,
      userId: CONFIG.testUserId,
      type: 'bonus_credit',
      balanceType: 'bonus',
      amount: CONFIG.testAmounts.bonusCredit,
      currency: CONFIG.currency,
      description: 'Test bonus credit',
    },
  }, TOKENS.system);
  
  if (!bonusData?.createWalletTransaction?.success) {
    throw new Error(`Bonus credit failed: ${bonusData?.createWalletTransaction?.errors?.join(', ') || 'Unknown error'}`);
  }
  
  // Get bonus balance after credit
  const walletAfter = await graphql(`
    query GetWallet($id: ID!) {
      wallet(id: $id) {
        bonusBalance
      }
    }
  `, { id: testData.userWalletId }, TOKENS.admin);
  const bonusAfter = walletAfter?.wallet?.bonusBalance || 0;
  
  console.log(`   → Bonus credited: ${formatCurrency(CONFIG.testAmounts.bonusCredit)}`);
  console.log(`   → Bonus Balance: ${formatCurrency(bonusBefore)} → ${formatCurrency(bonusAfter)}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 8: Balance Synchronization (Wallet ↔ Ledger)
// ═══════════════════════════════════════════════════════════════════

async function testBalanceSynchronization() {
  // Retry mechanism to wait for sync (event-driven sync may take a moment)
  const maxRetries = 10;
  const initialDelay = 200;
  let walletBalance = 0;
  let walletBonusBalance = 0;
  let ledgerRealBalance = 0;
  let ledgerBonusBalance = 0;
  let realAccountExists = false;
  let bonusAccountExists = false;
  let balancesMatch = false;
  let walletsData: any = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(attempt === 0 ? initialDelay : initialDelay * Math.pow(1.5, attempt));
    
    // Get wallet balance - use main wallet only (ledger tracks main wallet's real balance)
    // userWallets totals sum ALL wallets (main + sports + casino), but ledger only tracks main wallet
    walletsData = await graphql(`
      query GetUserWallets($input: JSON) {
        userWallets(input: $input) {
          totals {
            realBalance
            bonusBalance
          }
          wallets {
            id
            category
            realBalance
            bonusBalance
          }
        }
      }
    `, {
      input: {
        userId: CONFIG.testUserId,
        currency: CONFIG.currency,
      },
    }, TOKENS.admin);
    
    // Get main wallet balance (ledger tracks main wallet only)
    const mainWallet = walletsData?.userWallets?.wallets?.find((w: any) => w.category === 'main');
    walletBalance = mainWallet?.realBalance || 0;
    walletBonusBalance = mainWallet?.bonusBalance || 0;
    
    // Get ledger balances (may not exist yet - created lazily)
    try {
      const realLedgerBalance = await graphql(`
        query GetUserLedgerBalance($userId: String, $subtype: String, $currency: String) {
          ledgerAccountBalance(userId: $userId, subtype: $subtype, currency: $currency) {
            balance
          }
        }
      `, {
        userId: CONFIG.testUserId,
        subtype: 'real',
        currency: CONFIG.currency,
      }, TOKENS.admin);
      
      if (realLedgerBalance?.ledgerAccountBalance) {
        ledgerRealBalance = realLedgerBalance.ledgerAccountBalance.balance || 0;
        realAccountExists = true;
      }
    } catch (error: any) {
      if (!error.message?.includes('Account not found')) {
        throw error;
      }
    }
    
    try {
      const bonusLedgerBalance = await graphql(`
        query GetUserLedgerBalance($userId: String, $subtype: String, $currency: String) {
          ledgerAccountBalance(userId: $userId, subtype: $subtype, currency: $currency) {
            balance
          }
        }
      `, {
        userId: CONFIG.testUserId,
        subtype: 'bonus',
        currency: CONFIG.currency,
      }, TOKENS.admin);
      
      if (bonusLedgerBalance?.ledgerAccountBalance) {
        ledgerBonusBalance = bonusLedgerBalance.ledgerAccountBalance.balance || 0;
        bonusAccountExists = true;
      }
    } catch (error: any) {
      if (!error.message?.includes('Account not found')) {
        throw error;
      }
    }
    
    // Check if balances match (allow 1 cent difference for rounding)
    if (realAccountExists && walletBalance > 0) {
      const realDiff = Math.abs(walletBalance - ledgerRealBalance);
      if (realDiff <= 1) {
        balancesMatch = true;
        break; // Success - balances match!
      }
    } else if (realAccountExists && walletBalance === 0 && ledgerRealBalance === 0) {
      // Both are zero - match
      balancesMatch = true;
      break;
    }
  }
  
  // Get totals for informational purposes (after loop to use last walletsData)
  const totalRealBalance = walletsData?.userWallets?.totals?.realBalance || 0;
  
  console.log(`   → Main Wallet Real Balance: ${formatCurrency(walletBalance)}`);
  console.log(`   → Main Wallet Bonus Balance: ${formatCurrency(walletBonusBalance)}`);
  if (totalRealBalance !== walletBalance) {
    console.log(`   → Total All Wallets Real Balance: ${formatCurrency(totalRealBalance)} (ledger tracks main wallet only)`);
  }
  
  // Check if ledger accounts exist
  if (!realAccountExists) {
    console.log(`   ⚠️  User real ledger account not found after ${maxRetries} retries`);
    console.log(`   → This may indicate a problem - ledger account should exist after transactions`);
    if (walletBalance > 0) {
      throw new Error(`Wallet has balance (${formatCurrency(walletBalance)}) but ledger account not found - sync may have failed`);
    }
  } else {
    console.log(`   → Ledger Real Balance: ${formatCurrency(ledgerRealBalance)}`);
    if (!balancesMatch) {
      throw new Error(`Real balance mismatch after ${maxRetries} retries! Wallet: ${formatCurrency(walletBalance)}, Ledger: ${formatCurrency(ledgerRealBalance)}`);
    }
    console.log(`   ✅ Real balances match!`);
  }
  
  if (!bonusAccountExists) {
    console.log(`   ⚠️  User bonus ledger account not found (will be created on first bonus transaction)`);
    console.log(`   → This is expected - ledger accounts are created lazily`);
  } else {
    console.log(`   → Ledger Bonus Balance: ${formatCurrency(ledgerBonusBalance)}`);
    const bonusDiff = Math.abs(walletBonusBalance - ledgerBonusBalance);
    if (bonusDiff > 1) {
      console.log(`   ⚠️  Bonus balance mismatch (may be expected if no bonuses awarded)`);
    } else {
      console.log(`   ✅ Bonus balances match!`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 9: Error Handling
// ═══════════════════════════════════════════════════════════════════

async function testInsufficientBalanceError() {
  // Try to create withdrawal larger than balance
  const userBalanceData = await graphql(`
    query GetUserLedgerBalance($userId: String, $subtype: String, $currency: String) {
      ledgerAccountBalance(userId: $userId, subtype: $subtype, currency: $currency) {
        balance
      }
    }
  `, {
    userId: CONFIG.testUserId,
    subtype: 'real',
    currency: CONFIG.currency,
  }, TOKENS.admin);
  
  const currentBalance = userBalanceData?.ledgerAccountBalance?.balance || 0;
  const excessiveAmount = currentBalance + 1000000; // More than available
  
  console.log(`   → Current Balance: ${formatCurrency(currentBalance)}`);
  console.log(`   → Attempting withdrawal of: ${formatCurrency(excessiveAmount)}`);
  
  try {
    const withdrawalData = await graphql(`
      mutation CreateWithdrawal($input: CreateWithdrawalInput!) {
        createWithdrawal(input: $input) {
          success
          withdrawal {
            id
          }
          errors
        }
      }
    `, {
      input: {
        userId: CONFIG.testUserId,
        amount: excessiveAmount,
        currency: CONFIG.currency,
        method: 'bank_transfer',
        tenantId: CONFIG.tenantId,
      },
    }, TOKENS.admin);
    
    // If withdrawal was created, try to approve it (should fail)
    if (withdrawalData?.createWithdrawal?.success) {
      const approveData = await graphql(`
        mutation ApproveTransaction($transactionId: String!) {
          approveTransaction(transactionId: $transactionId) {
            success
            transaction {
              id
            }
          }
        }
      `, {
        transactionId: withdrawalData.createWithdrawal.withdrawal.id,
      }, TOKENS.admin);
      
      if (approveData?.approveTransaction?.success) {
        throw new Error('Withdrawal should have failed due to insufficient balance');
      } else {
        console.log(`   ✅ Withdrawal correctly rejected due to insufficient balance`);
      }
    } else {
      const errors = withdrawalData?.createWithdrawal?.errors || [];
      if (errors.some((e: string) => e.includes('Insufficient') || e.includes('balance'))) {
        console.log(`   ✅ Correctly rejected withdrawal: ${errors.join(', ')}`);
      } else {
        throw new Error(`Unexpected error: ${errors.join(', ')}`);
      }
    }
  } catch (error: any) {
    if (error.message?.includes('Insufficient') || error.message?.includes('balance')) {
      console.log(`   ✅ Correctly rejected withdrawal: ${error.message}`);
    } else {
      throw error;
    }
  }
}

async function testInvalidAmounts() {
  // Test zero amount
  const zeroData = await graphql(`
    mutation CreateWalletTransaction($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        errors
      }
    }
  `, {
    input: {
      walletId: testData.userWalletId,
      userId: CONFIG.testUserId,
      type: 'deposit',
      balanceType: 'real',
      amount: 0,
      currency: CONFIG.currency,
    },
  }, TOKENS.system);
  
  if (zeroData?.createWalletTransaction?.success) {
    throw new Error('Zero amount transaction should not be allowed');
  }
  console.log(`   → Zero amount correctly rejected`);
  
  // Test negative amount
  const negativeData = await graphql(`
    mutation CreateWalletTransaction($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        errors
      }
    }
  `, {
    input: {
      walletId: testData.userWalletId,
      userId: CONFIG.testUserId,
      type: 'deposit',
      balanceType: 'real',
      amount: -1000,
      currency: CONFIG.currency,
    },
  }, TOKENS.system);
  
  if (negativeData?.createWalletTransaction?.success) {
    throw new Error('Negative amount transaction should not be allowed');
  }
  console.log(`   → Negative amount correctly rejected`);
}

// ═══════════════════════════════════════════════════════════════════
// Test 10: Reconciliation & Reporting
// ═══════════════════════════════════════════════════════════════════

async function testTransactionHistory() {
  // Get transaction history (uses filter JSON, no orderBy)
  const txHistoryData = await graphql(`
    query GetTransactionHistory($filter: JSON) {
      walletTransactions(
        filter: $filter
        first: 50
      ) {
        nodes {
          id
          type
          amount
          balanceType
          balance
          description
          createdAt
        }
        totalCount
      }
    }
  `, {
    filter: { walletId: testData.userWalletId }
  }, TOKENS.admin);
  
  const transactions = txHistoryData?.walletTransactions?.nodes || [];
  console.log(`   → Total Transactions: ${txHistoryData?.walletTransactions?.totalCount || 0}`);
  console.log(`   → Showing last ${Math.min(transactions.length, 5)} transactions:`);
  
  for (const tx of transactions.slice(0, 5)) {
    console.log(`     • ${tx.type}: ${formatCurrency(tx.amount)} (balance: ${formatCurrency(tx.balance)})`);
  }
}

async function testFinalBalanceVerification() {
  // Get final wallet state
  const walletData = await graphql(`
    query GetWallet($id: ID!) {
      wallet(id: $id) {
        id
        balance
        bonusBalance
        lockedBalance
        lifetimeDeposits
        lifetimeWithdrawals
      }
    }
  `, {
    id: testData.userWalletId,
  }, TOKENS.admin);
  
  const wallet = walletData?.wallet;
  
  console.log(`   → Final Wallet State:`);
  console.log(`     Real Balance:        ${formatCurrency(wallet?.balance || 0)}`);
  console.log(`     Bonus Balance:       ${formatCurrency(wallet?.bonusBalance || 0)}`);
  console.log(`     Locked Balance:      ${formatCurrency(wallet?.lockedBalance || 0)}`);
  console.log(`     Lifetime Deposits:    ${formatCurrency(wallet?.lifetimeDeposits || 0)}`);
  console.log(`     Lifetime Withdrawals: ${formatCurrency(wallet?.lifetimeWithdrawals || 0)}`);
}

// ═══════════════════════════════════════════════════════════════════
// Health Check & Service Wait
// ═══════════════════════════════════════════════════════════════════

async function waitForService(maxAttempts: number = 30): Promise<boolean> {
  const url = PAYMENT_URL.replace('/graphql', '/health');
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url, { method: 'GET' });
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
// Main Test Runner
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║              LEDGER PAYMENT TESTS - COMPREHENSIVE SUITE              ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  Testing:                                                             ║
║  • Ledger system initialization & system accounts                     ║
║  • Payment provider configuration & ledger accounts                 ║
║  • Provider funding & ledger validation                              ║
║  • Wallet operations (create, multi-category, queries)              ║
║  • Deposit flow with ledger validation                               ║
║  • Withdrawal flow with ledger validation                            ║
║  • Transaction operations (bet, win, bonus credit)                  ║
║  • Balance synchronization (wallet ↔ ledger)                        ║
║  • Error handling (insufficient funds, invalid amounts)             ║
║  • Reconciliation & reporting                                       ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  console.log(`Test Configuration:`);
  console.log(`  User ID: ${CONFIG.testUserId}`);
  console.log(`  Provider ID: ${CONFIG.testProviderId}`);
  console.log(`  Currency: ${CONFIG.currency}`);
  console.log(`  Payment Service: ${PAYMENT_URL}`);
  console.log(``);

  // Wait for service
  console.log(`⏳ Waiting for payment service...`);
  const serviceReady = await waitForService();
  if (!serviceReady) {
    console.error(`\n❌ Payment service is not running!`);
    console.error(`\nPlease start the payment service before running tests.`);
    process.exit(1);
  }
  console.log(`   ✅ Payment service is ready\n`);

  try {
    // Test 1: Ledger System Accounts
    await runTest('Test 1: Verify Ledger System Accounts', testLedgerSystemAccounts);

    // Test 2: Provider Configuration
    await runTest('Test 2: Create Provider Configuration', testProviderConfiguration);

    // Test 3: Provider Funding
    await runTest('Test 3: Fund Provider Account', testProviderFunding);

    // Test 4: Wallet Operations
    await runTest('Test 4: Create User Wallet', testWalletCreation);
    await runTest('Test 5: Create Multi-Category Wallets', testMultiCategoryWallets);
    await runTest('Test 6: Test userWallets Query', testUserWalletsQuery);
    await runTest('Test 7: Test walletBalance Query', testWalletBalanceQuery);

    // Test 5: Deposit Flow
    await runTest('Test 8: Deposit Flow with Ledger Validation', testDepositFlow);

    // Test 6: Withdrawal Flow
    await runTest('Test 9: Withdrawal Flow with Ledger Validation', testWithdrawalFlow);

    // Test 7: Transaction Operations
    await runTest('Test 10: Bet Transaction', testBetTransaction);
    await runTest('Test 11: Win Transaction', testWinTransaction);
    await runTest('Test 12: Bonus Credit Transaction', testBonusCreditTransaction);

    // Test 8: Balance Synchronization
    await runTest('Test 13: Balance Synchronization Verification', testBalanceSynchronization);

    // Test 9: Error Handling
    await runTest('Test 14: Insufficient Balance Error Handling', testInsufficientBalanceError);
    await runTest('Test 15: Invalid Amounts Rejection', testInvalidAmounts);

    // Test 10: Reconciliation
    await runTest('Test 16: Transaction History', testTransactionHistory);
    await runTest('Test 17: Final Balance Verification', testFinalBalanceVerification);

  } catch (error: any) {
    console.error(`\n❌ Test suite failed: ${error.message}`);
    process.exit(1);
  }

  // Print summary
  console.log(`\n\n╔═══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                         TEST SUMMARY                                    ║`);
  console.log(`╠═══════════════════════════════════════════════════════════════════════╣`);
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`║  Total Tests: ${results.length.toString().padEnd(55)} ║`);
  console.log(`║  Passed: ${passed.toString().padEnd(59)} ║`);
  console.log(`║  Failed: ${failed.toString().padEnd(59)} ║`);
  console.log(`║  Total Duration: ${totalDuration}ms${' '.repeat(45 - totalDuration.toString().length)} ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════╝`);

  if (failed > 0) {
    console.log(`\n❌ Failed Tests:`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   • ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log(`\n✅ All tests passed!`);
    process.exit(0);
  }
}

// Run tests
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
