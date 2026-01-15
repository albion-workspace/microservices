#!/usr/bin/env npx tsx
/**
 * Payment Gateway - Complete Real-World Demo
 * 
 * This demo showcases all payment gateway features with real-world use cases:
 * 
 * 1. SYSTEM OPERATIONS
 *    - Configure payment providers (Stripe, PayPal, etc.)
 *    - System user funding wallet providers
 *    - Admin manual adjustments
 * 
 * 2. WALLET PROVIDER OPERATIONS  
 *    - Provider creating end user wallets
 *    - Provider funding end user wallets
 *    - Provider withdrawals
 * 
 * 3. END USER OPERATIONS
 *    - User deposits via multiple methods
 *    - User withdrawals with limits
 *    - User wallet transfers (multi-category)
 * 
 * 4. RECONCILIATION & REPORTING
 *    - Daily transaction reports
 *    - Balance reconciliation
 *    - Fee calculations
 *    - Audit trails
 * 
 * 5. WEBHOOK MANAGEMENT
 *    - Register webhooks for events
 *    - Test webhook delivery
 *    - View delivery history
 * 
 * Run: npx tsx scripts/payment-gateway-demo.ts
 */

import { createHmac, randomUUID } from 'crypto';

export {}; // Make this a module

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const PAYMENT_URL = process.env.PAYMENT_URL || 'http://localhost:3004/graphql';
const JWT_SECRET = process.env.JWT_SECRET || 'payment-gateway-secret-change-in-production';

// Demo data - simulating a real gaming platform
const DEMO_DATA = {
  tenantId: 'gaming-platform-eu',
  
  // System user (internal operations)
  systemUserId: 'system-treasury',
  
  // Wallet provider (e.g., a payment partner)
  providerId: 'wallet-provider-001',
  providerUserId: 'provider-partner-xyz',
  
  // End users (players)
  users: [
    { id: 'player-john-001', name: 'John Doe', email: 'john@example.com' },
    { id: 'player-jane-002', name: 'Jane Smith', email: 'jane@example.com' },
    { id: 'player-bob-003', name: 'Bob Wilson', email: 'bob@example.com' },
  ],
  
  // Currencies
  currencies: ['EUR', 'USD', 'GBP'],
  
  // Wallet categories for ring-fenced funds
  categories: ['main', 'casino', 'sports', 'bonus'],
};

// ═══════════════════════════════════════════════════════════════════
// JWT Token Generation
// ═══════════════════════════════════════════════════════════════════

function createJWT(payload: object, expiresIn: string = '8h'): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  let exp = now + 8 * 60 * 60;
  if (expiresIn.endsWith('h')) exp = now + parseInt(expiresIn) * 60 * 60;
  
  const fullPayload = { ...payload, iat: now, exp };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  
  return `${base64Header}.${base64Payload}.${signature}`;
}

