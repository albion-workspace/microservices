#!/usr/bin/env npx tsx
/**
 * Unified Auth Check Script
 * 
 * Performs various checks on auth service data (users, sessions, passwords, etc.)
 * 
 * Usage:
 *   npx tsx scripts/typescript/auth/check-auth.ts admin              # Check admin user
 *   npx tsx scripts/typescript/auth/check-auth.ts admin --password   # Check admin password
 *   npx tsx scripts/typescript/auth/check-auth.ts admin --duplicates # Check for duplicate admins
 *   npx tsx scripts/typescript/auth/check-auth.ts user <email>      # Check specific user
 *   npx tsx scripts/typescript/auth/check-auth.ts users              # List all users
 *   npx tsx scripts/typescript/auth/check-auth.ts sessions          # Check sessions
 *   npx tsx scripts/typescript/auth/check-auth.ts password <email>  # Check password match
 *   npx tsx scripts/typescript/auth/check-auth.ts document <email>  # Check user document structure
 */

import { getAuthDatabase, closeAllConnections } from '../config/mongodb.js';

const DEFAULT_ADMIN_EMAIL = 'admin@demo.com';
const DEFAULT_TENANT_ID = 'default-tenant';
const DEFAULT_PASSWORD = 'Admin123!@#';

interface CheckOptions {
  password?: boolean;
  duplicates?: boolean;
  all?: boolean;
  tenantId?: string;
  verbose?: boolean;
}

async function connectDB() {
  const db = await getAuthDatabase();
  return { db };
}

async function checkAdmin(options: CheckOptions = {}) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    // Find admin users
    const query: any = {
      $or: [
        { email: DEFAULT_ADMIN_EMAIL },
        { email: DEFAULT_ADMIN_EMAIL.toUpperCase() },
        { email: /^admin@demo\.com$/i },
      ]
    };
    
    if (options.tenantId) {
      query.tenantId = options.tenantId;
    }
    
    const adminUsers = await usersCollection.find(query).toArray();
    
    console.log(`\n📊 Found ${adminUsers.length} admin user(s):\n`);
    
    adminUsers.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log(`  ID: ${user.id || user._id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Tenant ID: ${user.tenantId}`);
      console.log(`  Roles: ${JSON.stringify(user.roles || [])}`);
      console.log(`  Permissions: ${JSON.stringify(user.permissions || [])}`);
      if (options.password) {
        console.log(`  Password Hash: ${user.passwordHash ? 'exists' : 'missing'}`);
        if (user.passwordHash === DEFAULT_PASSWORD) {
          console.log(`  ⚠️  Password is stored as plain text!`);
        }
      }
      if (options.verbose) {
        console.log(`  Created: ${user.createdAt}`);
        console.log(`  Updated: ${user.updatedAt}`);
      }
      console.log('');
    });
    
    // Check for duplicates
    if (options.duplicates || adminUsers.length > 1) {
      if (adminUsers.length > 1) {
        console.log('❌ PROBLEM: Multiple admin users found!');
        const correctAdmin = adminUsers.find(u => 
          Array.isArray(u.roles) && (u.roles.includes('admin') || u.roles.includes('system'))
        );
        const wrongAdmins = adminUsers.filter(u => 
          Array.isArray(u.roles) && u.roles.length === 1 && u.roles[0] === 'user'
        );
        
        if (correctAdmin) {
          console.log(`✅ Correct admin: ${correctAdmin.id}`);
        }
        if (wrongAdmins.length > 0) {
          console.log(`❌ Wrong admin(s): ${wrongAdmins.map(u => u.id).join(', ')}`);
        }
      } else {
        console.log('✅ No duplicates found');
      }
    }
    
    // Check password if requested
    if (options.password && adminUsers.length > 0) {
      const adminUser = adminUsers[0];
      console.log('\n🔐 Password Check:');
      console.log(`  Stored Hash: ${adminUser.passwordHash}`);
      console.log(`  Expected: ${DEFAULT_PASSWORD}`);
      console.log(`  Match: ${adminUser.passwordHash === DEFAULT_PASSWORD}`);
      
      if (adminUser.passwordHash !== DEFAULT_PASSWORD) {
        console.log('\n⚠️  Password mismatch detected!');
      }
    }
    
    // List all users if requested
    if (options.all) {
      const allUsers = await usersCollection.find({}).toArray();
      console.log(`\n📊 Total users in database: ${allUsers.length}`);
      allUsers.forEach((user, idx) => {
        console.log(`  ${idx + 1}. ${user.email || 'no-email'} (${user.id || user._id}) - Roles: ${JSON.stringify(user.roles || [])}`);
      });
    }
    
  } finally {
    await closeAllConnections();
  }
}

