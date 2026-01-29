#!/usr/bin/env npx tsx
/**
 * Manage User - Generic user management utility
 * 
 * Manages user roles, permissions, status, and other user properties.
 * 
 * Usage:
 *   npx tsx scripts/typescript/auth/manage-user.ts <email> [command] [options]
 * 
 * Commands:
 *   promote (default)        Promote user with roles/permissions
 *   status                   Update user status (pending, active, suspended, locked)
 *   roles                    Update user roles
 *   permissions              Update user permissions
 *   show                     Show user details
 * 
 * Options:
 *   --roles <role1,role2>           Set user roles (e.g., admin,system,user)
 *   --permissions <perm1,perm2>     Set user permissions (e.g., allowNegative,acceptFee,bonuses)
 *   --status <status>               Set user status (pending, active, suspended, locked)
 *   --allow-negative                Allow user to go negative balance
 *   --accept-fee                    Allow user to accept fees
 *   --bonuses                       Allow user to receive bonuses
 *   --all                           Grant all permissions (system role + all permissions)
 *   --email-verified                Mark email as verified
 *   --phone-verified                Mark phone as verified
 * 
 * Examples:
 *   # Show user details
 *   npx tsx scripts/typescript/auth/manage-user.ts system@test.com show
 * 
 *   # Promote to system with all permissions
 *   npx tsx scripts/typescript/auth/manage-user.ts system@test.com --all
 * 
 *   # Set specific roles
 *   npx tsx scripts/typescript/auth/manage-user.ts user@test.com --roles admin,system
 * 
 *   # Update user status
 *   npx tsx scripts/typescript/auth/manage-user.ts user@test.com status --status active
 * 
 *   # Set specific permissions
 *   npx tsx scripts/typescript/auth/manage-user.ts payment-gateway@test.com --allow-negative --accept-fee
 * 
 *   # Mark email as verified
 *   npx tsx scripts/typescript/auth/manage-user.ts user@test.com --email-verified
 */

import { 
  getAuthDatabase, 
  getPaymentDatabase, 
  closeAllConnections,
  getDatabaseContextFromArgs,
} from '../config/scripts.js';

const DEFAULT_TENANT_ID = 'default-tenant';

interface UserPermissions {
  allowNegative?: boolean;
  acceptFee?: boolean;
  bonuses?: boolean;
  [key: string]: boolean | undefined;
}

type UserStatus = 'pending' | 'active' | 'suspended' | 'locked' | 'deleted';

function parseArgs() {
  const args = process.argv.slice(2);
  const email = args[0];
  
  if (!email) {
    console.error('❌ Error: Email is required');
    console.log('\nUsage: npx tsx scripts/typescript/auth/manage-user.ts <email> [command] [options]');
    console.log('\nCommands:');
    console.log('  promote (default)    Promote user with roles/permissions');
    console.log('  status               Update user status');
    console.log('  roles                Update user roles');
    console.log('  permissions          Update user permissions');
    console.log('  show                 Show user details');
    console.log('\nOptions:');
    console.log('  --roles <role1,role2>        Set user roles');
    console.log('  --permissions <perm1,perm2>  Set user permissions');
    console.log('  --status <status>            Set user status (pending, active, suspended, locked)');
    console.log('  --allow-negative             Allow negative balance');
    console.log('  --accept-fee                 Allow accepting fees');
    console.log('  --bonuses                    Allow receiving bonuses');
    console.log('  --email-verified             Mark email as verified');
    console.log('  --phone-verified             Mark phone as verified');
    console.log('  --all                        Grant all permissions');
    process.exit(1);
  }
  
  // Check if second arg is a command or option
  const command = args[1] && !args[1].startsWith('--') ? args[1] : 'promote';
  const optionStart = args[1] && !args[1].startsWith('--') ? 2 : 1;
  
  const options: {
    email: string;
    command: string;
    roles?: string[];
    permissions?: string[];
    status?: UserStatus;
    allowNegative?: boolean;
    acceptFee?: boolean;
    bonuses?: boolean;
    emailVerified?: boolean;
    phoneVerified?: boolean;
    all?: boolean;
  } = { email, command };
  
  for (let i = optionStart; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--roles' && args[i + 1]) {
      options.roles = args[i + 1].split(',').map(r => r.trim());
      i++;
    } else if (arg === '--permissions' && args[i + 1]) {
      options.permissions = args[i + 1].split(',').map(p => p.trim());
      i++;
    } else if (arg === '--status' && args[i + 1]) {
      options.status = args[i + 1] as UserStatus;
      i++;
    } else if (arg === '--allow-negative') {
      options.allowNegative = true;
    } else if (arg === '--accept-fee') {
      options.acceptFee = true;
    } else if (arg === '--bonuses') {
      options.bonuses = true;
    } else if (arg === '--email-verified') {
      options.emailVerified = true;
    } else if (arg === '--phone-verified') {
      options.phoneVerified = true;
    } else if (arg === '--all') {
      options.all = true;
    }
  }
  
  return options;
}

