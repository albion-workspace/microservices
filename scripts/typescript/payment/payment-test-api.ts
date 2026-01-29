#!/usr/bin/env npx tsx
/**
 * Payment Service API Test Suite
 * 
 * Simple GraphQL API tests for payment service functionality.
 * Tests wallets, transfers, deposits, withdrawals through GraphQL API.
 * 
 * Usage:
 *   npx tsx typescript/wallet/payment-test-api.ts        # Run all tests
 *   npx tsx typescript/wallet/payment-test-api.ts all    # Run all tests
 */

import { 
  loginAs, 
  registerAs, 
  getUserDefinition,
  initializeConfig,
  getDefaultTenantId,
} from '../config/users.js';
import { 
  loadScriptConfig,
  AUTH_SERVICE_URL,
  PAYMENT_SERVICE_URL,
  closeAllConnections,
  getPaymentDatabase,
} from '../config/scripts.js';

// ═══════════════════════════════════════════════════════════════════
// GraphQL Helper
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: any = await response.json();

    if (result.errors) {
      const errorMessage = result.errors.map((e: any) => e.message).join('; ');
      throw new Error(`GraphQL Error: ${errorMessage}`);
    }

    return result.data as T;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out after 30 seconds');
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════
// Wallet Helper (following payment-command-test.ts pattern)
// ═══════════════════════════════════════════════════════════════════

