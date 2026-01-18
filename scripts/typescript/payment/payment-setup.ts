#!/usr/bin/env npx tsx
/**
 * Payment Setup - Create users with proper roles/permissions
 * 
 * Naming: payment-setup.ts
 * 
 * Creates:
 * - admin@demo.com: System user with negative balance permission
 * - payment-gateway@system.com: Payment gateway user (can go negative, accepts fees)
 * - payment-provider@system.com: Payment provider user (can accept fees)
 * - test-end-user@demo.com: End user (normal user, no special permissions)
 * 
 * Usage: npx tsx scripts/typescript/payment/payment-setup.ts
 */

import { getAuthDatabase, getPaymentDatabase, closeAllConnections } from '../config/mongodb.js';
import { ObjectId } from 'mongodb';

const AUTH_SERVICE_URL = 'http://localhost:3003/graphql';
const PAYMENT_SERVICE_URL = 'http://localhost:3004/graphql';

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

    // Wait a moment for permissions to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    return data.login.tokens.accessToken;
  } catch (error: any) {
    // If login fails, try to register the admin user first
    if (error.message?.includes('Unauthorized') || error.message?.includes('Invalid credentials') || error.message?.includes('not found')) {
      console.log('⚠️  Admin user not found, registering...');
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
              email: ADMIN_EMAIL,
              password: ADMIN_PASSWORD,
              tenantId: 'default-tenant',
            },
          }
        );
        
        if (registerData.register.success) {
          console.log('✅ Admin user registered, setting admin permissions...');
          
          // Immediately set admin permissions via MongoDB (bypass GraphQL auth)
          const { getAuthDatabase } = await import('../config/mongodb.js');
          const db = await getAuthDatabase();
          const usersCollection = db.collection('users');
          
          const adminUser = await usersCollection.findOne({ email: ADMIN_EMAIL });
          if (adminUser) {
            const rolesArray = [
              { role: 'admin', assignedAt: new Date(), active: true },
              { role: 'system', assignedAt: new Date(), active: true },
            ];
            
            const adminUpdateResult = await usersCollection.updateOne(
              { email: ADMIN_EMAIL },
              {
                $set: {
                  roles: rolesArray,
                  permissions: ['allowNegative', 'acceptFee', 'bonuses', '*:*:*'],
                  updatedAt: new Date(),
                },
              }
            );
            
            if (adminUpdateResult.matchedCount === 0) {
              console.warn('  ⚠️  Admin user not found for role update');
            } else {
              console.log(`  ✅ Admin roles updated (matched: ${adminUpdateResult.matchedCount}, modified: ${adminUpdateResult.modifiedCount})`);
            }
            
            console.log('✅ Admin permissions set, retrying login...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
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
            
            if (retryData.login.success && retryData.login.tokens) {
              return retryData.login.tokens.accessToken;
            }
          }
        }
      } catch (registerError: any) {
        throw new Error(`Failed to register admin user: ${registerError.message}`);
      }
    }
    
    throw new Error(`Login failed: ${error.message}`);
  }
}