async function showUser(email: string, dbContext?: { brand?: string; tenantId?: string }) {
  const db = await getAuthDatabase(dbContext);
  try {
    const usersCollection = db.collection('users');
    
    const user = await usersCollection.findOne({
      email: email,
      tenantId: DEFAULT_TENANT_ID
    });
    
    if (!user) {
      console.error(`❌ User ${email} not found`);
      return;
    }
    
    console.log(`\n📊 User Details for ${email}:`);
    console.log(`  ID: ${user.id || user._id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Username: ${user.username || 'N/A'}`);
    console.log(`  Phone: ${user.phone || 'N/A'}`);
    console.log(`  Tenant ID: ${user.tenantId}`);
    console.log(`  Status: ${user.status || 'N/A'}`);
    console.log(`  Email Verified: ${user.emailVerified || false}`);
    console.log(`  Phone Verified: ${user.phoneVerified || false}`);
    console.log(`  Roles: ${JSON.stringify(user.roles || [])}`);
    console.log(`  Permissions: ${JSON.stringify(user.permissions || [])}`);
    console.log(`  Created: ${user.createdAt || 'N/A'}`);
    console.log(`  Updated: ${user.updatedAt || 'N/A'}`);
    
  } finally {
    await closeAllConnections();
  }
}

async function manageUser() {
  const options = parseArgs();
  const args = process.argv.slice(2);
  
  // Get database context from command line args (--brand, --tenant)
  const dbContext = await getDatabaseContextFromArgs(args);
  
  try {
    const db = await getAuthDatabase(dbContext);
    console.log('✅ Connected to MongoDB\n');
    
    const usersCollection = db.collection('users');
    
    // Handle show command
    if (options.command === 'show') {
      await showUser(options.email, dbContext);
      return;
    }
    
    // Find user by email
    const user = await usersCollection.findOne({
      email: options.email,
      tenantId: DEFAULT_TENANT_ID
    });
    
    if (!user) {
      console.error(`❌ User ${options.email} not found\n`);
      console.log('Available users:');
      const allUsers = await usersCollection.find({ tenantId: DEFAULT_TENANT_ID }).limit(10).toArray();
      allUsers.forEach(u => {
        console.log(`  - ${u.email || u.username || u.id} (roles: ${u.roles?.join(', ') || 'none'})`);
      });
      process.exit(1);
    }
    
    // Determine roles
    let roles: string[] = [];
    if (options.all) {
      // --all: Give system role (highest level)
      roles = ['system'];
    } else if (options.roles) {
      // --roles: Use specified roles
      roles = options.roles;
    } else if (options.command === 'roles') {
      // roles command: require --roles flag
      if (!options.roles) {
        console.error('❌ Error: --roles required for roles command');
        process.exit(1);
      }
      roles = options.roles;
    } else if (user.roles && user.roles.length > 0) {
      // Preserve existing roles
      roles = Array.isArray(user.roles) ? user.roles : [user.roles];
    } else if (options.command === 'promote') {
      // Default promote: ensure at least 'user' role if no roles exist
      roles = ['user'];
    }
    
    // Determine permissions
    const permissions: UserPermissions = {};
    
    if (options.all) {
      // --all: Grant all permissions
      permissions.allowNegative = true;
      permissions.acceptFee = true;
      permissions.bonuses = true;
      permissions['*:*:*'] = true; // Full access (URN-based)
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
      
      // Merge with existing permissions (unless permissions command)
      if (options.command !== 'permissions' && user.permissions) {
        if (Array.isArray(user.permissions)) {
          user.permissions.forEach((p: string) => {
            permissions[p] = true;
          });
        } else if (typeof user.permissions === 'object') {
          Object.assign(permissions, user.permissions);
        }
      }
    }
    
    // Convert permissions object to array format (GraphQL expects array)
    const permissionsArray = Object.keys(permissions).filter(key => permissions[key] === true);
    
    // Build update data based on command
    const updateData: any = {
      updatedAt: new Date(),
    };
    
    // Handle status update
    if (options.command === 'status' || options.status) {
      if (!options.status && options.command === 'status') {
        console.error('❌ Error: --status required for status command');
        process.exit(1);
      }
      updateData.status = options.status || user.status;
    } else if (options.all || options.command === 'promote') {
      // --all or promote: ensure user is active
      updateData.status = 'active';
    }
    
    // Handle roles update
    if (options.command === 'roles' || options.roles || options.all || options.command === 'promote') {
      updateData.roles = roles;
    }
    
    // Handle permissions update
    if (options.command === 'permissions' || options.permissions || options.allowNegative !== undefined || options.acceptFee !== undefined || options.bonuses !== undefined || options.all || options.command === 'promote') {
      if (permissionsArray.length > 0) {
        updateData.permissions = permissionsArray;
      } else if (options.command === 'permissions') {
        updateData.permissions = [];
      }
    }
    
    // Handle verification flags
    if (options.emailVerified !== undefined) {
      updateData.emailVerified = options.emailVerified;
    }
    if (options.phoneVerified !== undefined) {
      updateData.phoneVerified = options.phoneVerified;
    }
    
    await usersCollection.updateOne(
      { id: user.id },
      { $set: updateData }
    );
    
    // Update wallet allowNegative permission (wallet-level is more flexible and performant)
    if (permissions.allowNegative) {
      const paymentDb = await getPaymentDatabase(dbContext);
      const walletsCollection = paymentDb.collection('wallets');
      
      // Update all wallets for this user to allow negative balance
      const updateResult = await walletsCollection.updateMany(
        { userId: user.id },
        { $set: { allowNegative: true, updatedAt: new Date() } }
      );
      
      console.log(`✅ Updated ${updateResult.modifiedCount} wallet(s) to allow negative balance`);
    }
    
    console.log(`\n✅ User promoted successfully!`);
    console.log(`   Email: ${user.email || user.username || user.id}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Status: ${updateData.status || user.status || 'unchanged'}`);
    console.log(`   Roles: ${updateData.roles?.join(', ') || user.roles?.join(', ') || 'none'}`);
    console.log(`   Permissions: ${updateData.permissions?.join(', ') || user.permissions?.join?.(', ') || 'none'}`);
    
    if (updateData.emailVerified !== undefined) {
      console.log(`   Email Verified: ${updateData.emailVerified}`);
    }
    if (updateData.phoneVerified !== undefined) {
      console.log(`   Phone Verified: ${updateData.phoneVerified}`);
    }
    
    // Show capabilities summary
    const finalRoles = updateData.roles || user.roles || [];
    const finalPermissions = updateData.permissions || [];
    
    if (finalPermissions.length > 0 || finalRoles.length > 0) {
      console.log(`\n   Capabilities:`);
      if (finalRoles.includes('system')) console.log(`     ✓ System role - full system access`);
      if (finalRoles.includes('admin')) console.log(`     ✓ Admin role - administrative access`);
      if (finalRoles.includes('bonus-admin')) console.log(`     ✓ Bonus Admin - manage bonus templates`);
      if (finalRoles.includes('user')) console.log(`     ✓ User role - standard user access`);
      if (finalPermissions.includes('allowNegative') || permissions.allowNegative) console.log(`     ✓ Allow negative balance`);
      if (finalPermissions.includes('acceptFee') || permissions.acceptFee) console.log(`     ✓ Accept fees`);
      if (finalPermissions.includes('bonuses') || permissions.bonuses) console.log(`     ✓ Receive bonuses`);
      if (finalPermissions.includes('*:*:*')) console.log(`     ✓ Full URN access (*:*:*)`);
    }
    
  } catch (error: any) {
    console.error('❌ Error managing user:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await closeAllConnections();
  }
}

manageUser();
