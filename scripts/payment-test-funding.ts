#!/usr/bin/env npx tsx
/**
 * Payment Test Funding - User-to-user transfer test
 * 
 * Naming: payment-test-funding.ts
 * 
 * Flow: payment-gateway user -> payment-provider user
 * 
 * Usage: npx tsx scripts/payment-test-funding.ts
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

async function fundUser(token: string, fromUserId: string, toUserId: string, amount: number, currency: string) {
  console.log(`\n💰 Transferring ${(amount / 100).toFixed(2)} ${currency} from ${fromUserId} to ${toUserId}...`);
  
  try {
    // Find wallets
    const fromWalletId = await findWallet(token, fromUserId, currency);
    const toWalletId = await findWallet(token, toUserId, currency);
    
    // Create user-to-user transfer via wallet transaction
    // The wallet service will handle the ledger entry
    const result = await graphql<{ createWalletTransaction: any }>(
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
              description
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
          amount: amount,
          currency: currency,
          balanceType: 'real',
          description: `Transfer to ${toUserId}`,
          refType: 'transfer',
          refId: `transfer-${Date.now()}`,
        },
      },
      token
    );

    // Also credit the receiving user
    const creditResult = await graphql<{ createWalletTransaction: any }>(
      PAYMENT_SERVICE_URL,
      `
        mutation ReceiveFunds($input: CreateWalletTransactionInput!) {
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
          walletId: toWalletId,
          userId: toUserId,
          type: 'transfer_in',
          amount: amount,
          currency: currency,
          balanceType: 'real',
          description: `Transfer from ${fromUserId}`,
          refType: 'transfer',
          refId: `transfer-${Date.now()}`,
        },
      },
      token
    );

    console.log('✅ Transfer result:', JSON.stringify(result, null, 2));
    
    if (result.createWalletTransaction.success && creditResult.createWalletTransaction.success) {
      console.log('✅ Transfer completed successfully!');
      console.log(`   From: ${fromUserId} - Transaction ID: ${result.createWalletTransaction.walletTransaction?.id}`);
      console.log(`   To: ${toUserId} - Transaction ID: ${creditResult.createWalletTransaction.walletTransaction?.id}`);
    } else {
      console.log('❌ Transfer failed:', result.createWalletTransaction.errors || creditResult.createWalletTransaction.errors);
    }
  } catch (error: any) {
    console.error('❌ Error transferring funds:', error.message);
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

async function getUserIdsByEmail(token: string) {
  const usersData = await graphql<{ users: { nodes: any[] } }>(
    AUTH_SERVICE_URL,
    `
      query GetUsers($first: Int) {
        users(first: $first) {
          nodes {
            id
            email
          }
        }
      }
    `,
    { first: 100 },
    token
  );
  
  const gatewayUser = usersData.users.nodes.find((u: any) => u.email === 'payment-gateway@system.com');
  const providerUser = usersData.users.nodes.find((u: any) => u.email === 'payment-provider@system.com');
  
  if (!gatewayUser || !providerUser) {
    throw new Error('Required users not found. Run payment-setup.ts first.');
  }
  
  return {
    gatewayUserId: gatewayUser.id,
    providerUserId: providerUser.id,
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           TEST USER-TO-USER FUNDING                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();
    
    // Get user IDs by email
    const { gatewayUserId, providerUserId } = await getUserIdsByEmail(token);
    
    // Test: Transfer from payment-gateway user to payment-provider user
    await fundUser(token, gatewayUserId, providerUserId, 1000000, 'EUR'); // €10,000
    
    await checkLedgerTransactions();
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();
