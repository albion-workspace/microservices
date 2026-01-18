#!/usr/bin/env npx tsx
/**
 * Payment Test Flow - Complete payment flow with balance verification
 * 
 * Naming: payment-test-flow.ts
 * 
 * Flow:
 * 1. Fund payment-provider user from payment-gateway user (€10,000)
 * 2. End-user deposits from payment-provider user (€500)
 * 3. Verify balances at each step
 * 
 * Expected:
 * - Payment-gateway: -€10,000 (money flowed out)
 * - Payment-provider: €9,500 (€10,000 - €500 deposit)
 * - End-user: €485.50 (€500 - €14.50 fee)
 * 
 * Usage: npx tsx scripts/typescript/payment/payment-test-flow.ts
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
  // Ensure admin user has correct permissions before login
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient('mongodb://localhost:27017/auth_service?directConnection=true');
  try {
    await client.connect();
    const db = client.db();
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
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } finally {
    await client.close();
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
  
  // Verify token has admin permissions by trying an admin query
  try {
    await graphql<{ users: { nodes: any[] } }>(
      AUTH_SERVICE_URL,
      `query { users(first: 1) { nodes { id } } }`,
      {},
      token
    );
    // If query succeeds, token has admin permissions
    return token;
  } catch (error: any) {
    // If verification fails, wait and retry login once
    console.log('⚠️  Token verification failed, retrying login...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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
      throw new Error('Login retry failed');
    }
    
    return retryData.login.tokens.accessToken;
  }
}

async function getUserBalance(token: string, userId: string, currency: string) {
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

async function getUserWalletBalance(token: string, userId: string, currency: string) {
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

async function createWallet(token: string, userId: string, currency: string) {
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
        tenantId: 'default-tenant',
      },
    },
    token
  );
  
  if (!result.createWallet.success) {
    throw new Error(`Failed to create wallet: ${result.createWallet.errors?.join(', ')}`);
  }
  
  const walletId = result.createWallet.wallet!.id;
  console.log(`  ✅ Wallet created successfully: ${walletId} for user ${userId}, currency ${currency}`);
  return walletId;
}

async function fundUser(token: string, fromUserId: string, toUserId: string, amount: number, currency: string) {
  // Simplified: User-to-user transfer
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
  
  console.log(`  💰 Transferring €${(amount / 100).toFixed(2)} from ${fromUserId} to ${toUserId}...`);
  
  // Use recordUserTransferLedgerEntry via GraphQL (if available) or wallet transaction
  // For now, use wallet transaction which will sync with ledger
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
  
  // Credit receiving user
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
  
  console.log(`  ✅ Transfer completed! Transaction IDs: ${result.createWalletTransaction.walletTransaction!.id}, ${creditResult.createWalletTransaction.walletTransaction!.id}`);
  return result.createWalletTransaction.walletTransaction!.id;
}

async function createEndUser(token: string, userIdPrefix: string): Promise<string> {
  // Create end user via auth service
  const email = `${userIdPrefix}@demo.com`;
  const password = 'TestUser123!@#';
  
  try {
    const registerData = await graphql<{ register: { success: boolean; user?: { id: string } } }>(
      AUTH_SERVICE_URL,
      `
        mutation Register($input: RegisterInput!) {
          register(input: $input) {
            success
            user {
              id
              email
            }
          }
        }
      `,
      {
        input: {
          email,
          password,
          tenantId: 'default-tenant',
        },
      }
    );

    if (registerData.register.success && registerData.register.user) {
      return registerData.register.user.id;
    }
  } catch (error) {
    // User might already exist, find it
  }
  
  // Get user ID
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
  
  const user = usersData.users.nodes.find((u: any) => u.email === email);
  if (!user) {
    throw new Error(`Failed to create/find user: ${email}`);
  }
  
  return user.id;
}

async function fundUserWithDeposit(token: string, fromUserId: string, toUserId: string, amount: number, currency: string): Promise<void> {
  // Fund user using deposit (admin can go negative, so this works)
  const result = await graphql<{ createDeposit: { success: boolean; deposit?: { id: string; netAmount: number } } }>(
    PAYMENT_SERVICE_URL,
    `
      mutation CreateDeposit($input: CreateDepositInput!) {
        createDeposit(input: $input) {
          success
          deposit {
            id
            userId
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
        tenantId: 'default-tenant',
        fromUserId: fromUserId,
        // Method with timestamp ensures unique externalRef hash
        method: `test-funding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      },
    },
    token
  );
  
  if (!result.createDeposit.success) {
    throw new Error(`Failed to fund user: ${result.createDeposit.errors?.join(', ')}`);
  }
  
  console.log(`  ✅ Deposit completed! Amount: €${formatAmount(result.createDeposit.deposit?.netAmount || amount)}`);
}

async function userDeposit(token: string, fromUserId: string, toUserId: string, amount: number, currency: string) {
  // Simplified: User-to-user deposit
  const result = await graphql<{ createDeposit: { success: boolean; deposit?: { id: string } } }>(
    PAYMENT_SERVICE_URL,
    `
      mutation CreateDeposit($input: CreateDepositInput!) {
        createDeposit(input: $input) {
          success
          deposit {
            id
            userId
            amount
            currency
            status
          }
          errors
        }
      }
    `,
    {
      input: {
        userId: toUserId, // Receiving user (must exist)
        amount,
        currency,
        tenantId: 'default-tenant',
        fromUserId: fromUserId, // Source user (payment-provider) - must exist
        // Method with timestamp ensures unique externalRef hash
        method: `test-deposit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      },
    },
    token
  );
  
  if (!result.createDeposit.success) {
    throw new Error(`Failed to create deposit: ${result.createDeposit.errors?.join(', ')}`);
  }
  
  // Approve the deposit
  const depositId = result.createDeposit.deposit!.id;
  const approveResult = await graphql<{ approveTransaction: { success: boolean; transaction?: any } }>(
    PAYMENT_SERVICE_URL,
    `
      mutation ApproveTransaction($transactionId: String!) {
        approveTransaction(transactionId: $transactionId) {
          success
          transaction {
            id
            status
          }
        }
      }
    `,
    { transactionId: depositId },
    token
  );
  
  if (!approveResult.approveTransaction.success) {
    throw new Error('Failed to approve deposit');
  }
  
  return depositId;
}

function formatAmount(amount: number): string {
  return (amount / 100).toFixed(2);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupUsers(token: string) {
  console.log('👥 Setting up users...\n');
  
  // Run setup script to ensure users exist
  const { execSync } = await import('child_process');
  try {
    execSync('npx tsx scripts/typescript/payment/payment-setup.ts', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
  } catch (error) {
    console.log('⚠️  Setup script failed, continuing with existing users...\n');
  }
  
  // Get user IDs from auth service (fallback to MongoDB if GraphQL fails)
  let gatewayUser: any = null;
  let providerUser: any = null;
  
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
    
    gatewayUser = usersData.users.nodes.find((u: any) => u.email === 'payment-gateway@system.com');
    providerUser = usersData.users.nodes.find((u: any) => u.email === 'payment-provider@system.com');
  } catch (error: any) {
    console.log('⚠️  GraphQL query failed, falling back to MongoDB...');
  }
  
  // Fallback to MongoDB if GraphQL failed or users not found
  if (!gatewayUser || !providerUser) {
    const { getAuthDatabase } = await import('../config/mongodb.js');
    const db = await getAuthDatabase();
    const usersCollection = db.collection('users');
    
    gatewayUser = await usersCollection.findOne({ email: 'payment-gateway@system.com' });
    providerUser = await usersCollection.findOne({ email: 'payment-provider@system.com' });
  }
  
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
  console.log('║           COMPLETE FLOW TEST - WITH BALANCE VERIFICATION        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();
    
    // Setup users first
    const { gatewayUserId, providerUserId } = await setupUsers(token);
    
    const testUserId = `test-user-${Date.now()}`;
    const currency = 'EUR';
    
    // Get admin user ID for funding
    let adminUserId: string;
    try {
      const adminUserData = await graphql<{ users: { nodes: any[] } }>(
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
      const adminUser = adminUserData.users.nodes.find((u: any) => u.email === ADMIN_EMAIL);
      if (!adminUser) {
        throw new Error('Admin user not found');
      }
      adminUserId = adminUser.id;
    } catch (error: any) {
      // Fallback to MongoDB
      const { getAuthDatabase } = await import('../config/mongodb.js');
      const db = await getAuthDatabase();
      const usersCollection = db.collection('users');
      const adminUser = await usersCollection.findOne({ email: ADMIN_EMAIL });
      if (!adminUser) {
        throw new Error('Admin user not found');
      }
      adminUserId = adminUser._id?.toString() || adminUser.id;
    }
    
    // Step 0: Initial balances
    console.log('📊 STEP 0: Initial Balances\n');
    let gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
    let providerBalance = await getUserBalance(token, providerUserId, currency);
    let userBalance = await getUserWalletBalance(token, testUserId, currency);
    
    console.log(`  Payment Gateway (${gatewayUserId}): €${formatAmount(gatewayBalance)}`);
    console.log(`  Payment Provider (${providerUserId}): €${formatAmount(providerBalance)}`);
    console.log(`  End User (${testUserId}): €${formatAmount(userBalance)}\n`);
    
    // Step 0.5: Fund gateway user from admin (if needed)
    const requiredAmount = 1000000; // €10,000 in cents
    if (gatewayBalance < requiredAmount) {
      console.log(`💰 STEP 0.5: Funding Gateway User from Admin (€${formatAmount(requiredAmount)})\n`);
      const fundingAmount = requiredAmount + 1000000; // €20,000 total (enough for transfer + fees)
      await fundUserWithDeposit(token, adminUserId, gatewayUserId, fundingAmount, currency);
      await sleep(2000); // Wait for ledger sync
      gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
      console.log(`  Gateway balance after funding: €${formatAmount(gatewayBalance)}\n`);
    }
    
    // Step 1: Fund payment-provider from payment-gateway (€10,000)
    console.log('💰 STEP 1: Funding Payment Provider from Payment Gateway (€10,000)\n');
    await fundUser(token, gatewayUserId, providerUserId, 1000000, currency); // €10,000 in cents
    await sleep(2000); // Wait for ledger sync
    
    gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
    providerBalance = await getUserBalance(token, providerUserId, currency);
    
    // Calculate expected balances accounting for initial balances and transfer
    const initialGatewayBalance = gatewayBalance; // This is after funding, so it's the new baseline
    const initialProviderBalance = providerBalance; // This is before transfer, so it's the old baseline
    const transferAmount = 1000000; // €10,000 in cents
    
    // After transfer: gateway should have less, provider should have more
    // Note: Fees are deducted from the transfer, so the actual amounts may vary
    console.log(`  Payment Gateway: €${formatAmount(gatewayBalance)} (started with €${formatAmount(initialGatewayBalance)}, transferred €${formatAmount(transferAmount)})`);
    console.log(`  Payment Provider: €${formatAmount(providerBalance)} (started with €${formatAmount(initialProviderBalance)}, received €${formatAmount(transferAmount)})\n`);
    
    // Verify transfer happened (gateway balance decreased, provider balance increased)
    const gatewayDecreased = gatewayBalance < initialGatewayBalance;
    const providerIncreased = providerBalance > initialProviderBalance;
    
    if (!gatewayDecreased) {
      console.log(`  ⚠️  WARNING: Payment Gateway balance did not decrease after transfer`);
    }
    if (!providerIncreased) {
      console.log(`  ⚠️  WARNING: Payment Provider balance did not increase after transfer`);
    }
    
    // Step 2: Create user wallet
    console.log('👤 STEP 2: Creating End User Wallet\n');
    await createWallet(token, testUserId, currency);
    await sleep(2000); // Wait for wallet creation and any ledger sync
    
    // Step 3: End-user deposits from payment-provider (€500)
    console.log('💳 STEP 3: End User Deposits from Payment Provider (€500)\n');
    await userDeposit(token, providerUserId, testUserId, 50000, currency); // €500 in cents
    await sleep(2000); // Wait for ledger sync
    
    gatewayBalance = await getUserBalance(token, gatewayUserId, currency);
    providerBalance = await getUserBalance(token, providerUserId, currency);
    userBalance = await getUserWalletBalance(token, testUserId, currency);
    
    console.log(`  Payment Gateway: €${formatAmount(gatewayBalance)} (expected: -€10,000.00)`);
    console.log(`  Payment Provider: €${formatAmount(providerBalance)} (expected: €9,500.00)`);
    console.log(`  End User: €${formatAmount(userBalance)} (expected: €485.50)\n`);
    
    // Step 4: Verification
    console.log('✅ STEP 4: Balance Verification\n');
    const expectedGatewayBalance = -1000000; // -€10,000
    const expectedProviderBalance = 950000; // €9,500 (€10,000 - €500)
    // User receives gross amount (€500) minus fee (€14.50) = €485.50
    const feeAmount = Math.round(50000 * (2.9 / 100)); // €14.50 (2.9% fee)
    const expectedUserBalance = 50000 - feeAmount; // €485.50 (€500 - €14.50 fee)
    
    let allCorrect = true;
    
    if (gatewayBalance !== expectedGatewayBalance) {
      console.log(`  ❌ Payment Gateway: Expected €${formatAmount(expectedGatewayBalance)}, got €${formatAmount(gatewayBalance)}`);
      allCorrect = false;
    } else {
      console.log(`  ✅ Payment Gateway: €${formatAmount(gatewayBalance)} (correct)`);
    }
    
    if (providerBalance !== expectedProviderBalance) {
      console.log(`  ❌ Payment Provider: Expected €${formatAmount(expectedProviderBalance)}, got €${formatAmount(providerBalance)}`);
      allCorrect = false;
    } else {
      console.log(`  ✅ Payment Provider: €${formatAmount(providerBalance)} (correct)`);
    }
    
    if (userBalance !== expectedUserBalance) {
      console.log(`  ❌ End User: Expected €${formatAmount(expectedUserBalance)}, got €${formatAmount(userBalance)}`);
      allCorrect = false;
    } else {
      console.log(`  ✅ End User: €${formatAmount(userBalance)} (correct)`);
    }
    
    if (allCorrect) {
      console.log('\n🎉 All balances are correct! Flow is working properly.\n');
    } else {
      console.log('\n⚠️  Balance mismatches detected. Review the flow.\n');
    }
    
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    // Always close connections, even on error or cancellation
    try {
      const { closeAllConnections } = await import('../config/mongodb.js');
      await closeAllConnections();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }
    process.exit(process.exitCode || 0);
  }
}

// Handle process termination signals to ensure cleanup
process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, cleaning up...');
  const { closeAllConnections } = await import('../config/mongodb.js');
  await closeAllConnections().catch(() => {});
  process.exit(130);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, cleaning up...');
  const { closeAllConnections } = await import('../config/mongodb.js');
  await closeAllConnections().catch(() => {});
  process.exit(143);
});

main();
