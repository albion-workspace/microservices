#!/usr/bin/env npx tsx
/**
 * Payment Test Funding - User-to-user transfer test
 * 
 * Naming: payment-test-funding.ts
 * 
 * Flow: payment-gateway user -> payment-provider user
 * 
 * Usage: npx tsx scripts/typescript/payment/payment-test-funding.ts
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
  
  // Ensure admin user has correct permissions before login
  const { getAuthDatabase } = await import('../config/mongodb.js');
  const db = await getAuthDatabase();
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
      // Wait for changes to propagate
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
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

  const token = data.login.tokens.accessToken;
  
  // Wait a bit for token to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Verify token has admin permissions by checking the token payload
  try {
    // Decode JWT token to check roles (without verification, just to see payload)
    const tokenParts = token.split('.');
    if (tokenParts.length === 3) {
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const tokenRoles = payload.roles || [];
      console.log(`\n🔍 Token roles: ${JSON.stringify(tokenRoles)}`);
      
      if (!tokenRoles.includes('admin') && !tokenRoles.includes('system')) {
        console.log('⚠️  Token missing admin/system roles, retrying login...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Retry login to get fresh token with updated roles
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
          throw new Error('Login retry failed - admin user may not have correct permissions');
        }
        
        // Verify new token has roles
        const newTokenParts = retryData.login.tokens.accessToken.split('.');
        if (newTokenParts.length === 3) {
          const newPayload = JSON.parse(Buffer.from(newTokenParts[1], 'base64').toString());
          const newTokenRoles = newPayload.roles || [];
          console.log(`🔍 New token roles: ${JSON.stringify(newTokenRoles)}`);
          
          if (!newTokenRoles.includes('admin') && !newTokenRoles.includes('system')) {
            throw new Error('Token still missing admin/system roles after retry');
          }
        }
        
        return retryData.login.tokens.accessToken;
      }
    }
    
    // Also verify with a GraphQL query
    await graphql<{ users: { nodes: any[] } }>(
      AUTH_SERVICE_URL,
      `query { users(first: 1) { nodes { id } } }`,
      {},
      token
    );
    // If query succeeds, token has admin permissions
    return token;
  } catch (error: any) {
    // Token doesn't have admin permissions, wait longer and retry login
    console.log('⚠️  Token verification failed, waiting and retrying login...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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
      throw new Error('Login retry failed - admin user may not have correct permissions');
    }
    
    return retryData.login.tokens.accessToken;
  }
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

async function fundUserWithDeposit(token: string, fromUserId: string, toUserId: string, amount: number, currency: string) {
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
          amount: amount, // Use exact amount - method field with timestamp makes it unique
          currency: currency,
          tenantId: 'default-tenant',
          fromUserId: fromUserId,
          // Method with timestamp ensures unique externalRef hash (hash includes fromUserId, toUserId, amount, currency, timeWindow)
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
    if (error.stack) {
      console.error(error.stack);
    }
    return false;
  }
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
  
  const { getPaymentDatabase } = await import('../config/mongodb.js');
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
      console.log(`   Most recent: ${tx.type} - ${(tx.amount / 100).toFixed(2)} ${tx.currency}`);
      console.log(`   From: ${tx.fromAccountId}`);
      console.log(`   To: ${tx.toAccountId}`);
    }
  }
}

async function getUserIdsByEmail(token: string) {
  // Try GraphQL first
  try {
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
    
    if (gatewayUser && providerUser) {
      return {
        gatewayUserId: gatewayUser.id,
        providerUserId: providerUser.id,
      };
    }
  } catch (error: any) {
    console.log('⚠️  GraphQL query failed, falling back to MongoDB...');
  }
  
  // Fallback to MongoDB
  const { getAuthDatabase } = await import('../config/mongodb.js');
  const db = await getAuthDatabase();
  const usersCollection = db.collection('users');
  
  const gatewayUser = await usersCollection.findOne({ email: 'payment-gateway@system.com' });
  const providerUser = await usersCollection.findOne({ email: 'payment-provider@system.com' });
  
  if (!gatewayUser || !providerUser) {
    throw new Error('Required users not found. Run payment-setup.ts first.');
  }
  
  return {
    gatewayUserId: gatewayUser.id || gatewayUser._id?.toString(),
    providerUserId: providerUser.id || providerUser._id?.toString(),
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           TEST USER-TO-USER FUNDING                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const { closeAllConnections } = await import('../config/mongodb.js');
  
  try {
    const token = await login();
    
    // Get user IDs by email
    const { gatewayUserId, providerUserId } = await getUserIdsByEmail(token);
    
    // Get admin user ID for funding
    const adminUserQuery = await graphql<{ users: { nodes: any[] } }>(
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
    const adminUser = adminUserQuery.users.nodes.find((u: any) => u.email === ADMIN_EMAIL);
    const adminUserIdValue = adminUser?.id;
    
    if (!adminUserIdValue) {
      throw new Error('Admin user not found');
    }
    
    // First, fund the gateway user using admin as source (admin has allowNegative permission)
    console.log('\n📥 Step 1: Funding gateway user...');
    const fundingAmount = 2000000; // €20,000 (enough for transfer + fees)
    const funded = await fundUserWithDeposit(token, adminUserIdValue, gatewayUserId, fundingAmount, 'EUR');
    
    if (!funded) {
      throw new Error('Failed to fund gateway user');
    }
    
    // Wait a bit for ledger sync
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test: Transfer from payment-gateway user to payment-provider user
    console.log('\n📤 Step 2: Transferring from gateway to provider...');
    await fundUser(token, gatewayUserId, providerUserId, 1000000, 'EUR'); // €10,000
    
    await checkLedgerTransactions();
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    // Always close connections, even on error or cancellation
    try {
      await closeAllConnections();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }
    // Exit explicitly to ensure process terminates
    process.exit(process.exitCode || 0);
  }
}

// Handle process termination signals to ensure cleanup
process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, cleaning up...');
  const { closeAllConnections } = await import('../config/mongodb.js');
  await closeAllConnections().catch(() => {});
  process.exit(130); // Exit code 130 for SIGINT
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, cleaning up...');
  const { closeAllConnections } = await import('../config/mongodb.js');
  await closeAllConnections().catch(() => {});
  process.exit(143); // Exit code 143 for SIGTERM
});

main();
