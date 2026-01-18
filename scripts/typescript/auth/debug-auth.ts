#!/usr/bin/env npx tsx
/**
 * Unified Auth Debug Script
 * 
 * Debugging tools for auth issues (wrong users, duplicates, ID mismatches)
 * 
 * Usage:
 *   npx tsx scripts/typescript/auth/debug-auth.ts wrong-user [userId]    # Check wrong user ID
 *   npx tsx scripts/typescript/auth/debug-auth.ts duplicates [email]     # Find duplicate users
 *   npx tsx scripts/typescript/auth/debug-auth.ts fix-duplicates [email] # Fix duplicate admins
 *   npx tsx scripts/typescript/auth/debug-auth.ts find-user <email>     # Find user by email
 *   npx tsx scripts/typescript/auth/debug-auth.ts id-mismatch           # Check for ID mismatches
 */

import { getAuthDatabase, closeAllConnections } from '../config/mongodb.js';

const DEFAULT_TENANT_ID = 'default-tenant';
const DEFAULT_ADMIN_EMAIL = 'admin@demo.com';

async function connectDB() {
  const db = await getAuthDatabase();
  return { db };
}

async function checkWrongUser(userId?: string) {
  const { db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    const wrongUserId = userId || '4a83b793-6a86-45b6-ae86-8b10ed48fb6e';
    const correctUserId = '384a2411-2a3d-406f-8e66-5fe362494b55';
    
    console.log(`\n🔍 Checking for wrong user ID: ${wrongUserId}\n`);
    
    // Check wrong user ID
    const wrongUser = await usersCollection.findOne({ id: wrongUserId });
    console.log(`User with ID ${wrongUserId}:`);
    if (wrongUser) {
      console.log('  ✅ EXISTS!');
      console.log(`  Email: ${wrongUser.email}`);
      console.log(`  Tenant ID: ${wrongUser.tenantId}`);
      console.log(`  Roles: ${JSON.stringify(wrongUser.roles)}`);
      console.log(`  Permissions: ${JSON.stringify(wrongUser.permissions)}`);
      console.log(`  Created: ${wrongUser.createdAt}`);
      
      if (wrongUser.email === DEFAULT_ADMIN_EMAIL) {
        console.log('\n⚠️  This user has admin@demo.com email but wrong roles!');
        console.log('   This is why Passport finds it instead of the correct admin user.');
      }
    } else {
      console.log('  ❌ NOT FOUND');
    }
    
    // Check correct user ID
    console.log(`\n🔍 Checking for correct user ID: ${correctUserId}\n`);
    const correctUser = await usersCollection.findOne({ id: correctUserId });
    console.log(`User with ID ${correctUserId}:`);
    if (correctUser) {
      console.log('  ✅ EXISTS!');
      console.log(`  Email: ${correctUser.email}`);
      console.log(`  Roles: ${JSON.stringify(correctUser.roles)}`);
      console.log(`  Permissions: ${JSON.stringify(correctUser.permissions)}`);
    } else {
      console.log('  ❌ NOT FOUND');
    }
    
    // Check by email
    console.log(`\n🔍 Checking for ${DEFAULT_ADMIN_EMAIL}...\n`);
    const adminUser = await usersCollection.findOne({ email: DEFAULT_ADMIN_EMAIL });
    console.log(`User with email ${DEFAULT_ADMIN_EMAIL}:`);
    if (adminUser) {
      console.log('  ✅ EXISTS!');
      console.log(`  ID: ${adminUser.id || adminUser._id}`);
      console.log(`  Roles: ${JSON.stringify(adminUser.roles)}`);
      
      if (adminUser.id === wrongUserId) {
        console.log('\n❌ PROBLEM: Admin user has the WRONG user ID!');
      } else if (adminUser.id === correctUserId) {
        console.log('\n✅ Admin user has the CORRECT user ID');
      } else {
        console.log(`\n⚠️  Admin user has a DIFFERENT user ID: ${adminUser.id}`);
      }
    } else {
      console.log('  ❌ NOT FOUND');
    }
    
    // List all users
    console.log('\n🔍 Listing ALL users...\n');
    const allUsers = await usersCollection.find({}).toArray();
    console.log(`Found ${allUsers.length} users:`);
    allUsers.forEach((user, idx) => {
      console.log(`  ${idx + 1}. ID: ${user.id || user._id}, Email: ${user.email}, Roles: ${JSON.stringify(user.roles)}`);
    });
    
  } finally {
    await closeAllConnections();
  }
}

