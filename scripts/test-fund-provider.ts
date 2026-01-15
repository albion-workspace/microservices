/**
 * Test Provider Funding - Direct API Call
 * This will help us see the exact error when funding a provider
 */

const PAYMENT_SERVICE_URL = 'http://localhost:3004/graphql';
const AUTH_SERVICE_URL = 'http://localhost:3003/graphql';

const ADMIN_EMAIL = 'admin@demo.com';
const ADMIN_PASSWORD = 'Admin123!@#';

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

async function findWallet(token: string, userId: string, currency: string) {
  console.log(`\n🔍 Finding wallet for ${userId} (${currency})...`);
  
  const data = await graphql<{ wallets: { nodes: any[] } }>(
    PAYMENT_SERVICE_URL,
    `
      query FindWallet($first: Int) {
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

  const wallet = data.wallets.nodes.find(
    (w: any) => w.userId === userId && w.currency === currency
  );

  if (!wallet) {
    throw new Error(`Wallet not found for ${userId} (${currency})`);
  }

  console.log(`   Found wallet: ${wallet.id} (balance: ${(wallet.balance / 100).toFixed(2)} ${currency})`);
  return wallet.id;
}

async function fundProvider(token: string) {
  console.log('\n💰 Funding provider-stripe with 10,000 EUR...');
  
  try {
    // First find the wallet
    const walletId = await findWallet(token, 'provider-stripe', 'EUR');
    
    const result = await graphql<{ createWalletTransaction: any }>(
      PAYMENT_SERVICE_URL,
      `
        mutation FundProvider($input: CreateWalletTransactionInput!) {
          createWalletTransaction(input: $input) {
            success
            walletTransaction {
              id
              userId
              type
              amount
              currency
              balance
              description
            }
            errors
          }
        }
      `,
      {
        input: {
          walletId: walletId,
          userId: 'provider-stripe',
          type: 'deposit',
          amount: 1000000, // 10,000.00 EUR in cents
          currency: 'EUR',
          balanceType: 'real',
          description: 'Test funding from script',
        },
      },
      token
    );

    console.log('✅ Funding result:', JSON.stringify(result, null, 2));
    
    if (result.createWalletTransaction.success) {
      console.log('✅ Provider funded successfully!');
      console.log(`   Transaction ID: ${result.createWalletTransaction.walletTransaction?.id}`);
      console.log(`   Balance: ${(result.createWalletTransaction.walletTransaction?.balance / 100).toFixed(2)} EUR`);
    } else {
      console.log('❌ Funding failed:', result.createWalletTransaction.errors);
    }
  } catch (error: any) {
    console.error('❌ Error funding provider:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

async function checkLedgerTransactions() {
  console.log('\n🔍 Checking for ledger transactions...');
  
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient('mongodb://localhost:27017/payment_service?directConnection=true');
  
  try {
    await client.connect();
    const db = client.db();
    
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
        console.log(`   Most recent: ${tx.type} - ${(tx.amount / 100).toFixed(2)} ${tx.currency}`);
        console.log(`   From: ${tx.fromAccountId}`);
        console.log(`   To: ${tx.toAccountId}`);
      }
    }
  } finally {
    await client.close();
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           TEST PROVIDER FUNDING                                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();
    await fundProvider(token);
    await checkLedgerTransactions();
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();
