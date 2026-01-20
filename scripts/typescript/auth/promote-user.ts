#!/usr/bin/env npx tsx
/**
 * Promote User - Generic user role/permission management
 * 
 * Sets user roles and permissions including:
 * - Roles: admin, system, user, etc.
 * - Permissions: allowNegative, acceptFee, bonuses, etc.
 * 
 * Usage:
 *   npx tsx scripts/promote-user.ts <email> [options]
 * 
 * Options:
 *   --roles <role1,role2>     Set user roles (e.g., admin,system)
 *   --permissions <perm1,perm2> Set user permissions (e.g., allowNegative,acceptFee,bonuses)
 *   --allow-negative          Allow user to go negative balance
 *   --accept-fee              Allow user to accept fees
 *   --bonuses                 Allow user to receive bonuses
 *   --all                     Grant all permissions (admin + all permissions)
 * 
 * Examples:
 *   # Promote to system with all permissions
 *   npx tsx scripts/promote-user.ts system@test.com --all
 * 
 *   # Set specific roles
 *   npx tsx scripts/promote-user.ts user@test.com --roles admin,system
 * 
 *   # Set specific permissions
 *   npx tsx scripts/promote-user.ts payment-gateway@test.com --allow-negative --accept-fee
 * 
 *   # Custom roles and permissions
 *   npx tsx scripts/promote-user.ts user@test.com --roles provider --permissions allowNegative,acceptFee
 */

import { getAuthDatabase, getPaymentDatabase, closeAllConnections } from '../config/mongodb.js';

interface UserPermissions {
  allowNegative?: boolean;
  acceptFee?: boolean;
  bonuses?: boolean;
  [key: string]: boolean | undefined;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const email = args[0];
  
  if (!email) {
    console.error('❌ Error: Email is required');
    console.log('\nUsage: npx tsx scripts/typescript/auth/promote-user.ts <email> [options]');
    console.log('\nOptions:');
    console.log('  --roles <role1,role2>        Set user roles');
    console.log('  --permissions <perm1,perm2>  Set user permissions');
    console.log('  --allow-negative             Allow negative balance');
    console.log('  --accept-fee                 Allow accepting fees');
    console.log('  --bonuses                    Allow receiving bonuses');
    console.log('  --all                        Grant all permissions');
    process.exit(1);
  }
  
  const options: {
    email: string;
    roles?: string[];
    permissions?: string[];
    allowNegative?: boolean;
    acceptFee?: boolean;
    bonuses?: boolean;
    all?: boolean;
  } = { email };
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--roles' && args[i + 1]) {
      options.roles = args[i + 1].split(',').map(r => r.trim());
      i++;
    } else if (arg === '--permissions' && args[i + 1]) {
      options.permissions = args[i + 1].split(',').map(p => p.trim());
      i++;
    } else if (arg === '--allow-negative') {
      options.allowNegative = true;
    } else if (arg === '--accept-fee') {
      options.acceptFee = true;
    } else if (arg === '--bonuses') {
      options.bonuses = true;
    } else if (arg === '--all') {
      options.all = true;
    }
  }
  
  return options;
}

async function promoteUser() {
  const options = parseArgs();
  
  try {
    const db = await getAuthDatabase();
    console.log('✅ Connected to MongoDB\n');
    
    const usersCollection = db.collection('users');
    
    // Find user by email
    const user = await usersCollection.findOne({
      email: options.email,
    });
    
    if (!user) {
      console.error(`❌ User ${options.email} not found\n`);
      console.log('Available users:');
      const allUsers = await usersCollection.find({}).limit(10).toArray();
      allUsers.forEach(u => {
        console.log(`  - ${u.email || u.username || u.id} (roles: ${u.roles?.join(', ') || 'none'})`);
      });
      process.exit(1);
    }
    
    // Determine roles
    let roles: string[] = [];
    if (options.all) {
      roles = ['system'];
    } else if (options.roles) {
      roles = options.roles;
    } else if (user.roles) {
      roles = Array.isArray(user.roles) ? user.roles : [user.roles];
    }
    
    // Determine permissions
    const permissions: UserPermissions = {};
    
    if (options.all) {
      permissions.allowNegative = true;
      permissions.acceptFee = true;
      permissions.bonuses = true;
      permissions['*:*:*'] = true; // Full access
    } else {
      // Set specific permissions
      if (options.allowNegative !== undefined) {
        permissions.allowNegative = options.allowNegative;
      }
      if (options.acceptFee !== undefined) {
        permissions.acceptFee = options.acceptFee;
      }
      if (options.bonuses !== undefined) {
        permissions.bonuses = options.bonuses;
      }
      
      // Parse permission strings
      if (options.permissions) {
        for (const perm of options.permissions) {
          permissions[perm] = true;
        }
      }
      
      // Merge with existing permissions
      if (user.permissions) {
        Object.assign(permissions, user.permissions);
      }
    }
    
    // Convert permissions object to array format (GraphQL expects array)
    const permissionsArray = Object.keys(permissions).filter(key => permissions[key] === true);
    
    // Update user
    const updateData: any = {
      roles,
      updatedAt: new Date(),
    };
    
    if (permissionsArray.length > 0) {
      updateData.permissions = permissionsArray;
    } else {
      updateData.permissions = [];
    }
    
    await usersCollection.updateOne(
      { id: user.id },
      { $set: updateData }
    );
    
    // Update wallet allowNegative permission (wallet-level is more flexible and performant)
    if (permissions.allowNegative) {
      const paymentDb = await getPaymentDatabase();
      const walletsCollection = paymentDb.collection('wallets');
      
      // Update all wallets for this user to allow negative balance
      const updateResult = await walletsCollection.updateMany(
        { userId: user.id },
        { $set: { allowNegative: true, updatedAt: new Date() } }
      );
      
      console.log(`✅ Updated ${updateResult.modifiedCount} wallet(s) to allow negative balance`);
      
      // Also set allowNegative for any wallets created in the future via getOrCreateWallet
      // This is handled by passing options to getOrCreateWallet, but we can also set a default
      // by updating the user's wallets now (done above).
    }
    
    console.log(`\n✅ User promoted successfully!`);
    console.log(`   Email: ${user.email || user.username || user.id}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Roles: ${roles.join(', ') || 'none'}`);
    console.log(`   Permissions:`);
    Object.entries(permissions).forEach(([key, value]) => {
      console.log(`     - ${key}: ${value}`);
    });
    console.log(`\n   User can now:`);
    if (permissions.allowNegative) console.log(`     ✓ Go negative balance`);
    if (permissions.acceptFee) console.log(`     ✓ Accept fees`);
    if (permissions.bonuses) console.log(`     ✓ Receive bonuses (bonus-service will award bonuses)`);
    if (roles.includes('system')) console.log(`     ✓ Perform system operations`);
    if (roles.includes('system')) console.log(`     ✓ Perform system operations`);
    if (roles.includes('bonus-admin')) console.log(`     ✓ Manage bonus templates and operations`);
    
  } catch (error: any) {
    console.error('❌ Error promoting user:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

promoteUser();