async function findDuplicates(email?: string) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    const searchEmail = email || DEFAULT_ADMIN_EMAIL;
    
    console.log(`\n🔍 Checking for duplicate users with email: ${searchEmail}\n`);
    
    const users = await usersCollection.find({ email: searchEmail }).toArray();
    
    console.log(`Found ${users.length} user(s) with email ${searchEmail}:\n`);
    
    users.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log(`  ID: ${user.id || user._id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Tenant ID: ${user.tenantId}`);
      console.log(`  Roles: ${JSON.stringify(user.roles)}`);
      console.log(`  Permissions: ${JSON.stringify(user.permissions)}`);
      console.log(`  Created: ${user.createdAt}`);
      console.log(`  Updated: ${user.updatedAt}`);
      console.log('');
    });
    
    if (users.length > 1) {
      console.log('❌ PROBLEM: Multiple users found with the same email!');
      
      const correctAdmin = users.find(u => 
        Array.isArray(u.roles) && 
        (u.roles.includes('admin') || u.roles.includes('system'))
      );
      
      const wrongAdmins = users.filter(u => 
        Array.isArray(u.roles) && 
        u.roles.length === 1 && 
        u.roles[0] === 'user'
      );
      
      if (correctAdmin) {
        console.log(`\n✅ Correct admin user: ${correctAdmin.id || correctAdmin._id}`);
      }
      if (wrongAdmins.length > 0) {
        console.log(`\n❌ Wrong admin user(s): ${wrongAdmins.map(u => u.id || u._id).join(', ')}`);
      }
    } else if (users.length === 0) {
      console.log('❌ PROBLEM: No users found with this email!');
    } else {
      console.log('✅ No duplicates found');
    }
    
    // Check with normalized email
    console.log('\n🔍 Checking with normalized email...\n');
    const normalizedEmail = searchEmail.toLowerCase().trim();
    const normalizedUsers = await usersCollection.find({ 
      $or: [
        { email: normalizedEmail },
        { email: searchEmail },
        { email: { $regex: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ]
    }).toArray();
    
    console.log(`Found ${normalizedUsers.length} user(s) with normalized email:\n`);
    normalizedUsers.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log(`  ID: ${user.id || user._id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Roles: ${JSON.stringify(user.roles)}`);
      console.log('');
    });
    
  } finally {
    await closeAllConnections();
  }
}

async function fixDuplicates(email?: string) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    const sessionsCollection = db.collection('sessions');
    const refreshTokensCollection = db.collection('refresh_tokens');
    
    const searchEmail = email || DEFAULT_ADMIN_EMAIL;
    
    console.log(`\n🔍 Finding duplicate users with email: ${searchEmail}\n`);
    
    const adminUsers = await usersCollection.find({
      email: searchEmail,
      tenantId: DEFAULT_TENANT_ID
    }).toArray();
    
    console.log(`Found ${adminUsers.length} user(s) with email ${searchEmail}:\n`);
    
    adminUsers.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log(`  ID: ${user.id || user._id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Tenant ID: ${user.tenantId}`);
      console.log(`  Roles: ${JSON.stringify(user.roles || [])}`);
      console.log(`  Permissions: ${JSON.stringify(user.permissions || [])}`);
      console.log(`  Created At: ${user.createdAt}`);
      console.log('');
    });
    
    // Find the correct admin user (should have admin/system roles)
    const correctAdmin = adminUsers.find(u => 
      Array.isArray(u.roles) && 
      (u.roles.includes('admin') || u.roles.includes('system'))
    );
    
    // Find the wrong user (has only 'user' role)
    const wrongAdmin = adminUsers.find(u => 
      Array.isArray(u.roles) && 
      u.roles.length === 1 && 
      u.roles[0] === 'user'
    );
    
    if (correctAdmin && wrongAdmin) {
      console.log('✅ Found correct admin user:', correctAdmin.id || correctAdmin._id);
      console.log('❌ Found wrong admin user:', wrongAdmin.id || wrongAdmin._id);
      console.log('\n🗑️  Deleting wrong admin user...');
      
      const deleteResult = await usersCollection.deleteOne({ id: wrongAdmin.id });
      console.log(`✅ Deleted ${deleteResult.deletedCount} user(s)`);
      
      // Also delete any sessions/refresh tokens for the wrong user
      const sessionsDeleted = await sessionsCollection.deleteMany({ userId: wrongAdmin.id });
      const tokensDeleted = await refreshTokensCollection.deleteMany({ userId: wrongAdmin.id });
      
      console.log(`✅ Deleted ${sessionsDeleted.deletedCount} session(s)`);
      console.log(`✅ Deleted ${tokensDeleted.deletedCount} refresh token(s)`);
      
      console.log('\n✅ Cleanup complete! Now Passport should find the correct admin user.');
    } else if (correctAdmin && !wrongAdmin) {
      console.log('✅ Only correct admin user found. No cleanup needed.');
    } else if (!correctAdmin && wrongAdmin) {
      console.log('⚠️  Only wrong admin user found. Promoting it to admin...');
      await usersCollection.updateOne(
        { id: wrongAdmin.id },
        {
          $set: {
            roles: ['admin', 'system'],
            permissions: ['*:*:*', 'allowNegative', 'acceptFee', 'bonuses'],
            updatedAt: new Date(),
          },
        }
      );
      console.log('✅ User promoted to admin');
    } else {
      console.log('❌ No admin users found!');
    }
    
  } finally {
    await closeAllConnections();
  }
}