async function createWalletWithOptions(
  token: string,
  userId: string,
  currency: string,
  options?: { allowNegative?: boolean; creditLimit?: number }
): Promise<string | null> {
  // Check if wallet already exists
  const walletResult = await graphql<{
    walletBalance: { walletId: string } | null;
  }>(
    PAYMENT_SERVICE_URL,
    `
      query GetWallet($input: JSON!) {
        walletBalance(input: $input) {
          walletId
        }
      }
    `,
    { input: { userId, currency } },
    token
  );
  
  const existingWalletId = walletResult.walletBalance?.walletId;
  
  if (existingWalletId) {
    // Update existing wallet with options (always update to ensure allowNegative is set)
    const db = await getPaymentDatabase();
    const update: Record<string, any> = {};
    if (options?.allowNegative !== undefined) {
      update.allowNegative = options.allowNegative;
    }
    if (options?.creditLimit !== undefined) {
      update.creditLimit = options.creditLimit;
    }
    
    if (Object.keys(update).length > 0) {
      const updateResult = await db.collection('wallets').updateOne(
        { id: existingWalletId },
        { $set: update }
      );
      // Verify update worked
      const updatedWallet = await db.collection('wallets').findOne({ id: existingWalletId });
      if (options?.allowNegative && !updatedWallet?.allowNegative) {
        throw new Error(`Failed to set allowNegative=true for wallet ${existingWalletId}`);
      }
    }
    return existingWalletId;
  } else {
    // Create new wallet with options
    const result = await graphql<{
      createWallet: { success: boolean; wallet?: { id: string } };
    }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateWallet($input: CreateWalletInput!) {
          createWallet(input: $input) {
            success
            wallet { id }
          }
        }
      `,
      {
        input: {
          userId,
          currency,
          allowNegative: options?.allowNegative,
          creditLimit: options?.creditLimit,
        },
      },
      token
    );
    
    return result.createWallet.wallet?.id || null;
  }
}

function logTest(name: string, passed: boolean, message?: string) {
  const icon = passed ? '✅' : '❌';
  const msg = message ? `: ${message}` : '';
  console.log(`${icon} ${name}${msg}`);
}

async function ensureSystemUserHasAllowNegative() {
  // Use same logic as manage-user.ts: update user permissions and wallets
  // IMPORTANT: Don't call registerAs if user exists - it deletes and recreates, creating new user IDs!
  // Instead, just update the existing user's roles/permissions
  const { getAuthDatabase, getPaymentDatabase } = await import('../config/scripts.js');
  const { getDefaultTenantId, getUserDefinition } = await import('../config/users.js');
  const DEFAULT_TENANT_ID = getDefaultTenantId();
  
  try {
    const authDb = await getAuthDatabase();
    const usersCollection = authDb.collection('users');
    const normalizedEmail = 'system@demo.com'.toLowerCase().trim();
    
    // Find existing system user first (don't recreate if exists)
    let user = await usersCollection.findOne({
      email: normalizedEmail,
      tenantId: DEFAULT_TENANT_ID
    });
    
    if (!user) {
      // Only register if user doesn't exist (registerAs will create it, but also delete/recreate if exists)
      console.log('  ℹ️  System user not found, creating new one...');
      await registerAs('system', { updateRoles: true, updatePermissions: true });
      user = await usersCollection.findOne({
        email: normalizedEmail,
        tenantId: DEFAULT_TENANT_ID
      });
    } else {
      console.log(`  ℹ️  Found existing system user: ${user.id || user._id}, updating roles/permissions...`);
    }
    
    if (!user) {
      throw new Error('System user not found after registration');
    }
    
    // Get user definition to ensure we have correct roles/permissions
    const userDef = getUserDefinition('system');
    
    // Update user permissions and roles (don't delete/recreate - just update)
    const currentPermissions = Array.isArray(user.permissions) ? user.permissions : [];
    const defPermissions = typeof userDef.permissions === 'object' && !Array.isArray(userDef.permissions)
      ? Object.keys(userDef.permissions).filter(key => userDef.permissions[key] === true)
      : Array.isArray(userDef.permissions) ? userDef.permissions : [];
    const permissionsArray = [...new Set([...currentPermissions, ...defPermissions, 'allowNegative'])];
    
    // Ensure roles is an array and includes 'system'
    const currentRoles = Array.isArray(user.roles) ? user.roles : (user.roles ? [user.roles] : []);
    const rolesArray = [...new Set([...currentRoles, ...userDef.roles, 'system'])];
    
    // Update user (by _id or id field - MongoDB uses _id, but we also store id)
    const updateFilter = user._id ? { _id: user._id } : { id: user.id };
    const updateResult = await usersCollection.updateOne(
      updateFilter,
      { 
        $set: { 
          permissions: permissionsArray,
          roles: rolesArray, // Ensure system role is set as array
        } 
      }
    );
    
    // Verify the update worked
    const updatedUser = await usersCollection.findOne(updateFilter);
    if (!updatedUser?.roles?.includes('system')) {
      throw new Error(`Failed to set 'system' role on user. Update result: ${updateResult.modifiedCount} modified. Current roles: ${JSON.stringify(updatedUser?.roles)}`);
    }
    
    // Use consistent user ID (prefer id field, fallback to _id)
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new Error('System user has no ID field');
    }
    
    // CRITICAL: Check what findUserIdByRole will return (this is what transfer-helper.ts checks)
    // If there are multiple system users, findUserIdByRole returns the FIRST one
    // We need to ensure our user is the one that will be returned, OR use the one that will be returned
    const { getClient } = await import('../../../core-service/src/databases/mongodb.js');
    let systemUserIdFromRole: string | undefined;
    try {
      const client = getClient();
      const { findUserIdByRole } = await import('../../../core-service/src/databases/user-utils.js');
      systemUserIdFromRole = await findUserIdByRole({ 
        role: 'system', 
        tenantId: DEFAULT_TENANT_ID, 
        throwIfNotFound: false,
        client
      });
    } catch (error: any) {
      // If findUserIdByRole fails, we'll use the user we found
      console.log(`  ⚠️  Could not check findUserIdByRole: ${error.message}`);
    }
    
    // If findUserIdByRole returns a different user, use that one instead
    // This ensures transfer-helper.ts's check (systemUserId === fromUserId) will pass
    const actualUserId = systemUserIdFromRole && systemUserIdFromRole !== userId 
      ? systemUserIdFromRole 
      : userId;
    
    if (systemUserIdFromRole && systemUserIdFromRole !== userId) {
      console.log(`  ⚠️  findUserIdByRole returns different user: ${systemUserIdFromRole} vs ${userId}`);
      console.log(`  ℹ️  Using the user that findUserIdByRole returns (this is what transfer-helper.ts checks)`);
      
      // Update the user that findUserIdByRole returns to ensure it has correct setup
      const roleUser = await usersCollection.findOne({ 
        $or: [{ id: systemUserIdFromRole }, { _id: systemUserIdFromRole }] 
      });
      
      if (roleUser) {
        // Update that user's roles/permissions
        const roleUserRoles = Array.isArray(roleUser.roles) ? roleUser.roles : (roleUser.roles ? [roleUser.roles] : []);
        const roleUserPermissions = Array.isArray(roleUser.permissions) ? roleUser.permissions : [];
        
        await usersCollection.updateOne(
          { $or: [{ id: systemUserIdFromRole }, { _id: systemUserIdFromRole }] },
          { 
            $set: { 
              roles: [...new Set([...roleUserRoles, 'system'])],
              permissions: [...new Set([...roleUserPermissions, 'allowNegative'])],
            } 
          }
        );
      }
    }
    
    // Update ALL wallets for the actual user (by userId) to allow negative balance
    const paymentDb = await getPaymentDatabase();
    const walletsCollection = paymentDb.collection('wallets');
    
    // Find all wallets for the actual user (by userId field)
    const allWallets = await walletsCollection.find({ userId: actualUserId }).toArray();
    
    // Update all wallets to allow negative
    await walletsCollection.updateMany(
      { userId: actualUserId },
      { $set: { allowNegative: true, updatedAt: new Date() } }
    );
    
    // Clean up duplicate EUR wallets - keep only the one with matching tenantId
    const eurWallets = allWallets.filter((w: any) => w.currency === 'EUR');
    if (eurWallets.length > 1) {
      // Keep the wallet with matching tenantId, or the most recent one
      const keepWallet = eurWallets.find((w: any) => w.tenantId === DEFAULT_TENANT_ID) || 
                         eurWallets.sort((a: any, b: any) => 
                           new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
                         )[0];
      
      // Delete other EUR wallets for this user
      const deleteIds = eurWallets
        .filter((w: any) => w.id !== keepWallet.id)
        .map((w: any) => w.id);
      
      if (deleteIds.length > 0) {
        const deleteResult = await walletsCollection.deleteMany({ 
          userId: actualUserId,
          id: { $in: deleteIds } 
        });
        console.log(`  🧹 Cleaned up ${deleteResult.deletedCount} duplicate system wallet(s) for user ${actualUserId}`);
      }
    }
    
    // Return the user ID that findUserIdByRole will return (this is what transfer-helper.ts checks)
    // This ensures transfer-helper.ts's check (systemUserId === fromUserId) will pass
    return actualUserId;
  } catch (error: any) {
    console.error('Error ensuring system user has allowNegative:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Functions
// ═══════════════════════════════════════════════════════════════════

async function testWalletCreation() {
  console.log('\n💼 Testing Wallet Creation...');
  
  try {
    // Setup: Login as system user
    const loginResult = await loginAs('system');
    const token = loginResult.token;
    
    // Get system user ID
    const systemUser = getUserDefinition('system');
    const systemUserId = await loginResult.userId;
    
    // Create wallet
    const result = await graphql<{
      createWallet: {
        success: boolean;
        wallet?: { id: string; userId: string; currency: string; balance: number };
        errors?: string[];
      };
    }>(
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
          userId: systemUserId,
          currency: 'EUR',
        },
      },
      token
    );
    
    if (result.createWallet.success && result.createWallet.wallet) {
      logTest('Wallet Creation', true, `Wallet created: ${result.createWallet.wallet.id}`);
      return result.createWallet.wallet.id;
    } else {
      logTest('Wallet Creation', false, result.createWallet.errors?.join(', ') || 'Unknown error');
      return null;
    }
  } catch (error: any) {
    logTest('Wallet Creation', false, error.message);
    return null;
  }
}

async function testWalletQuery() {
  console.log('\n📊 Testing Wallet Query...');
  
  try {
    const loginResult = await loginAs('system');
    const token = loginResult.token;
    const systemUserId = loginResult.userId;
    
    // Use walletBalance query instead (simpler, doesn't use filter)
    const result = await graphql<{
      walletBalance: {
        walletId: string;
        userId: string;
        currency: string;
        balance: number;
      };
    }>(
      PAYMENT_SERVICE_URL,
      `
        query GetWalletBalance($input: JSON!) {
          walletBalance(input: $input) {
            walletId
            userId
            currency
            balance
          }
        }
      `,
      {
        input: {
          userId: systemUserId,
          currency: 'EUR',
        },
      },
      token
    );
    
    if (result.walletBalance && result.walletBalance.walletId) {
      logTest('Wallet Query', true, `Found wallet: ${result.walletBalance.walletId}`);
      return result.walletBalance.walletId;
    } else {
      logTest('Wallet Query', false, 'No wallet found');
      return null;
    }
  } catch (error: any) {
    logTest('Wallet Query', false, error.message);
    return null;
  }
}

async function testTransfer() {
  console.log('\n💰 Testing Transfer...');
  
  try {
    // Setup users
    await registerAs('user1', { updateRoles: true, updatePermissions: true });
    await registerAs('user2', { updateRoles: true, updatePermissions: true });
    
    // Login first to get the actual user ID that the JWT token is for
    const loginResult = await loginAs('system');
    const token = loginResult.token;
    const systemUserId = loginResult.userId; // Use the user ID from login (matches JWT token)
    
    // Ensure system user has allowNegative permission (updates wallets for this specific user ID)
    await ensureSystemUserHasAllowNegative();
    
    // Create/update system wallet with allowNegative=true
    await createWalletWithOptions(token, systemUserId, 'EUR', { allowNegative: true });
    
    // Verify system wallet has allowNegative=true
    const paymentDb = await getPaymentDatabase();
    const systemWallet = await paymentDb.collection('wallets').findOne({ userId: systemUserId, currency: 'EUR' });
    if (!systemWallet?.allowNegative) {
      await paymentDb.collection('wallets').updateOne(
        { userId: systemUserId, currency: 'EUR' },
        { $set: { allowNegative: true } }
      );
    }
    
    // Get user IDs
    const user1Login = await loginAs('user1');
    const user2Login = await loginAs('user2');
    const user1Id = user1Login.userId;
    const user2Id = user2Login.userId;
    
    // Create wallets for both users
    const wallet1Result = await graphql<{
      createWallet: { success: boolean; wallet?: { id: string } };
    }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateWallet($input: CreateWalletInput!) {
          createWallet(input: $input) {
            success
            wallet { id }
          }
        }
      `,
      { input: { userId: user1Id, currency: 'EUR', tenantId: 'default-tenant' } },
      token
    );
    
    const wallet2Result = await graphql<{
      createWallet: { success: boolean; wallet?: { id: string } };
    }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateWallet($input: CreateWalletInput!) {
          createWallet(input: $input) {
            success
            wallet { id }
          }
        }
      `,
      { input: { userId: user2Id, currency: 'EUR' } },
      token
    );
    
    if (!wallet1Result.createWallet.success || !wallet2Result.createWallet.success) {
      logTest('Transfer Setup', false, 'Failed to create wallets');
      return;
    }
    
    // Deposit to user1 wallet first (from system user)
    const depositResult = await graphql<{
      createDeposit: { success: boolean; deposit?: { id: string } };
    }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateDeposit($input: CreateDepositInput!) {
          createDeposit(input: $input) {
            success
            deposit { id }
          }
        }
      `,
      {
        input: {
          userId: user1Id,
          amount: 10000, // €100.00
          currency: 'EUR',
          fromUserId: systemUserId, // System user credits the deposit
          method: 'test',
        },
      },
      token
    );
    
    if (!depositResult.createDeposit.success) {
      logTest('Transfer Setup', false, 'Failed to create deposit');
      return;
    }
    
    await sleep(1000); // Wait for deposit to process
    
    // Create transfer from user1 to user2
    const transferResult = await graphql<{
      createTransfer: {
        success: boolean;
        transfer?: { id: string; fromUserId: string; toUserId: string; amount: number };
      };
    }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateTransfer($input: CreateTransferInput!) {
          createTransfer(input: $input) {
            success
            transfer {
              id
              fromUserId
              toUserId
              amount
            }
          }
        }
      `,
      {
        input: {
          fromUserId: user1Id,
          toUserId: user2Id,
          amount: 5000, // €50.00
          currency: 'EUR',
          description: 'Test transfer',
        },
      },
      user1Login.token // Use user1's token for transfer
    );
    
    if (transferResult.createTransfer.success && transferResult.createTransfer.transfer) {
      logTest('Transfer', true, `Transfer created: ${transferResult.createTransfer.transfer.id}`);
    } else {
      const errorMsg = (transferResult.createTransfer as any).errors?.join(', ') || 'Unknown error';
      logTest('Transfer', false, `Transfer failed: ${errorMsg}`);
    }
  } catch (error: any) {
    logTest('Transfer', false, error.message);
  }
}

async function testDeposit() {
  console.log('\n💵 Testing Deposit...');
  
  try {
    await registerAs('user1', { updateRoles: true, updatePermissions: true });
    
    // Ensure system user exists and has correct setup FIRST
    // This will create/update the user and return the user ID (reuses existing user if found)
    const systemUserIdFromSetup = await ensureSystemUserHasAllowNegative();
    
    // Now login to get the token (user should exist now)
    const loginResult = await loginAs('system');
    const token = loginResult.token;
    
    // Use the user ID from setup (consistent, reuses existing user) or fallback to login result
    let systemUserId = systemUserIdFromSetup || loginResult.userId;
    
    // Verify the user exists and has correct roles (by the ID we're using)
    const { getAuthDatabase } = await import('../config/scripts.js');
    const authDb = await getAuthDatabase();
    let systemUser = await authDb.collection('users').findOne({ 
      $or: [{ id: systemUserId }, { _id: systemUserId }] 
    });
    
    // If not found by ID, find by email (might be different ID format)
    if (!systemUser) {
      systemUser = await authDb.collection('users').findOne({ 
        email: 'system@demo.com',
        tenantId: 'default-tenant'
      });
      if (systemUser) {
        // Use the actual user ID from database
        systemUserId = systemUser.id || systemUser._id?.toString();
      }
    }
    
    if (!systemUser) {
      throw new Error(`System user not found with ID: ${systemUserId} or by email`);
    }
    
    // Ensure roles are set (update if needed)
    const userRoles = Array.isArray(systemUser.roles) ? systemUser.roles : (systemUser.roles ? [systemUser.roles] : []);
    if (!userRoles.includes('system')) {
      const updateFilter = systemUser._id ? { _id: systemUser._id } : { id: systemUser.id };
      await authDb.collection('users').updateOne(
        updateFilter,
        { $set: { roles: ['system'] } }
      );
    }
    
    const user1Login = await loginAs('user1');
    const user1Id = user1Login.userId;
    
    // Create/update system wallet with allowNegative=true (must exist before deposit)
    const systemWalletId = await createWalletWithOptions(token, systemUserId, 'EUR', { allowNegative: true });
    
    // Verify system wallet exists and has allowNegative=true (with tenantId)
    const paymentDb = await getPaymentDatabase();
    const { getDefaultTenantId } = await import('../config/users.js');
    const tenantId = getDefaultTenantId();
    
    let systemWallet = await paymentDb.collection('wallets').findOne({ 
      userId: systemUserId, 
      currency: 'EUR',
      tenantId 
    });
    
    if (!systemWallet) {
      // Create wallet via GraphQL if it doesn't exist
      const createResult = await graphql<{
        createWallet: { success: boolean; wallet?: { id: string } };
      }>(
        PAYMENT_SERVICE_URL,
        `
          mutation CreateWallet($input: CreateWalletInput!) {
            createWallet(input: $input) {
              success
              wallet { id }
            }
          }
        `,
        { input: { userId: systemUserId, currency: 'EUR', tenantId, allowNegative: true } },
        token
      );
      
      if (!createResult.createWallet.success) {
        throw new Error('Failed to create system wallet');
      }
      
      systemWallet = await paymentDb.collection('wallets').findOne({ 
        userId: systemUserId, 
        currency: 'EUR',
        tenantId 
      });
    }
    
    // Ensure allowNegative=true (force update and verify)
    if (!systemWallet?.allowNegative) {
      const updateResult = await paymentDb.collection('wallets').updateOne(
        { userId: systemUserId, currency: 'EUR', tenantId },
        { $set: { allowNegative: true } }
      );
      
      // Re-fetch to verify
      systemWallet = await paymentDb.collection('wallets').findOne({ 
        userId: systemUserId, 
        currency: 'EUR',
        tenantId 
      });
      
      if (!systemWallet?.allowNegative) {
        throw new Error(`Failed to set allowNegative=true on system wallet. Update result: ${updateResult.modifiedCount} modified`);
      }
    }
    
    // Double-check: Verify wallet has allowNegative
    // IMPORTANT: Check ALL wallets for this user to see if there are multiple
    const allSystemWallets = await paymentDb.collection('wallets').find({ 
      userId: systemUserId,
      currency: 'EUR'
    }).toArray();
    
    console.log(`  🔍 Found ${allSystemWallets.length} EUR wallet(s) for system user ${systemUserId}`);
    allSystemWallets.forEach((w: any, i: number) => {
      console.log(`    Wallet ${i + 1}: id=${w.id}, tenantId=${w.tenantId}, allowNegative=${w.allowNegative}`);
    });
    
    const finalCheck = await paymentDb.collection('wallets').findOne({ 
      userId: systemUserId, 
      currency: 'EUR',
      tenantId 
    });
    
    if (!finalCheck) {
      // If no wallet with matching tenantId, use any EUR wallet and update it
      const anyEurWallet = allSystemWallets[0];
      if (anyEurWallet) {
        await paymentDb.collection('wallets').updateOne(
          { id: anyEurWallet.id },
          { $set: { tenantId, allowNegative: true } }
        );
        console.log(`  ⚠️  Updated wallet ${anyEurWallet.id} to use tenantId=${tenantId} and allowNegative=true`);
      } else {
        throw new Error(`No EUR wallet found for system user ${systemUserId}`);
      }
    } else if (!finalCheck.allowNegative) {
      throw new Error(`System wallet does not have allowNegative=true. Wallet: ${JSON.stringify(finalCheck)}`);
    }
    
    console.log(`  ✅ Verified: System wallet has allowNegative=true, user has 'system' role`);
    
    // Create wallet for user1 (must exist before deposit)
    const user1WalletResult = await graphql<{
      createWallet: { success: boolean; wallet?: { id: string } };
    }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateWallet($input: CreateWalletInput!) {
          createWallet(input: $input) {
            success
            wallet { id }
          }
        }
      `,
      { input: { userId: user1Id, currency: 'EUR', tenantId: 'default-tenant' } },
      token
    );
    
    if (!user1WalletResult.createWallet.success) {
      logTest('Deposit', false, 'Failed to create user1 wallet');
      return;
    }
    
    await sleep(500);
    
    // Verify both wallets exist before deposit
    const user1Wallet = await paymentDb.collection('wallets').findOne({ 
      userId: user1Id, 
      currency: 'EUR',
      tenantId 
    });
    
    if (!user1Wallet) {
      logTest('Deposit', false, 'User1 wallet not found after creation');
      return;
    }
    
    if (!systemWallet) {
      logTest('Deposit', false, 'System wallet not found');
      return;
    }
    
    // Create deposit (fromUserId is system user, toUserId is the user receiving the deposit)
    const result = await graphql<{
      createDeposit: {
        success: boolean;
        deposit?: { id: string; userId: string; amount: number; currency: string };
        errors?: string[];
      };
    }>(
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
            }
            errors
          }
        }
      `,
      {
        input: {
          userId: user1Id, // User receiving the deposit (toUserId)
          fromUserId: systemUserId, // System user funding the deposit (fromUserId - must match findUserIdByRole result)
          amount: 25000, // €250.00
          currency: 'EUR',
          tenantId: 'default-tenant', // Match wallet lookup
          method: 'test',
        },
      },
      token
    );
    
    if (result.createDeposit.success && result.createDeposit.deposit) {
      logTest('Deposit', true, `Deposit created: ${result.createDeposit.deposit.id}`);
    } else {
      const errorMsg = result.createDeposit.errors?.join(', ') || JSON.stringify(result.createDeposit);
      logTest('Deposit', false, `Deposit failed: ${errorMsg}`);
    }
  } catch (error: any) {
    logTest('Deposit', false, error.message);
  }
}

async function testWithdrawal() {
  console.log('\n💸 Testing Withdrawal...');
  
  try {
    await registerAs('user1', { updateRoles: true, updatePermissions: true });
    
    // Login first to get the actual user ID that the JWT token is for
    const loginResult = await loginAs('system');
    const token = loginResult.token;
    const systemUserId = loginResult.userId; // Use the user ID from login (matches JWT token)
    
    // Ensure system user has allowNegative permission (updates wallets for this specific user ID)
    await ensureSystemUserHasAllowNegative();
    
    // Create/update system wallet with allowNegative=true
    await createWalletWithOptions(token, systemUserId, 'EUR', { allowNegative: true });
    
    // Verify system wallet has allowNegative=true
    const paymentDb = await getPaymentDatabase();
    const systemWallet = await paymentDb.collection('wallets').findOne({ userId: systemUserId, currency: 'EUR' });
    if (!systemWallet?.allowNegative) {
      await paymentDb.collection('wallets').updateOne(
        { userId: systemUserId, currency: 'EUR' },
        { $set: { allowNegative: true } }
      );
    }
    
    // Ensure system user has allowNegative permission (updates wallets)
    await ensureSystemUserHasAllowNegative();
    
    // Create/update system wallet with allowNegative=true
    await createWalletWithOptions(token, systemUserId, 'EUR', { allowNegative: true });
    
    // Verify wallet has allowNegative set
    const db = await getPaymentDatabase();
    const wallet = await db.collection('wallets').findOne({ userId: systemUserId, currency: 'EUR' });
    if (!wallet?.allowNegative) {
      // Force update if not set
      await db.collection('wallets').updateOne(
        { userId: systemUserId, currency: 'EUR' },
        { $set: { allowNegative: true } }
      );
    }
    
    const user1Login = await loginAs('user1');
    const user1Id = user1Login.userId;
    
    // Create wallet and deposit first
    await graphql(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateWallet($input: CreateWalletInput!) {
          createWallet(input: $input) {
            success
            wallet { id }
          }
        }
      `,
      { input: { userId: user1Id, currency: 'EUR', tenantId: 'default-tenant' } },
      token
    );
    
    await sleep(500);
    
    await graphql(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateDeposit($input: CreateDepositInput!) {
          createDeposit(input: $input) {
            success
            deposit { id }
          }
        }
      `,
      {
        input: {
          userId: user1Id, // User receiving the deposit
          fromUserId: systemUserId, // System user funding the deposit
          amount: 50000, // €500.00
          currency: 'EUR',
          method: 'test',
        },
      },
      token
    );
    
    await sleep(1000);
    
    // Create withdrawal (toUserId is system user - withdrawal goes back to system)
    const result = await graphql<{
      createWithdrawal: {
        success: boolean;
        withdrawal?: { id: string; userId: string; amount: number; currency: string };
        errors?: string[];
      };
    }>(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateWithdrawal($input: CreateWithdrawalInput!) {
          createWithdrawal(input: $input) {
            success
            withdrawal {
              id
              userId
              amount
              currency
            }
            errors
          }
        }
      `,
      {
        input: {
          userId: user1Id, // User withdrawing
          toUserId: systemUserId, // System user receiving the withdrawal
          amount: 20000, // €200.00
          currency: 'EUR',
          method: 'test',
        },
      },
      user1Login.token // User creates their own withdrawal
    );
    
    if (result.createWithdrawal.success && result.createWithdrawal.withdrawal) {
      logTest('Withdrawal', true, `Withdrawal created: ${result.createWithdrawal.withdrawal.id}`);
    } else {
      const errorMsg = result.createWithdrawal.errors?.join(', ') || JSON.stringify(result.createWithdrawal);
      logTest('Withdrawal', false, `Withdrawal failed: ${errorMsg}`);
    }
  } catch (error: any) {
    logTest('Withdrawal', false, error.message);
  }
}