// Different role tokens
const TOKENS = {
  // System/Admin - full access
  admin: createJWT({
    userId: 'admin-001',
    tenantId: DEMO_DATA.tenantId,
    roles: ['admin', 'system'],
    permissions: ['*:*:*'],
  }),
  
  // System treasury - for internal operations
  system: createJWT({
    userId: DEMO_DATA.systemUserId,
    tenantId: DEMO_DATA.tenantId,
    roles: ['system'],
    permissions: ['wallets:*:*', 'transactions:*:*'],
  }),
  
  // Wallet provider partner
  provider: createJWT({
    userId: DEMO_DATA.providerUserId,
    tenantId: DEMO_DATA.tenantId,
    roles: ['provider'],
    permissions: ['wallets:create:*', 'wallets:fund:*'],
  }),
  
  // Regular user (player)
  user: (userId: string) => createJWT({
    userId,
    tenantId: DEMO_DATA.tenantId,
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
// Utility Functions
// ═══════════════════════════════════════════════════════════════════

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100); // Assuming amounts in cents
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

function printResult(label: string, data: any): void {
  console.log(`  ${label}:`);
  console.log('  ' + JSON.stringify(data, null, 2).split('\n').join('\n  '));
}

// Store created wallet IDs for later use
const walletIds: Record<string, string> = {};

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: PAYMENT PROVIDER CONFIGURATION (Admin)
// ═══════════════════════════════════════════════════════════════════

async function configurePaymentProviders() {
  printSection('1. PAYMENT PROVIDER CONFIGURATION', 'Admin configures available payment methods');
  
  const providers = [
    {
      provider: 'stripe',
      name: 'Stripe (Card Payments)',
      supportedMethods: ['card', 'apple_pay', 'google_pay'],
      supportedCurrencies: ['EUR', 'USD', 'GBP'],
      feeType: 'percentage',
      feePercentage: 2.9,
    },
    {
      provider: 'paypal',
      name: 'PayPal',
      supportedMethods: ['e_wallet'],
      supportedCurrencies: ['EUR', 'USD', 'GBP'],
      feeType: 'percentage',
      feePercentage: 3.4,
    },
    {
      provider: 'bank_transfer',
      name: 'Bank Transfer (SEPA)',
      supportedMethods: ['bank_transfer'],
      supportedCurrencies: ['EUR'],
      feeType: 'fixed',
      feePercentage: 0,
    },
    {
      provider: 'crypto_btc',
      name: 'Bitcoin',
      supportedMethods: ['crypto'],
      supportedCurrencies: ['BTC'],
      feeType: 'percentage',
      feePercentage: 1.0,
    },
  ];

  const query = `
    mutation CreateProvider($input: CreateProviderConfigInput!) {
      createProviderConfig(input: $input) {
        success
        providerConfig {
          id
          provider
          name
          isActive
          supportedMethods
          supportedCurrencies
          feePercentage
        }
        errors
      }
    }
  `;

  console.log('  Configuring payment providers...\n');
  
  for (const provider of providers) {
    try {
      const data = await graphql(query, { input: provider }, TOKENS.admin);
      if (data.createProviderConfig.success) {
        console.log(`  ✅ ${provider.name} configured`);
        console.log(`     Methods: ${provider.supportedMethods.join(', ')}`);
        console.log(`     Currencies: ${provider.supportedCurrencies.join(', ')}`);
        console.log(`     Fee: ${provider.feePercentage}%\n`);
      }
    } catch (err: any) {
      // Provider might already exist
      console.log(`  ℹ️  ${provider.name}: ${err.message}`);
    }
  }

  // List all providers
  printSubSection('Active Payment Providers');
  
  const listQuery = `
    query ListProviders {
      providerConfigs(first: 20) {
        nodes {
          id
          provider
          name
          isActive
          supportedMethods
          supportedCurrencies
          feePercentage
        }
        totalCount
      }
    }
  `;

  const listData = await graphql(listQuery, {}, TOKENS.admin);
  console.log(`  Total providers: ${listData.providerConfigs.totalCount}`);
  listData.providerConfigs.nodes.forEach((p: any) => {
    console.log(`  • ${p.name} (${p.provider}) - ${p.isActive ? 'Active' : 'Inactive'}`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: SYSTEM USER FUNDING WALLET PROVIDER
// ═══════════════════════════════════════════════════════════════════

async function systemFundingWalletProvider() {
  printSection('2. SYSTEM USER → WALLET PROVIDER FUNDING', 
    'Treasury funds the wallet provider\'s float account');

  // Step 1: Create provider's master wallet (if not exists)
  printSubSection('Create Provider Master Wallet');
  
  const createWalletQuery = `
    mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) {
        success
        wallet {
          id
          userId
          currency
          category
          balance
          status
        }
        errors
      }
    }
  `;

  try {
    const walletData = await graphql(createWalletQuery, {
      input: {
        userId: DEMO_DATA.providerUserId,
        currency: 'EUR',
        category: 'main',
        tenantId: DEMO_DATA.tenantId,
      }
    }, TOKENS.admin);

    if (walletData.createWallet.success) {
      walletIds.provider = walletData.createWallet.wallet.id;
      console.log(`  ✅ Provider wallet created: ${walletIds.provider}`);
    }
  } catch (err: any) {
    console.log(`  ℹ️  Provider wallet may already exist: ${err.message}`);
    
    // Get existing wallet
    const getWalletQuery = `
      query GetUserWallets($input: JSON) {
        userWallets(input: $input)
      }
    `;
    const existingData = await graphql(getWalletQuery, {
      input: { userId: DEMO_DATA.providerUserId, currency: 'EUR' }
    }, TOKENS.admin);
    
    if (existingData.userWallets?.wallets?.[0]) {
      walletIds.provider = existingData.userWallets.wallets[0].id;
      console.log(`  ✅ Found existing provider wallet: ${walletIds.provider}`);
    }
  }

  // Step 2: System treasury funds the provider
  printSubSection('Treasury Funds Provider Wallet');
  
  const fundAmount = 10000000; // €100,000.00 in cents
  
  const fundQuery = `
    mutation FundProvider($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balanceBefore
          balanceAfter
          description
          createdAt
        }
        errors
      }
    }
  `;

  const fundData = await graphql(fundQuery, {
    input: {
      walletId: walletIds.provider,
      userId: DEMO_DATA.providerUserId,
      type: 'deposit',
      balanceType: 'real',
      amount: fundAmount,
      currency: 'EUR',
      description: 'Treasury funding - Monthly float replenishment',
    }
  }, TOKENS.system);

  if (fundData.createWalletTransaction.success) {
    const tx = fundData.createWalletTransaction.walletTransaction;
    console.log(`  ✅ Provider funded successfully!`);
    console.log(`     Transaction ID: ${tx.id}`);
    console.log(`     Amount: ${formatCurrency(tx.amount, 'EUR')}`);
    console.log(`     Balance Before: ${formatCurrency(tx.balanceBefore, 'EUR')}`);
    console.log(`     Balance After: ${formatCurrency(tx.balanceAfter, 'EUR')}`);
    console.log(`     Description: ${tx.description}`);
  }

  // Step 3: Get provider wallet summary
  printSubSection('Provider Wallet Summary');
  
  const summaryQuery = `
    query GetWalletBalance($input: JSON) {
      walletBalance(input: $input)
    }
  `;

  const summaryData = await graphql(summaryQuery, {
    input: { walletId: walletIds.provider }
  }, TOKENS.admin);

  printResult('Provider Wallet', summaryData.walletBalance);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: WALLET PROVIDER FUNDING END USERS
// ═══════════════════════════════════════════════════════════════════

async function providerFundingEndUsers() {
  printSection('3. WALLET PROVIDER → END USER FUNDING',
    'Provider creates and funds end user wallets');

  // Create wallets for each test user
  const createWalletQuery = `
    mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) {
        success
        wallet {
          id
          userId
          currency
          category
          balance
        }
        errors
      }
    }
  `;

  // First create wallets for all users with multiple categories
  printSubSection('Create User Wallets (Multi-Category)');
  
  for (const user of DEMO_DATA.users) {
    console.log(`\n  User: ${user.name} (${user.id})`);
    
    for (const category of ['main', 'casino', 'sports']) {
      try {
        const walletData = await graphql(createWalletQuery, {
          input: {
            userId: user.id,
            currency: 'EUR',
            category,
            tenantId: DEMO_DATA.tenantId,
          }
        }, TOKENS.admin);

        if (walletData.createWallet.success) {
          const key = `${user.id}_${category}`;
          walletIds[key] = walletData.createWallet.wallet.id;
          console.log(`    ✅ ${category} wallet: ${walletIds[key]}`);
        }
      } catch (err: any) {
        console.log(`    ℹ️  ${category} wallet exists`);
        
        // Get existing wallet
        const getWalletQuery = `
          query GetWalletBalance($input: JSON) {
            walletBalance(input: $input)
          }
        `;
        const existingData = await graphql(getWalletQuery, {
          input: { userId: user.id, category, currency: 'EUR' }
        }, TOKENS.admin);
        
        if (existingData.walletBalance?.walletId) {
          const key = `${user.id}_${category}`;
          walletIds[key] = existingData.walletBalance.walletId;
        }
      }
    }
  }

  // Fund user wallets (simulating deposits)
  printSubSection('Provider Funds User Main Wallets');
  
  const fundQuery = `
    mutation FundUser($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balanceAfter
        }
        errors
      }
    }
  `;

  const userDeposits = [
    { user: DEMO_DATA.users[0], amount: 50000, description: 'Welcome deposit - Bank transfer' },
    { user: DEMO_DATA.users[1], amount: 100000, description: 'VIP deposit - Wire transfer' },
    { user: DEMO_DATA.users[2], amount: 25000, description: 'First deposit - Card payment' },
  ];

  for (const deposit of userDeposits) {
    const key = `${deposit.user.id}_main`;
    if (!walletIds[key]) continue;

    const fundData = await graphql(fundQuery, {
      input: {
        walletId: walletIds[key],
        userId: deposit.user.id,
        type: 'deposit',
        balanceType: 'real',
        amount: deposit.amount,
        currency: 'EUR',
        description: deposit.description,
      }
    }, TOKENS.admin);

    if (fundData.createWalletTransaction.success) {
      console.log(`  ✅ ${deposit.user.name}: ${formatCurrency(deposit.amount, 'EUR')}`);
      console.log(`     Balance: ${formatCurrency(fundData.createWalletTransaction.walletTransaction.balanceAfter, 'EUR')}`);
    }
  }

  // Add bonus balance to users
  printSubSection('Credit Bonus Balance to Users');
  
  for (const user of DEMO_DATA.users) {
    const key = `${user.id}_main`;
    if (!walletIds[key]) continue;

    const bonusAmount = 10000; // €100 bonus
    
    const bonusData = await graphql(fundQuery, {
      input: {
        walletId: walletIds[key],
        userId: user.id,
        type: 'bonus_credit',
        balanceType: 'bonus',
        amount: bonusAmount,
        currency: 'EUR',
        description: 'Welcome bonus - 100% first deposit match',
      }
    }, TOKENS.system);

    if (bonusData.createWalletTransaction.success) {
      console.log(`  ✅ ${user.name}: ${formatCurrency(bonusAmount, 'EUR')} bonus credited`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: END USER OPERATIONS
// ═══════════════════════════════════════════════════════════════════

async function endUserOperations() {
  printSection('4. END USER OPERATIONS',
    'Users performing deposits, withdrawals, and transfers');

  const testUser = DEMO_DATA.users[0]; // John Doe
  const userToken = TOKENS.user(testUser.id);

  // Simulate user placing bets (debiting from wallet)
  printSubSection('User Places Bets (Debits)');
  
  const debitQuery = `
    mutation PlaceBet($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          type
          amount
          balanceBefore
          balanceAfter
          description
        }
        errors
      }
    }
  `;

  const bets = [
    { amount: 5000, description: 'Sports bet - Champions League final' },
    { amount: 2500, description: 'Casino - Blackjack session' },
    { amount: 1000, description: 'Sports bet - Premier League' },
  ];

  const mainWalletKey = `${testUser.id}_main`;
  
  for (const bet of bets) {
    const betData = await graphql(debitQuery, {
      input: {
        walletId: walletIds[mainWalletKey],
        userId: testUser.id,
        type: 'bet',
        balanceType: 'real',
        amount: bet.amount,
        currency: 'EUR',
        description: bet.description,
      }
    }, TOKENS.system);

    if (betData.createWalletTransaction.success) {
      const tx = betData.createWalletTransaction.walletTransaction;
      console.log(`  🎲 Bet placed: ${formatCurrency(bet.amount, 'EUR')}`);
      console.log(`     ${bet.description}`);
      console.log(`     Balance: ${formatCurrency(tx.balanceBefore, 'EUR')} → ${formatCurrency(tx.balanceAfter, 'EUR')}\n`);
    }
  }

  // Simulate user winning (crediting wallet)
  printSubSection('User Wins (Credits)');
  
  const wins = [
    { amount: 15000, description: 'Sports win - Champions League bet 3:1 odds' },
    { amount: 3500, description: 'Casino win - Blackjack 21!' },
  ];

  for (const win of wins) {
    const winData = await graphql(debitQuery, {
      input: {
        walletId: walletIds[mainWalletKey],
        userId: testUser.id,
        type: 'win',
        balanceType: 'real',
        amount: win.amount,
        currency: 'EUR',
        description: win.description,
      }
    }, TOKENS.system);

    if (winData.createWalletTransaction.success) {
      const tx = winData.createWalletTransaction.walletTransaction;
      console.log(`  🎉 Win: ${formatCurrency(win.amount, 'EUR')}`);
      console.log(`     ${win.description}`);
      console.log(`     Balance: ${formatCurrency(tx.balanceBefore, 'EUR')} → ${formatCurrency(tx.balanceAfter, 'EUR')}\n`);
    }
  }

  // User requests withdrawal
  printSubSection('User Requests Withdrawal');
  
  const withdrawalQuery = `
    mutation RequestWithdrawal($input: CreateWithdrawalInput!) {
      createWithdrawal(input: $input) {
        success
        withdrawal {
          id
          type
          status
          amount
          feeAmount
          netAmount
          currency
          paymentDetails
        }
        errors
      }
    }
  `;

  const withdrawalData = await graphql(withdrawalQuery, {
    input: {
      userId: testUser.id,
      amount: 10000, // €100
      currency: 'EUR',
      method: 'bank_transfer',
      bankAccount: 'DE89370400440532013000',
      tenantId: DEMO_DATA.tenantId,
    }
  }, TOKENS.admin);

  if (withdrawalData.createWithdrawal.success) {
    const w = withdrawalData.createWithdrawal.withdrawal;
    console.log(`  💸 Withdrawal requested:`);
    console.log(`     ID: ${w.id}`);
    console.log(`     Status: ${w.status}`);
    console.log(`     Amount: ${formatCurrency(w.amount, 'EUR')}`);
    console.log(`     Fee: ${formatCurrency(w.feeAmount, 'EUR')}`);
    console.log(`     Net: ${formatCurrency(w.netAmount, 'EUR')}`);
  }

  // Get user's complete wallet summary
  printSubSection('User Wallet Summary');
  
  const summaryQuery = `
    query GetUserWallets($input: JSON) {
      userWallets(input: $input)
    }
  `;

  const summaryData = await graphql(summaryQuery, {
    input: { userId: testUser.id }
  }, TOKENS.admin);

  if (summaryData.userWallets) {
    const w = summaryData.userWallets;
    console.log(`  User: ${testUser.name}`);
    console.log(`  Total Balances:`);
    console.log(`    Real:        ${formatCurrency(w.totals.realBalance, 'EUR')}`);
    console.log(`    Bonus:       ${formatCurrency(w.totals.bonusBalance, 'EUR')}`);
    console.log(`    Locked:      ${formatCurrency(w.totals.lockedBalance, 'EUR')}`);
    console.log(`    Withdrawable: ${formatCurrency(w.totals.withdrawableBalance, 'EUR')}`);
    console.log(`\n  Wallets by Category:`);
    for (const wallet of w.wallets) {
      console.log(`    ${wallet.category}: Real ${formatCurrency(wallet.realBalance, 'EUR')} | Bonus ${formatCurrency(wallet.bonusBalance, 'EUR')}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: RECONCILIATION & REPORTING
// ═══════════════════════════════════════════════════════════════════

async function reconciliationAndReporting() {
  printSection('5. RECONCILIATION & REPORTING',
    'Daily reports, balance reconciliation, and audit trails');

  const testUser = DEMO_DATA.users[0];
  const mainWalletKey = `${testUser.id}_main`;

  // Get all transactions for reconciliation
  printSubSection('Transaction History (Last 24h)');
  
  const txHistoryQuery = `
    query GetTransactionHistory {
      walletTransactions(
        filter: { walletId: "${walletIds[mainWalletKey]}" }
        first: 50
        orderBy: { field: "createdAt", direction: "DESC" }
      ) {
        nodes {
          id
          type
          amount
          balanceType
          balanceBefore
          balanceAfter
          description
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

  const txData = await graphql(txHistoryQuery, {}, TOKENS.admin);
  
  console.log(`  Total Transactions: ${txData.walletTransactions.totalCount}\n`);
  console.log('  | Type        | Amount       | Balance After | Description');
  console.log('  |-------------|--------------|---------------|---------------------------');
  
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalBets = 0;
  let totalWins = 0;
  let totalBonuses = 0;

  for (const tx of txData.walletTransactions.nodes.slice(0, 10)) {
    const amountStr = formatCurrency(tx.amount, 'EUR').padStart(12);
    const balanceStr = formatCurrency(tx.balanceAfter, 'EUR').padStart(13);
    const desc = (tx.description || '-').slice(0, 25);
    console.log(`  | ${tx.type.padEnd(11)} | ${amountStr} | ${balanceStr} | ${desc}`);
    
    // Aggregate for summary
    switch (tx.type) {
      case 'deposit': totalDeposits += tx.amount; break;
      case 'withdrawal': totalWithdrawals += tx.amount; break;
      case 'bet': totalBets += tx.amount; break;
      case 'win': totalWins += tx.amount; break;
      case 'bonus_credit': totalBonuses += tx.amount; break;
    }
  }

  // Daily Summary Report
  printSubSection('Daily Summary Report');
  
  console.log(`  ┌─────────────────────────────────────────────────┐`);
  console.log(`  │            DAILY RECONCILIATION REPORT          │`);
  console.log(`  │                 ${new Date().toISOString().split('T')[0]}                    │`);
  console.log(`  ├─────────────────────────────────────────────────┤`);
  console.log(`  │  INFLOWS                                        │`);
  console.log(`  │    Deposits:        ${formatCurrency(totalDeposits, 'EUR').padStart(15)}        │`);
  console.log(`  │    Wins:            ${formatCurrency(totalWins, 'EUR').padStart(15)}        │`);
  console.log(`  │    Bonuses:         ${formatCurrency(totalBonuses, 'EUR').padStart(15)}        │`);
  console.log(`  │  ─────────────────────────────────────────────  │`);
  console.log(`  │    Total In:        ${formatCurrency(totalDeposits + totalWins + totalBonuses, 'EUR').padStart(15)}        │`);
  console.log(`  ├─────────────────────────────────────────────────┤`);
  console.log(`  │  OUTFLOWS                                       │`);
  console.log(`  │    Withdrawals:     ${formatCurrency(totalWithdrawals, 'EUR').padStart(15)}        │`);
  console.log(`  │    Bets:            ${formatCurrency(totalBets, 'EUR').padStart(15)}        │`);
  console.log(`  │  ─────────────────────────────────────────────  │`);
  console.log(`  │    Total Out:       ${formatCurrency(totalWithdrawals + totalBets, 'EUR').padStart(15)}        │`);
  console.log(`  ├─────────────────────────────────────────────────┤`);
  const netFlow = (totalDeposits + totalWins + totalBonuses) - (totalWithdrawals + totalBets);
  console.log(`  │  NET FLOW:          ${formatCurrency(netFlow, 'EUR').padStart(15)}        │`);
  console.log(`  └─────────────────────────────────────────────────┘`);

  // Balance Verification
  printSubSection('Balance Verification');
  
  const walletQuery = `
    query GetWallet {
      wallet(id: "${walletIds[mainWalletKey]}") {
        id
        balance
        bonusBalance
        lockedBalance
        lifetimeDeposits
        lifetimeWithdrawals
      }
    }
  `;

  const walletData = await graphql(walletQuery, {}, TOKENS.admin);
  const wallet = walletData.wallet;
  
  console.log(`  Current Wallet State:`);
  console.log(`    Real Balance:        ${formatCurrency(wallet.balance, 'EUR')}`);
  console.log(`    Bonus Balance:       ${formatCurrency(wallet.bonusBalance, 'EUR')}`);
  console.log(`    Locked Balance:      ${formatCurrency(wallet.lockedBalance, 'EUR')}`);
  console.log(`    Lifetime Deposits:   ${formatCurrency(wallet.lifetimeDeposits, 'EUR')}`);
  console.log(`    Lifetime Withdrawals: ${formatCurrency(wallet.lifetimeWithdrawals, 'EUR')}`);

  // All deposits from the transactions collection
  printSubSection('All Deposit Transactions');
  
  const depositsQuery = `
    query GetDeposits {
      deposits(
        filter: { userId: "${testUser.id}" }
        first: 20
        orderBy: { field: "createdAt", direction: "DESC" }
      ) {
        nodes {
          id
          type
          status
          amount
          feeAmount
          netAmount
          currency
          providerName
          createdAt
        }
        totalCount
      }
    }
  `;

  try {
    const depositsData = await graphql(depositsQuery, {}, TOKENS.admin);
    console.log(`  Total Deposits: ${depositsData.deposits.totalCount}`);
    for (const d of depositsData.deposits.nodes.slice(0, 5)) {
      console.log(`    ${d.id.slice(0, 8)}... | ${d.status.padEnd(10)} | ${formatCurrency(d.amount, d.currency)} | via ${d.providerName}`);
    }
  } catch (err) {
    console.log(`  No deposit transactions found in transactions collection`);
  }

  // All withdrawals
  printSubSection('All Withdrawal Transactions');
  
  const withdrawalsQuery = `
    query GetWithdrawals {
      withdrawals(
        filter: { userId: "${testUser.id}" }
        first: 20
        orderBy: { field: "createdAt", direction: "DESC" }
      ) {
        nodes {
          id
          type
          status
          amount
          feeAmount
          netAmount
          currency
          createdAt
        }
        totalCount
      }
    }
  `;

  try {
    const withdrawalsData = await graphql(withdrawalsQuery, {}, TOKENS.admin);
    console.log(`  Total Withdrawals: ${withdrawalsData.withdrawals.totalCount}`);
    for (const w of withdrawalsData.withdrawals.nodes.slice(0, 5)) {
      console.log(`    ${w.id.slice(0, 8)}... | ${w.status.padEnd(10)} | ${formatCurrency(w.amount, w.currency)} (fee: ${formatCurrency(w.feeAmount, w.currency)})`);
    }
  } catch (err) {
    console.log(`  No withdrawal transactions found`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: WEBHOOK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

async function webhookManagement() {
  printSection('6. WEBHOOK MANAGEMENT',
    'Register webhooks to receive payment events');

  // Register a webhook
  printSubSection('Register Webhook Endpoint');
  
  const registerQuery = `
    mutation RegisterWebhook($input: RegisterWebhookInput!) {
      registerWebhook(input: $input) {
        success
        webhook {
          id
          url
          events
          isActive
          secretHash
          createdAt
        }
        errors
      }
    }
  `;

  const webhookEndpoint = 'https://api.example.com/webhooks/payments';
  
  try {
    const registerData = await graphql(registerQuery, {
      input: {
        url: webhookEndpoint,
        events: [
          'wallet.deposit.completed',
          'wallet.withdrawal.completed',
          'wallet.created',
        ],
        secret: 'webhook-secret-123',
        metadata: {
          environment: 'production',
          service: 'accounting',
        },
      }
    }, TOKENS.admin);

    if (registerData.registerWebhook.success) {
      const wh = registerData.registerWebhook.webhook;
      console.log(`  ✅ Webhook registered:`);
      console.log(`     ID: ${wh.id}`);
      console.log(`     URL: ${wh.url}`);
      console.log(`     Events: ${wh.events.join(', ')}`);
      console.log(`     Active: ${wh.isActive}`);
    }
  } catch (err: any) {
    console.log(`  ℹ️  Webhook registration: ${err.message}`);
  }

  // List all webhooks
  printSubSection('Active Webhooks');
  
  const listQuery = `
    query ListWebhooks {
      webhooks(first: 10) {
        nodes {
          id
          url
          events
          isActive
          createdAt
        }
        totalCount
      }
    }
  `;

  try {
    const listData = await graphql(listQuery, {}, TOKENS.admin);
    console.log(`  Total webhooks: ${listData.webhooks.totalCount}\n`);
    
    for (const wh of listData.webhooks.nodes) {
      console.log(`  📡 ${wh.url}`);
      console.log(`     Events: ${wh.events.join(', ')}`);
      console.log(`     Status: ${wh.isActive ? '✅ Active' : '❌ Inactive'}\n`);
    }
  } catch (err: any) {
    console.log(`  No webhooks configured yet`);
  }

  // View webhook delivery stats
  printSubSection('Webhook Delivery Statistics');
  
  const statsQuery = `
    query WebhookStats {
      webhookStats
    }
  `;

  try {
    const statsData = await graphql(statsQuery, {}, TOKENS.admin);
    printResult('Delivery Stats', statsData.webhookStats);
  } catch (err: any) {
    console.log(`  No webhook delivery stats available`);
  }

  // Test webhook delivery
  printSubSection('Test Webhook Delivery');
  
  console.log(`  Available webhook events:`);
  console.log(`    • wallet.created - New wallet created`);
  console.log(`    • wallet.deposit.initiated - Deposit started`);
  console.log(`    • wallet.deposit.completed - Deposit successful`);
  console.log(`    • wallet.deposit.failed - Deposit failed`);
  console.log(`    • wallet.withdrawal.initiated - Withdrawal requested`);
  console.log(`    • wallet.withdrawal.completed - Withdrawal processed`);
  console.log(`    • wallet.withdrawal.failed - Withdrawal failed`);
  console.log(`    • wallet.transfer.completed - Internal transfer`);
  console.log(`    • wallet.* - Wildcard (all wallet events)`);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: MULTI-CURRENCY & CATEGORY WALLETS
// ═══════════════════════════════════════════════════════════════════

async function multiCurrencyOperations() {
  printSection('7. MULTI-CURRENCY & CATEGORY WALLETS',
    'Managing wallets across currencies and ring-fenced categories');

  const testUser = DEMO_DATA.users[1]; // Jane Smith

  // Create wallets in different currencies
  printSubSection('Create Multi-Currency Wallets');
  
  const createWalletQuery = `
    mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) {
        success
        wallet {
          id
          userId
          currency
          category
          balance
        }
        errors
      }
    }
  `;

  const currencyWallets = [
    { currency: 'USD', category: 'main' },
    { currency: 'GBP', category: 'main' },
    { currency: 'EUR', category: 'sports' },
    { currency: 'EUR', category: 'casino' },
  ];

  for (const config of currencyWallets) {
    try {
      const data = await graphql(createWalletQuery, {
        input: {
          userId: testUser.id,
          currency: config.currency,
          category: config.category,
          tenantId: DEMO_DATA.tenantId,
        }
      }, TOKENS.admin);

      if (data.createWallet.success) {
        const key = `${testUser.id}_${config.currency}_${config.category}`;
        walletIds[key] = data.createWallet.wallet.id;
        console.log(`  ✅ ${config.currency}/${config.category} wallet created`);
      }
    } catch (err: any) {
      console.log(`  ℹ️  ${config.currency}/${config.category}: ${err.message.includes('exists') ? 'already exists' : err.message}`);
    }
  }

  // Fund the different category wallets
  printSubSection('Fund Category Wallets');
  
  const fundQuery = `
    mutation FundWallet($input: CreateWalletTransactionInput!) {
      createWalletTransaction(input: $input) {
        success
        walletTransaction {
          id
          amount
          balanceAfter
        }
      }
    }
  `;

  // Fund the sports wallet
  const sportsWalletKey = `${testUser.id}_EUR_sports`;
  if (walletIds[sportsWalletKey]) {
    await graphql(fundQuery, {
      input: {
        walletId: walletIds[sportsWalletKey],
        userId: testUser.id,
        type: 'deposit',
        balanceType: 'real',
        amount: 20000,
        currency: 'EUR',
        description: 'Sports betting deposit',
      }
    }, TOKENS.system);
    console.log(`  ✅ Sports wallet funded: ${formatCurrency(20000, 'EUR')}`);
  }

  // Fund the casino wallet
  const casinoWalletKey = `${testUser.id}_EUR_casino`;
  if (walletIds[casinoWalletKey]) {
    await graphql(fundQuery, {
      input: {
        walletId: walletIds[casinoWalletKey],
        userId: testUser.id,
        type: 'deposit',
        balanceType: 'real',
        amount: 15000,
        currency: 'EUR',
        description: 'Casino deposit',
      }
    }, TOKENS.system);
    console.log(`  ✅ Casino wallet funded: ${formatCurrency(15000, 'EUR')}`);
  }

  // Get complete user wallet summary
  printSubSection('User Portfolio Summary');
  
  const summaryQuery = `
    query GetUserWallets($input: JSON) {
      userWallets(input: $input)
    }
  `;

  // Get all EUR wallets
  const eurData = await graphql(summaryQuery, {
    input: { userId: testUser.id, currency: 'EUR' }
  }, TOKENS.admin);

  if (eurData.userWallets) {
    console.log(`\n  ${testUser.name}'s EUR Wallets:`);
    console.log(`  ┌──────────────┬──────────────┬──────────────┬──────────────┐`);
    console.log(`  │ Category     │ Real Balance │ Bonus Balance│ Total        │`);
    console.log(`  ├──────────────┼──────────────┼──────────────┼──────────────┤`);
    
    for (const wallet of eurData.userWallets.wallets) {
      const cat = wallet.category.padEnd(12);
      const real = formatCurrency(wallet.realBalance, 'EUR').padStart(12);
      const bonus = formatCurrency(wallet.bonusBalance, 'EUR').padStart(12);
      const total = formatCurrency(wallet.totalBalance, 'EUR').padStart(12);
      console.log(`  │ ${cat} │ ${real} │ ${bonus} │ ${total} │`);
    }
    
    console.log(`  ├──────────────┼──────────────┼──────────────┼──────────────┤`);
    const totals = eurData.userWallets.totals;
    console.log(`  │ TOTAL        │ ${formatCurrency(totals.realBalance, 'EUR').padStart(12)} │ ${formatCurrency(totals.bonusBalance, 'EUR').padStart(12)} │ ${formatCurrency(totals.totalBalance, 'EUR').padStart(12)} │`);
    console.log(`  └──────────────┴──────────────┴──────────────┴──────────────┘`);
  }

  // Show wallet strategy options
  printSubSection('Wallet Strategy Options');
  
  console.log(`  Available strategies for different platforms:\n`);
  console.log(`  1. SIMPLE_EWALLET (PayPal-style)`);
  console.log(`     - One wallet per currency, no categories`);
  console.log(`     - Best for: Simple payment apps\n`);
  
  console.log(`  2. UK_BETTING_PLATFORM (UKGC compliant)`);
  console.log(`     - Ring-fenced funds by product category`);
  console.log(`     - Categories: main, casino, sports, poker, bingo`);
  console.log(`     - Best for: UK-licensed gaming operators\n`);
  
  console.log(`  3. INTERNATIONAL_CASINO`);
  console.log(`     - Multi-currency with product ring-fencing`);
  console.log(`     - Categories: main, casino, sports, bonus`);
  console.log(`     - Best for: International gaming platforms\n`);
  
  console.log(`  4. CRYPTO_EXCHANGE (Binance-style)`);
  console.log(`     - One wallet per currency for trading`);
  console.log(`     - Auto-create: USDT, BTC, ETH`);
  console.log(`     - Best for: Crypto trading platforms`);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: ALL WALLETS LISTING (Admin)
// ═══════════════════════════════════════════════════════════════════

async function listAllWallets() {
  printSection('8. ALL WALLETS LISTING (Admin)',
    'Admin view of all wallets across the platform');

  const listQuery = `
    query ListAllWallets {
      wallets(
        first: 50
        orderBy: { field: "balance", direction: "DESC" }
      ) {
        nodes {
          id
          userId
          currency
          category
          balance
          bonusBalance
          lockedBalance
          status
          isVerified
          verificationLevel
          lifetimeDeposits
          lifetimeWithdrawals
          lastActivityAt
        }
        totalCount
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
      }
    }
  `;

  const data = await graphql(listQuery, {}, TOKENS.admin);
  
  console.log(`  Total Wallets: ${data.wallets.totalCount}`);
  console.log(`  Showing top ${Math.min(data.wallets.nodes.length, 15)} by balance\n`);
  
  console.log('  | User ID              | Currency | Category | Balance        | Status    |');
  console.log('  |----------------------|----------|----------|----------------|-----------|');
  
  for (const wallet of data.wallets.nodes.slice(0, 15)) {
    const userId = wallet.userId.slice(0, 20).padEnd(20);
    const currency = wallet.currency.padEnd(8);
    const category = (wallet.category || 'main').padEnd(8);
    const balance = formatCurrency(wallet.balance + wallet.bonusBalance, wallet.currency).padStart(14);
    const status = wallet.status.padEnd(9);
    
    console.log(`  | ${userId} | ${currency} | ${category} | ${balance} | ${status} |`);
  }

  // Summary statistics
  printSubSection('Platform Statistics');
  
  const stats = {
    totalWallets: data.wallets.totalCount,
    totalBalance: data.wallets.nodes.reduce((sum: number, w: any) => sum + w.balance, 0),
    totalBonusBalance: data.wallets.nodes.reduce((sum: number, w: any) => sum + w.bonusBalance, 0),
    totalLifetimeDeposits: data.wallets.nodes.reduce((sum: number, w: any) => sum + (w.lifetimeDeposits || 0), 0),
    totalLifetimeWithdrawals: data.wallets.nodes.reduce((sum: number, w: any) => sum + (w.lifetimeWithdrawals || 0), 0),
  };

  console.log(`  Platform Totals (EUR equivalent):`);
  console.log(`    Total Real Balance:        ${formatCurrency(stats.totalBalance, 'EUR')}`);
  console.log(`    Total Bonus Balance:       ${formatCurrency(stats.totalBonusBalance, 'EUR')}`);
  console.log(`    Lifetime Deposits:         ${formatCurrency(stats.totalLifetimeDeposits, 'EUR')}`);
  console.log(`    Lifetime Withdrawals:      ${formatCurrency(stats.totalLifetimeWithdrawals, 'EUR')}`);
  console.log(`    Net Position:              ${formatCurrency(stats.totalLifetimeDeposits - stats.totalLifetimeWithdrawals, 'EUR')}`);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN DEMO RUNNER
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   ██████╗  █████╗ ██╗   ██╗███╗   ███╗███████╗███╗   ██╗████████╗             ║
║   ██╔══██╗██╔══██╗╚██╗ ██╔╝████╗ ████║██╔════╝████╗  ██║╚══██╔══╝             ║
║   ██████╔╝███████║ ╚████╔╝ ██╔████╔██║█████╗  ██╔██╗ ██║   ██║                ║
║   ██╔═══╝ ██╔══██║  ╚██╔╝  ██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║                ║
║   ██║     ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗██║ ╚████║   ██║                ║
║   ╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝                ║
║                                                                               ║
║   ██████╗  █████╗ ████████╗███████╗██╗    ██╗ █████╗ ██╗   ██╗                ║
║   ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██║    ██║██╔══██╗╚██╗ ██╔╝                ║
║   ██║  ███╗███████║   ██║   █████╗  ██║ █╗ ██║███████║ ╚████╔╝                 ║
║   ██║   ██║██╔══██║   ██║   ██╔══╝  ██║███╗██║██╔══██║  ╚██╔╝                  ║
║   ╚██████╔╝██║  ██║   ██║   ███████╗╚███╔███╔╝██║  ██║   ██║                   ║
║    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝                   ║
║                                                                               ║
║                        COMPREHENSIVE DEMO                                     ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   This demo covers all payment gateway features:                              ║
║                                                                               ║
║   1. Payment Provider Configuration (Admin)                                   ║
║   2. System User → Wallet Provider Funding                                    ║
║   3. Wallet Provider → End User Funding                                       ║
║   4. End User Operations (Deposits, Bets, Wins, Withdrawals)                  ║
║   5. Reconciliation & Reporting                                               ║
║   6. Webhook Management                                                       ║
║   7. Multi-Currency & Category Wallets                                        ║
║   8. All Wallets Listing (Admin)                                              ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Check if service is running
  console.log('🔍 Checking Payment Gateway...\n');
  try {
    await fetch(PAYMENT_URL.replace('/graphql', '/health'));
    console.log('  ✅ Payment Gateway is running at ' + PAYMENT_URL + '\n');
  } catch {
    console.log('  ❌ Payment Gateway not running at ' + PAYMENT_URL);
    console.log('  \n  Please start the service first:');
    console.log('  cd Examples/payment-gateway && npm start\n');
    process.exit(1);
  }

  // Run all demo sections
  try {
    await configurePaymentProviders();
    await sleep(500);
    
    await systemFundingWalletProvider();
    await sleep(500);
    
    await providerFundingEndUsers();
    await sleep(500);
    
    await endUserOperations();
    await sleep(500);
    
    await reconciliationAndReporting();
    await sleep(500);
    
    await webhookManagement();
    await sleep(500);
    
    await multiCurrencyOperations();
    await sleep(500);
    
    await listAllWallets();
    
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         DEMO COMPLETED SUCCESSFULLY!                          ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  You've seen all the major features of the Payment Gateway:                   ║
║                                                                               ║
║  ✅ Provider configuration (Stripe, PayPal, Bank Transfer, Crypto)            ║
║  ✅ System treasury operations                                                ║
║  ✅ Wallet provider funding flows                                             ║
║  ✅ End user deposits, bets, wins, withdrawals                                ║
║  ✅ Multi-category wallets (main, sports, casino, bonus)                      ║
║  ✅ Multi-currency support (EUR, USD, GBP)                                    ║
║  ✅ Transaction history and reconciliation                                    ║
║  ✅ Webhook management                                                        ║
║  ✅ Admin wallet listing and statistics                                       ║
║                                                                               ║
║  Next steps:                                                                  ║
║  • Run payment-gateway-tests.ts for automated testing                         ║
║  • Try the GraphQL Playground at http://localhost:3004/graphql                ║
║  • Integrate with bonus-service for bonus/wagering flows                      ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
  } catch (err: any) {
    console.error('\n❌ Demo failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