async function findUser(email: string) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    console.log(`\n🔍 Searching for user with email: ${email}\n`);
    
    // Try multiple queries
    const queries = [
      { email: email },
      { email: email.toLowerCase() },
      { email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    ];
    
    const allUsers: any[] = [];
    for (const query of queries) {
      const users = await usersCollection.find(query).toArray();
      allUsers.push(...users);
    }
    
    // Deduplicate
    const uniqueUsers = Array.from(new Map(allUsers.map(u => [u.id || u._id, u])).values());
    
    if (uniqueUsers.length === 0) {
      console.log('❌ User not found');
      return;
    }
    
    console.log(`Found ${uniqueUsers.length} user(s):\n`);
    
    uniqueUsers.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log(`  ID: ${user.id || user._id}`);
      console.log(`  _id: ${user._id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Tenant ID: ${user.tenantId}`);
      console.log(`  Roles: ${JSON.stringify(user.roles)}`);
      console.log(`  Permissions: ${JSON.stringify(user.permissions)}`);
      
      if (user._id && user.id && String(user._id) !== String(user.id)) {
        console.log(`  ⚠️  WARNING: _id and id are DIFFERENT!`);
      }
      console.log('');
    });
    
  } finally {
    await closeAllConnections();
  }
}

async function checkIdMismatch() {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    console.log('\n🔍 Checking for ID mismatches (_id vs id)...\n');
    
    const users = await usersCollection.find({}).toArray();
    
    const mismatches = users.filter(u => {
      if (!u._id || !u.id) return false;
      return String(u._id) !== String(u.id);
    });
    
    if (mismatches.length === 0) {
      console.log('✅ No ID mismatches found');
      return;
    }
    
    console.log(`❌ Found ${mismatches.length} user(s) with ID mismatches:\n`);
    
    mismatches.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log(`  Email: ${user.email}`);
      console.log(`  _id: ${user._id}`);
      console.log(`  id: ${user.id}`);
      console.log(`  This could cause Passport to find the wrong user!`);
      console.log('');
    });
    
  } finally {
    await closeAllConnections();
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: npx tsx scripts/typescript/auth/debug-auth.ts <command> [options]

Commands:
  wrong-user [userId]
    Check for wrong user ID (default: 4a83b793-6a86-45b6-ae86-8b10ed48fb6e)

  duplicates [email]
    Find duplicate users by email (default: admin@demo.com)

  fix-duplicates [email]
    Fix duplicate admin users (default: admin@demo.com)

  find-user <email>
    Find user by email (tries multiple query variations)

  id-mismatch
    Check for users with _id/id mismatches

Examples:
  npx tsx scripts/typescript/auth/debug-auth.ts wrong-user
  npx tsx scripts/typescript/auth/debug-auth.ts duplicates admin@demo.com
  npx tsx scripts/typescript/auth/debug-auth.ts fix-duplicates
  npx tsx scripts/typescript/auth/debug-auth.ts find-user admin@demo.com
  npx tsx scripts/typescript/auth/debug-auth.ts id-mismatch
`);
    process.exit(1);
  }
  
  const command = args[0];
  
  try {
    switch (command) {
      case 'wrong-user':
        await checkWrongUser(args[1]);
        break;
        
      case 'duplicates':
        await findDuplicates(args[1]);
        break;
        
      case 'fix-duplicates':
        await fixDuplicates(args[1]);
        break;
        
      case 'find-user':
        if (!args[1]) {
          console.error('❌ Error: Email required for find-user command');
          process.exit(1);
        }
        await findUser(args[1]);
        break;
        
      case 'id-mismatch':
        await checkIdMismatch();
        break;
        
      default:
        console.error(`❌ Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
