/**
 * Test Payment Service API
 * Tests wallet balances, transactions, and ledger integration
 */

import { MongoClient } from 'mongodb';

const PAYMENT_SERVICE_URL = 'http://localhost:3004/graphql';
const AUTH_SERVICE_URL = 'http://localhost:3003/graphql';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

// Test credentials
const ADMIN_EMAIL = 'admin@demo.com';
const ADMIN_PASSWORD = 'Admin123!@#';

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string; locations?: any[]; path?: string[] }>;
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

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors) {
    const errorMessage = result.errors.map(e => e.message).join('; ');
    throw new Error(`GraphQL Error: ${errorMessage}`);
  }

  return result.data as T;
}

async function login(): Promise<string> {
  console.log('🔐 Logging in as admin@demo.com...');
  
  const data = await graphql<{ login: { success: boolean; tokens?: { accessToken: string }; user?: any } }>(
    AUTH_SERVICE_URL,
    `
      mutation Login($input: LoginInput!) {
        login(input: $input) {
          success
          message
          tokens {
            accessToken
            refreshToken
          }
          user {
            id
            email
            roles
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
    throw new Error(`Login failed: ${data.login.message || 'Unknown error'}`);
  }

  console.log(`✅ Logged in as ${data.login.user?.email} (roles: ${data.login.user?.roles?.join(', ')})`);
  return data.login.tokens.accessToken;
}

async function testWallets(token: string) {
  console.log('\n📊 Testing Wallets Query...');
  
  const data = await graphql<{ wallets: { nodes: any[]; totalCount: number } }>(
    PAYMENT_SERVICE_URL,
    `
      query GetWallets($first: Int) {
        wallets(first: $first) {
          nodes {
            id
            userId
            currency
            category
            balance
            bonusBalance
            lockedBalance
            status
            lastActivityAt
          }
          totalCount
        }
      }
    `,
    { first: 100 },
    token
  );

  console.log(`Found ${data.wallets.totalCount} wallets:`);
  
  const systemWallet = data.wallets.nodes.find(w => w.userId === 'system');
  const providerWallets = data.wallets.nodes.filter(w => w.userId?.startsWith('provider-'));
  const userWallets = data.wallets.nodes.filter(w => !w.userId?.startsWith('provider-') && w.userId !== 'system');

  console.log(`\n  System Wallet: ${systemWallet ? `Balance: ${(systemWallet.balance / 100).toFixed(2)} ${systemWallet.currency}` : 'NOT FOUND'}`);
  console.log(`  Provider Wallets: ${providerWallets.length}`);
  providerWallets.forEach(w => {
    console.log(`    - ${w.userId}: ${(w.balance / 100).toFixed(2)} ${w.currency} (status: ${w.status})`);
  });
  console.log(`  User Wallets: ${userWallets.length}`);
  if (userWallets.length > 0) {
    userWallets.slice(0, 5).forEach(w => {
      console.log(`    - ${w.userId}: ${(w.balance / 100).toFixed(2)} ${w.currency}`);
    });
    if (userWallets.length > 5) {
      console.log(`    ... and ${userWallets.length - 5} more`);
    }
  }

  return { systemWallet, providerWallets, userWallets };
}

async function testProviderLedgerBalances(token: string) {
  console.log('\n💰 Testing Provider Ledger Balances...');
  
  const providers = ['provider-stripe', 'provider-paypal', 'provider-bank', 'provider-crypto'];
  const balances: Record<string, number> = {};

  for (const providerId of providers) {
    try {
      const data = await graphql<{ providerLedgerBalance: { balance: number; availableBalance: number } }>(
        PAYMENT_SERVICE_URL,
        `
          query GetProviderLedgerBalance($providerId: String!, $subtype: String!, $currency: String!) {
            providerLedgerBalance(providerId: $providerId, subtype: $subtype, currency: $currency) {
              accountId
              providerId
              balance
              availableBalance
            }
          }
        `,
        {
          providerId,
          subtype: 'deposit',
          currency: 'EUR',
        },
        token
      );

      balances[providerId] = data.providerLedgerBalance.balance;
      console.log(`  ✅ ${providerId}: ${(data.providerLedgerBalance.balance / 100).toFixed(2)} EUR`);
    } catch (error: any) {
      console.log(`  ⚠️  ${providerId}: ${error.message}`);
      balances[providerId] = 0;
    }
  }

  return balances;
}

async function testTransactions(token: string) {
  console.log('\n📝 Testing Transactions Query (checking ordering)...');
  
  const data = await graphql<{ walletTransactions: { nodes: any[]; totalCount: number } }>(
    PAYMENT_SERVICE_URL,
    `
      query GetWalletTransactions($first: Int, $skip: Int) {
        walletTransactions(first: $first, skip: $skip) {
          nodes {
            id
            userId
            type
            amount
            currency
            balance
            description
            createdAt
          }
          totalCount
        }
      }
    `,
    { first: 10, skip: 0 },
    token
  );

  console.log(`Found ${data.walletTransactions.totalCount} total transactions`);
  console.log(`Showing first ${data.walletTransactions.nodes.length} transactions:`);
  
  // Check if they're ordered by createdAt descending (newest first)
  const dates = data.walletTransactions.nodes
    .map(tx => tx.createdAt ? new Date(tx.createdAt).getTime() : 0)
    .filter(d => d > 0);
  const isOrdered = dates.length > 0 && dates.every((date, i) => i === 0 || dates[i - 1] >= date);
  
  console.log(`\n  Ordering check: ${isOrdered ? '✅ Correctly ordered (newest first)' : '❌ NOT ordered correctly'}`);
  
  data.walletTransactions.nodes.forEach((tx, i) => {
    const date = tx.createdAt ? new Date(tx.createdAt).toISOString() : 'N/A';
    console.log(`  ${i + 1}. [${tx.type}] ${tx.userId}: ${(tx.amount / 100).toFixed(2)} ${tx.currency} - ${date}`);
  });

  return data.walletTransactions.nodes;
}

async function testDeposits(token: string) {
  console.log('\n💳 Testing Deposits Query...');
  
  const data = await graphql<{ deposits: { nodes: any[]; totalCount: number } }>(
    PAYMENT_SERVICE_URL,
    `
      query GetDeposits($first: Int, $skip: Int) {
        deposits(first: $first, skip: $skip) {
          nodes {
            id
            userId
            type
            status
            amount
            currency
            createdAt
          }
          totalCount
        }
      }
    `,
    { first: 5, skip: 0 },
    token
  );

  console.log(`Found ${data.deposits.totalCount} total deposits`);
  console.log(`Showing first ${data.deposits.nodes.length} deposits:`);
  
  data.deposits.nodes.forEach((deposit, i) => {
    const date = deposit.createdAt ? new Date(deposit.createdAt).toISOString() : 'N/A';
    console.log(`  ${i + 1}. [${deposit.status}] ${deposit.userId}: ${(deposit.amount / 100).toFixed(2)} ${deposit.currency} - ${date}`);
  });

  return data.deposits.nodes;
}

async function checkMongoBalances() {
  console.log('\n🔍 Checking MongoDB Wallet Balances Directly...');
  
  const client = new MongoClient(MONGO_URI, { directConnection: true });
  
  try {
    await client.connect();
    const db = client.db();
    const wallets = await db.collection('wallets').find({}).limit(10).toArray();
    
    console.log(`Found ${wallets.length} wallets in MongoDB:`);
    wallets.forEach(w => {
      console.log(`  - ${w.userId}: balance=${w.balance} (${(w.balance / 100).toFixed(2)}), currency=${w.currency}`);
    });
    
    // Check ledger accounts
    console.log('\n🔍 Checking Ledger Accounts...');
    const ledgerAccounts = await db.collection('ledger_accounts').find({}).limit(20).toArray();
    console.log(`Found ${ledgerAccounts.length} ledger accounts:`);
    
    // Group by type
    const systemAccounts = ledgerAccounts.filter(a => a.type === 'system');
    const providerAccounts = ledgerAccounts.filter(a => a.type === 'provider');
    const userAccounts = ledgerAccounts.filter(a => a.type === 'user');
    
    console.log(`  System Accounts (${systemAccounts.length}):`);
    systemAccounts.forEach(acc => {
      console.log(`    - ${acc._id}: balance=${acc.balance} (${(acc.balance / 100).toFixed(2)}), subtype=${acc.subtype}, currency=${acc.currency}`);
    });
    
    console.log(`  Provider Accounts (${providerAccounts.length}):`);
    providerAccounts.forEach(acc => {
      console.log(`    - ${acc._id}: balance=${acc.balance} (${(acc.balance / 100).toFixed(2)}), subtype=${acc.subtype}, currency=${acc.currency}`);
    });
    
    console.log(`  User Accounts (${userAccounts.length}):`);
    userAccounts.slice(0, 5).forEach(acc => {
      console.log(`    - ${acc._id}: balance=${acc.balance} (${(acc.balance / 100).toFixed(2)}), subtype=${acc.subtype}`);
    });
    if (userAccounts.length > 5) {
      console.log(`    ... and ${userAccounts.length - 5} more`);
    }
    
    // Check recent ledger transactions
    console.log('\n🔍 Checking Recent Ledger Transactions...');
    const ledgerTxs = await db.collection('ledger_transactions')
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    console.log(`Found ${ledgerTxs.length} recent ledger transactions:`);
    ledgerTxs.forEach(tx => {
      const date = tx.createdAt ? new Date(tx.createdAt).toISOString() : 'N/A';
      console.log(`  - [${tx.type}] ${tx.fromAccountId} -> ${tx.toAccountId}: ${(tx.amount / 100).toFixed(2)} ${tx.currency} - ${date}`);
    });
    
  } finally {
    await client.close();
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           PAYMENT SERVICE API TEST (admin@demo.com)              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    // Login
    const token = await login();

    // Test wallets
    const wallets = await testWallets(token);

    // Test provider ledger balances
    const ledgerBalances = await testProviderLedgerBalances(token);

    // Test transactions
    const transactions = await testTransactions(token);

    // Test deposits
    const deposits = await testDeposits(token);

    // Check MongoDB directly
    await checkMongoBalances();

    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         TEST SUMMARY                                ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    console.log(`\n✅ System Wallet: ${wallets.systemWallet ? 'Found' : 'NOT FOUND'}`);
    console.log(`✅ Provider Wallets: ${wallets.providerWallets.length} found`);
    console.log(`✅ User Wallets: ${wallets.userWallets.length} found`);
    console.log(`✅ Transactions: ${transactions.length} retrieved`);
    console.log(`✅ Deposits: ${deposits.length} retrieved`);
    
    // Check for zero balances
    const zeroBalanceProviders = wallets.providerWallets.filter(w => w.balance === 0);
    if (zeroBalanceProviders.length > 0) {
      console.log(`\n⚠️  WARNING: ${zeroBalanceProviders.length} provider wallets have zero balance:`);
      zeroBalanceProviders.forEach(w => {
        console.log(`    - ${w.userId}`);
      });
    }

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