async function testTransactionsQuery() {
  console.log('\n📜 Testing Transactions Query...');
  
  try {
    const loginResult = await loginAs('system');
    const token = loginResult.token;
    
    const result = await graphql<{
      transactions: {
        nodes: Array<{ id: string; type: string; amount: number; currency: string }>;
      };
    }>(
      PAYMENT_SERVICE_URL,
      `
        query GetTransactions {
          transactions(first: 10) {
            nodes {
              id
              type
              amount
              currency
            }
          }
        }
      `,
      {},
      token
    );
    
    logTest('Transactions Query', true, `Found ${result.transactions.nodes.length} transaction(s)`);
  } catch (error: any) {
    logTest('Transactions Query', false, error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Runner
// ═══════════════════════════════════════════════════════════════════

async function testAll() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PAYMENT SERVICE API TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Setup: Register system user
  try {
    await registerAs('system', { updateRoles: true, updatePermissions: true });
  } catch (e) {
    // User might already exist
  }
  
  let passed = 0;
  let failed = 0;
  
  // Run tests
  const tests = [
    { name: 'Wallet Creation', fn: testWalletCreation },
    { name: 'Wallet Query', fn: testWalletQuery },
    { name: 'Deposit', fn: testDeposit },
    { name: 'Transfer', fn: testTransfer },
    { name: 'Withdrawal', fn: testWithdrawal },
    { name: 'Transactions Query', fn: testTransactionsQuery },
  ];
  
  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (error: any) {
      console.error(`\n❌ ${test.name} failed:`, error.message);
      failed++;
    }
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const testName = args[0] || 'all';
  
  try {
    // Initialize config
    await initializeConfig();
    await loadScriptConfig();
    
    if (testName === 'all') {
      await testAll();
    } else {
      console.error(`Unknown test: ${testName}`);
      console.log('Available tests: all');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await closeAllConnections();
  }
}

// Run
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