async function createUser(token: string, email: string, password: string, roles: string[], permissions: Record<string, boolean>) {
  console.log(`\n👤 Creating user: ${email}...`);
  
  try {
    let userId: string | undefined;
    let existingUser: any = undefined;
    
    // Always check MongoDB first (more reliable, doesn't require permissions)
    const db = await getAuthDatabase();
    const usersCollection = db.collection('users');
    const userDoc = await usersCollection.findOne({ email });
    
    if (userDoc) {
      userId = userDoc._id ? userDoc._id.toString() : userDoc.id;
      existingUser = { id: userId, email };
      console.log(`  ⚠️  User already exists: ${userId}`);
    }
    
    if (existingUser) {
      userId = existingUser.id;
      console.log(`  ⚠️  User already exists: ${userId}`);
    } else {
      // Try to register
      try {
        const registerData = await graphql<{ register: { success: boolean; message?: string; user?: { id: string; email: string } } }>(
          AUTH_SERVICE_URL,
          `
            mutation Register($input: RegisterInput!) {
              register(input: $input) {
                success
                message
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
          const errorMsg = registerData.register.message || 'Registration failed';
          
          // If registration says user exists, find it in database
          if (errorMsg.includes('already exists')) {
            const userDoc = await usersCollection.findOne({ 
              email,
              tenantId: 'default-tenant'
            });
            
            if (userDoc) {
              userId = userDoc._id ? userDoc._id.toString() : userDoc.id;
              console.log(`  ✅ User found in database: ${userId}`);
            } else {
              throw new Error(`User exists but not found in database: ${errorMsg}`);
            }
          } else {
            throw new Error(`Registration failed: ${errorMsg}`);
          }
        }
      } catch (registerError: any) {
        // If registration fails, check if user exists in database
        if (registerError.message?.includes('already exists')) {
          const userDoc = await usersCollection.findOne({ 
            email,
            tenantId: 'default-tenant'
          });
          
          if (userDoc) {
            userId = userDoc._id ? userDoc._id.toString() : userDoc.id;
            console.log(`  ✅ User found in database: ${userId}`);
          } else {
            throw new Error(`Failed to create user: ${registerError.message}`);
          }
        } else {
          throw registerError;
        }
      }
    }
    
    if (!userId) {
      throw new Error(`Failed to get user ID for ${email}`);
    }

    // Update roles and permissions using promote-user script logic
      
      // Convert permissions object to array format (GraphQL expects array)
      const permissionsArray = Object.keys(permissions).filter(key => permissions[key] === true);
      
      // Convert roles to UserRole[] format (array of objects with role, assignedAt, active)
      const rolesArray = roles.map(role => ({
        role,
        assignedAt: new Date(),
        active: true,
      }));
      
      // CRITICAL: Update by _id (MongoDB's primary key) - more reliable than id field
      // Try _id first (if userId looks like ObjectId), then fallback to id field
      const isObjectId = /^[0-9a-f]{24}$/i.test(userId);
      let updateResult;
      
      if (isObjectId) {
        // Use explicit ObjectId conversion for reliable updates
        updateResult = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              roles: rolesArray,
              permissions: permissionsArray.length > 0 ? permissionsArray : [],
              updatedAt: new Date(),
            },
          }
        );
      } else {
        // Fallback to id field or email if userId is not ObjectId format
        updateResult = await usersCollection.updateOne(
          { $or: [{ id: userId }, { email }] },
          {
            $set: {
              roles: rolesArray,
              permissions: permissionsArray.length > 0 ? permissionsArray : [],
              updatedAt: new Date(),
            },
          }
        );
      }
      
      if (updateResult.matchedCount === 0) {
        console.warn(`  ⚠️  No user found to update for ${email} (userId: ${userId})`);
      } else {
        console.log(`  ✅ Updated roles and permissions (matched: ${updateResult.matchedCount}, modified: ${updateResult.modifiedCount})`);
      }
      

      // Update ledger accounts if allowNegative permission is set
      // Note: User permissions are stored in auth_service, payment-service queries auth_service directly
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

async function createWallet(token: string, userId: string, currency: string) {
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
          tenantId: 'default-tenant',
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

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           SETUP PAYMENT USERS                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const token = await login();

    // 1. Setup admin@demo.com as system user
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
    await createWallet(token, adminUserId, 'EUR');

    // 2. Setup payment-gateway user
    const gatewayUserId = await createUser(
      token,
      'payment-gateway@system.com',
      'PaymentGateway123!@#',
      ['payment-gateway'],
      {
        allowNegative: true, // Can go negative (system funding)
        acceptFee: true,    // Can accept fees
      }
    );
    await createWallet(token, gatewayUserId, 'EUR');

    // 3. Setup payment-provider user (mobile money, etc.)
    // IMPORTANT: Payment-provider CANNOT go negative - if balance is zero, it stays zero
    // This is critical for mobile money accounts and real-world payment providers
    const providerUserId = await createUser(
      token,
      'payment-provider@system.com',
      'PaymentProvider123!@#',
      ['payment-provider'],
      {
        acceptFee: true,    // Can accept fees
        // allowNegative: false (default) - Cannot go negative, must have balance
        // This ensures provider balance aligns with real-world account (mobile money, etc.)
      }
    );
    await createWallet(token, providerUserId, 'EUR');

    // 4. Setup test end-user
    const endUserId = await createUser(
      token,
      'test-end-user@demo.com',
      'TestUser123!@#',
      ['user'],
      {
        // No special permissions - normal user
      }
    );
    await createWallet(token, endUserId, 'EUR');

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                    SETUP COMPLETE                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    console.log('Users created:');
    console.log(`  ✅ ${ADMIN_EMAIL} (admin, system) - Can go negative, full access`);
    console.log(`  ✅ payment-gateway@system.com (payment-gateway) - Can go negative, accepts fees`);
    console.log(`  ✅ payment-provider@system.com (payment-provider) - Accepts fees`);
    console.log(`  ✅ test-end-user@demo.com (user) - Normal user\n`);

  } catch (error: any) {
    console.error('\n❌ Setup failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await closeAllConnections();
  }
}

main();