async function checkUser(email: string, options: CheckOptions = {}) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    const query: any = {
      $or: [
        { email: email },
        { email: email.toLowerCase() },
        { email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      ]
    };
    
    if (options.tenantId) {
      query.tenantId = options.tenantId;
    }
    
    const users = await usersCollection.find(query).toArray();
    
    if (users.length === 0) {
      console.log(`❌ No user found with email: ${email}`);
      return;
    }
    
    console.log(`\n📊 Found ${users.length} user(s) with email ${email}:\n`);
    
    users.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log(`  ID: ${user.id || user._id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Tenant ID: ${user.tenantId}`);
      console.log(`  Roles: ${JSON.stringify(user.roles || [])}`);
      console.log(`  Permissions: ${JSON.stringify(user.permissions || [])}`);
      if (options.password) {
        console.log(`  Password Hash: ${user.passwordHash ? 'exists' : 'missing'}`);
      }
      if (options.verbose) {
        console.log(`  Created: ${user.createdAt}`);
        console.log(`  Updated: ${user.updatedAt}`);
        console.log(`  Document keys: ${Object.keys(user).join(', ')}`);
        if (user._id && user.id && String(user._id) !== String(user.id)) {
          console.log(`  ⚠️  WARNING: _id and id are DIFFERENT!`);
          console.log(`     _id: ${user._id}`);
          console.log(`     id: ${user.id}`);
        }
      }
      console.log('');
    });
    
  } finally {
    await closeAllConnections();
  }
}

async function checkUsers(options: CheckOptions = {}) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    const query: any = {};
    if (options.tenantId) {
      query.tenantId = options.tenantId;
    }
    
    const users = await usersCollection.find(query).toArray();
    
    console.log(`\n📊 Total users: ${users.length}\n`);
    
    // Group by roles
    const byRole: Record<string, any[]> = {};
    users.forEach((user: any) => {
      const roles = Array.isArray(user.roles) ? user.roles : [];
      if (roles.length === 0) {
        const key = 'no-role';
        if (!byRole[key]) byRole[key] = [];
        byRole[key].push(user);
      } else {
        roles.forEach((role: string) => {
          if (!byRole[role]) byRole[role] = [];
          byRole[role].push(user);
        });
      }
    });
    
    Object.entries(byRole).forEach(([role, roleUsers]) => {
      console.log(`\n👥 Users with role '${role}': ${roleUsers.length}`);
      roleUsers.forEach((u: any) => {
        console.log(`  - ${u.email || 'no-email'} (${u.id || u._id})`);
      });
    });
    
    if (options.verbose) {
      console.log('\n📋 All users:');
      users.forEach((user, idx) => {
        console.log(`  ${idx + 1}. ${user.email || 'no-email'} (${user.id || user._id})`);
        console.log(`     Roles: ${JSON.stringify(user.roles || [])}`);
        console.log(`     Permissions: ${JSON.stringify(user.permissions || [])}`);
      });
    }
    
  } finally {
    await closeAllConnections();
  }
}

async function checkSessions(userId?: string) {
  const { client, db } = await connectDB();
  try {
    const sessionsCollection = db.collection('sessions');
    
    const query: any = {};
    if (userId) {
      query.userId = userId;
    }
    
    const sessions = await sessionsCollection.find(query).toArray();
    
    console.log(`\n📊 Found ${sessions.length} session(s)${userId ? ` for user ${userId}` : ''}:\n`);
    
    if (sessions.length === 0) {
      console.log('No sessions found');
      return;
    }
    
    sessions.forEach((session, idx) => {
      console.log(`Session ${idx + 1}:`);
      console.log(`  Session ID: ${session.sessionId || session.id}`);
      console.log(`  User ID: ${session.userId}`);
      console.log(`  Created: ${session.createdAt}`);
      console.log(`  Last Accessed: ${session.lastAccessedAt}`);
      console.log(`  Valid: ${session.isValid}`);
      if (session.deviceInfo) {
        console.log(`  Device: ${JSON.stringify(session.deviceInfo)}`);
      }
      console.log('');
    });
    
    // Summary
    const validSessions = sessions.filter(s => s.isValid !== false);
    const invalidSessions = sessions.filter(s => s.isValid === false);
    
    console.log(`\n📊 Summary:`);
    console.log(`  Valid sessions: ${validSessions.length}`);
    console.log(`  Invalid sessions: ${invalidSessions.length}`);
    
  } finally {
    await closeAllConnections();
  }
}

