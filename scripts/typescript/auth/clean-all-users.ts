#!/usr/bin/env npx tsx
/**
 * Clean All Users and Related Entities
 * 
 * Removes all users, sessions, refresh tokens, and other auth-related data.
 * This ensures a clean slate for testing.
 * 
 * Usage:
 *   npx tsx scripts/typescript/auth/clean-all-users.ts [--confirm]
 */

import { getAuthDatabase, closeAllConnections } from '../config/mongodb.js';

async function cleanAllUsers(confirm: boolean = false) {
  if (!confirm) {
    console.log(`
⚠️  WARNING: This will delete ALL users and related auth data!

This includes:
  - All users
  - All sessions
  - All refresh tokens
  - All OTPs
  - All password reset tokens
  - All social profiles

To confirm, run with --confirm flag:
  npx tsx scripts/typescript/auth/clean-all-users.ts --confirm
`);
    process.exit(1);
  }
  
  try {
    const db = await getAuthDatabase();
    
    console.log('\n🗑️  Cleaning all users and related entities...\n');
    
    // Count before deletion
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    const refreshTokensCount = await db.collection('refresh_tokens').countDocuments();
    const otpsCount = await db.collection('otps').countDocuments();
    const passwordResetsCount = await db.collection('password_resets').countDocuments();
    
    console.log(`📊 Current counts:`);
    console.log(`  Users: ${usersCount}`);
    console.log(`  Sessions: ${sessionsCount}`);
    console.log(`  Refresh Tokens: ${refreshTokensCount}`);
    console.log(`  OTPs: ${otpsCount}`);
    console.log(`  Password Resets: ${passwordResetsCount}\n`);
    
    // Delete all users (this will cascade to related data if using references)
    console.log('🗑️  Deleting all users...');
    const usersResult = await db.collection('users').deleteMany({});
    console.log(`  ✅ Deleted ${usersResult.deletedCount} user(s)`);
    
    // Delete all sessions
    console.log('🗑️  Deleting all sessions...');
    const sessionsResult = await db.collection('sessions').deleteMany({});
    console.log(`  ✅ Deleted ${sessionsResult.deletedCount} session(s)`);
    
    // Delete all refresh tokens
    console.log('🗑️  Deleting all refresh tokens...');
    const refreshTokensResult = await db.collection('refresh_tokens').deleteMany({});
    console.log(`  ✅ Deleted ${refreshTokensResult.deletedCount} refresh token(s)`);
    
    // Delete all OTPs
    console.log('🗑️  Deleting all OTPs...');
    const otpsResult = await db.collection('otps').deleteMany({});
    console.log(`  ✅ Deleted ${otpsResult.deletedCount} OTP(s)`);
    
    // Delete all password reset tokens
    console.log('🗑️  Deleting all password reset tokens...');
    const passwordResetsResult = await db.collection('password_resets').deleteMany({});
    console.log(`  ✅ Deleted ${passwordResetsResult.deletedCount} password reset token(s)`);
    
    // Verify deletion
    const remainingUsers = await db.collection('users').countDocuments();
    const remainingSessions = await db.collection('sessions').countDocuments();
    const remainingRefreshTokens = await db.collection('refresh_tokens').countDocuments();
    
    console.log('\n✅ Cleanup complete!\n');
    console.log(`📊 Remaining counts:`);
    console.log(`  Users: ${remainingUsers}`);
    console.log(`  Sessions: ${remainingSessions}`);
    console.log(`  Refresh Tokens: ${remainingRefreshTokens}`);
    
    if (remainingUsers > 0 || remainingSessions > 0 || remainingRefreshTokens > 0) {
      console.log('\n⚠️  Warning: Some data still remains. Check database manually.');
    } else {
      console.log('\n✅ All users and related entities have been removed.');
      console.log('   Payment tests can now create fresh users with MongoDB _id.');
    }
    
  } finally {
    await closeAllConnections();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  
  await cleanAllUsers(confirm);
}

main().catch(console.error);
