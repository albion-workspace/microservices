#!/usr/bin/env npx tsx
/**
 * Bonus Setup - Create users with proper roles/permissions for bonus testing
 * 
 * Naming: bonus-setup.ts
 * 
 * Creates:
 * - admin@demo.com: System user with bonus permissions
 * - bonus-admin@system.com: Bonus admin user (can manage bonuses)
 * - test-bonus-user@demo.com: Test user for bonus operations
 * 
 * Usage: npx tsx scripts/typescript/bonus/bonus-setup.ts
 */

const AUTH_SERVICE_URL = 'http://localhost:3003/graphql';
const BONUS_SERVICE_URL = 'http://localhost:3005/graphql';

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
  console.log('🔐 Logging in as admin...');
  
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

async function createUser(token: string, email: string, password: string, roles: string[], permissions: Record<string, boolean>) {
  console.log(`\n👤 Creating user: ${email}...`);
  
  try {
    // First try to find existing user
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

    let userId: string | undefined;
    const existingUser = usersData.users.nodes.find((u: any) => u.email === email);
    
    if (existingUser) {
      userId = existingUser.id;
      console.log(`  ⚠️  User already exists: ${userId}`);
    } else {
      // Try to register
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
          userId = registerData.register.user.id;
          console.log(`  ✅ User registered: ${userId}`);
        } else {
          throw new Error('Registration failed');
        }
      } catch (registerError: any) {
        // Registration might fail if user exists, try to find again
        const usersData2 = await graphql<{ users: { nodes: any[] } }>(
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

        const existingUser2 = usersData2.users.nodes.find((u: any) => u.email === email);
        if (!existingUser2) {
          throw new Error(`Failed to create user: ${registerError.message}`);
        }
        userId = existingUser2.id;
        console.log(`  ⚠️  User found after registration attempt: ${userId}`);
      }
    }
    
    if (!userId) {
      throw new Error(`Failed to get user ID for ${email}`);
    }

    // Update roles and permissions using promote-user script logic
    const { getAuthDatabase, getPaymentDatabase } = await import('../config/mongodb.js');
    const db = await getAuthDatabase();
    const usersCollection = db.collection('users');
      
      // Convert permissions object to array format (GraphQL expects array)
      const permissionsArray = Object.keys(permissions).filter(key => permissions[key] === true);
      
      // Convert roles to UserRole[] format (array of objects with role, assignedAt, active)
      const rolesArray = roles.map(role => ({
        role,
        assignedAt: new Date(),
        active: true,
      }));
      
      await usersCollection.updateOne(
        { id: userId },
        {
          $set: {
            roles: rolesArray,
            permissions: permissionsArray.length > 0 ? permissionsArray : [],
            updatedAt: new Date(),
          },
        }
      );

      // Update ledger accounts if allowNegative permission is set
      if (permissions.allowNegative) {
        const paymentDb = await getPaymentDatabase();
        const ledgerAccounts = paymentDb.collection('ledger_accounts');
        
        await ledgerAccounts.updateMany(
          { ownerId: userId, type: 'user' },
          { $set: { allowNegative: true } }
        );
        console.log(`  ✅ Updated ledger accounts to allow negative balance`);
      }

      console.log(`  ✅ User configured:`);
      console.log(`     Roles: ${roles.join(', ')}`);
      console.log(`     Permissions: ${permissionsArray.join(', ')}`);
      
      return userId;
  } catch (error: any) {
    console.error(`  ❌ Failed to create user ${email}:`, error.message);
    throw error;
  }
}

async function fundBonusPool(amount: number, currency: string = 'USD') {
  console.log(`\n💰 Funding bonus pool with ${amount} ${currency}...`);
  
  try {
    // Use payment-service GraphQL API to transfer funds to bonus-pool account
    // This requires payment-gateway user to have funds
    const PAYMENT_SERVICE_URL = 'http://localhost:3004/graphql';
    
    // First, login to get token
    const loginToken = await login();
    
    // Find payment-gateway user
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
      loginToken
    );
    
    const gatewayUser = usersData.users.nodes.find((u: any) => u.email === 'payment-gateway@system.com');
    
    if (!gatewayUser) {
      console.log(`  ⚠️  Payment gateway user not found, skipping bonus pool funding`);
      console.log(`     Run payment-setup.ts first to create payment gateway user`);
      console.log(`     Bonus pool will be created on first bonus award`);
      return;
    }
    
    // Use payment-service to create a wallet transaction (transfer)
    // Note: Bonus pool account will be created automatically by bonus-service on first use
    // For now, we'll just note that funding can be done manually via payment-service
    console.log(`  ℹ️  Bonus pool funding can be done via payment-service`);
    console.log(`     Transfer funds from payment-gateway to bonus-pool user account`);
    console.log(`     Bonus pool account will be created automatically on first bonus award`);
    
  } catch (error: any) {
    console.log(`  ⚠️  Bonus pool funding skipped: ${error.message}`);
    console.log(`     Bonus pool will be created on first bonus award`);
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           SETUP BONUS USERS                                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();

    // 1. Setup admin@demo.com (should already exist from payment-setup)
    const adminUserId = await createUser(
      token,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ['admin', 'system'],
      {
        allowNegative: true,
        acceptFee: true,
        bonuses: true,
        '*:*:*': true, // Full access
      }
    );

    // 2. Setup bonus-admin user
    const bonusAdminUserId = await createUser(
      token,
      'bonus-admin@system.com',
      'BonusAdmin123!@#',
      ['bonus-admin', 'admin'],
      {
        bonuses: true,
        '*:*:*': true, // Full access to bonus operations
      }
    );

    // 3. Setup test bonus user
    const testUserId = await createUser(
      token,
      'test-bonus-user@demo.com',
      'TestBonus123!@#',
      ['user'],
      {
        bonuses: true, // Can receive bonuses
      }
    );

    // 4. Fund bonus pool (optional - can be done manually)
    await fundBonusPool(1000000, 'USD'); // $10,000

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                    SETUP COMPLETE                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    console.log('Users created:');
    console.log(`  ✅ ${ADMIN_EMAIL} (admin, system) - Full access, can manage bonuses`);
    console.log(`  ✅ bonus-admin@system.com (bonus-admin, admin) - Can manage bonuses`);
    console.log(`  ✅ test-bonus-user@demo.com (user) - Can receive bonuses\n`);

  } catch (error: any) {
    console.error('\n❌ Setup failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