async function checkPassword(email: string, expectedPassword?: string) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    const user = await usersCollection.findOne({
      email: email,
      tenantId: DEFAULT_TENANT_ID
    });
    
    if (!user) {
      console.log(`❌ User not found: ${email}`);
      return;
    }
    
    console.log(`\n🔐 Password Check for ${email}:`);
    console.log(`  User ID: ${user.id || user._id}`);
    console.log(`  Stored Hash: ${user.passwordHash || 'missing'}`);
    
    if (expectedPassword) {
      console.log(`  Expected: ${expectedPassword}`);
      console.log(`  Match: ${user.passwordHash === expectedPassword}`);
      
      if (user.passwordHash !== expectedPassword) {
        console.log('\n⚠️  Password mismatch!');
      } else if (user.passwordHash === expectedPassword) {
        console.log('\n⚠️  Password is stored as plain text (security risk)!');
      }
    }
    
  } finally {
    await closeAllConnections();
  }
}

async function checkDocument(email: string) {
  const { client, db } = await connectDB();
  try {
    const usersCollection = db.collection('users');
    
    const user = await usersCollection.findOne({
      email: email,
      tenantId: DEFAULT_TENANT_ID
    });
    
    if (!user) {
      console.log(`❌ User not found: ${email}`);
      return;
    }
    
    console.log(`\n📄 User Document Structure for ${email}:`);
    console.log(`  Keys: ${Object.keys(user).join(', ')}`);
    console.log(`  Has _id: ${!!user._id} (Value: ${user._id})`);
    console.log(`  Has id: ${!!user.id} (Value: ${user.id})`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Tenant ID: ${user.tenantId}`);
    console.log(`  Roles: ${JSON.stringify(user.roles)}`);
    console.log(`  Permissions: ${JSON.stringify(user.permissions)}`);
    
    // Check for ID mismatch
    if (user._id && user.id && String(user._id) !== String(user.id)) {
      console.log('\n⚠️  WARNING: _id and id are DIFFERENT!');
      console.log(`  _id: ${user._id}`);
      console.log(`  id: ${user.id}`);
      console.log('  This could cause Passport to find the wrong user!');
    } else if (user._id && !user.id) {
      console.log('\n⚠️  WARNING: User has _id but no id field!');
    } else if (!user._id && user.id) {
      console.log('\n⚠️  WARNING: User has id but no _id field!');
    } else {
      console.log('\n✅ ID fields are consistent');
    }
    
  } finally {
    await closeAllConnections();
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: npx tsx scripts/typescript/auth/check-auth.ts <command> [options]

Commands:
  admin [--password] [--duplicates] [--all] [--verbose]
    Check admin user(s)
    --password      Check password hash
    --duplicates    Check for duplicate admin users
    --all           List all users in database
    --verbose       Show detailed information

  user <email> [--password] [--verbose]
    Check specific user
    --password      Check password hash
    --verbose       Show detailed information

  users [--verbose]
    List all users grouped by role
    --verbose       Show detailed information for each user

  sessions [userId]
    Check sessions (optionally for specific user)

  password <email> [expectedPassword]
    Check password for user

  document <email>
    Check user document structure

Examples:
  npx tsx scripts/typescript/auth/check-auth.ts admin
  npx tsx scripts/typescript/auth/check-auth.ts admin --password --duplicates
  npx tsx scripts/typescript/auth/check-auth.ts user admin@demo.com --verbose
  npx tsx scripts/typescript/auth/check-auth.ts users
  npx tsx scripts/typescript/auth/check-auth.ts sessions
  npx tsx scripts/typescript/auth/check-auth.ts password admin@demo.com Admin123!@#
  npx tsx scripts/typescript/auth/check-auth.ts document admin@demo.com
`);
    process.exit(1);
  }
  
  const command = args[0];
  const options: CheckOptions = {
    password: args.includes('--password'),
    duplicates: args.includes('--duplicates'),
    all: args.includes('--all'),
    verbose: args.includes('--verbose'),
    tenantId: args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : undefined,
  };
  
  try {
    switch (command) {
      case 'admin':
        await checkAdmin(options);
        break;
        
      case 'user':
        if (!args[1]) {
          console.error('❌ Error: Email required for user command');
          process.exit(1);
        }
        await checkUser(args[1], options);
        break;
        
      case 'users':
        await checkUsers(options);
        break;
        
      case 'sessions':
        await checkSessions(args[1]);
        break;
        
      case 'password':
        if (!args[1]) {
          console.error('❌ Error: Email required for password command');
          process.exit(1);
        }
        await checkPassword(args[1], args[2]);
        break;
        
      case 'document':
        if (!args[1]) {
          console.error('❌ Error: Email required for document command');
          process.exit(1);
        }
        await checkDocument(args[1]);
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
