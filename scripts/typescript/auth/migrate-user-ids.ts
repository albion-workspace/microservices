#!/usr/bin/env npx tsx
/**
 * Migrate User IDs - Update existing users to use MongoDB _id.toString() as id
 * 
 * This script fixes users that have UUID-based id fields to use MongoDB's _id instead.
 * 
 * Usage:
 *   npx tsx scripts/typescript/auth/migrate-user-ids.ts [--dry-run] [--email <email>]
 */

import { getAuthDatabase, closeAllConnections } from '../config/mongodb.js';

async function migrateUserIds(dryRun: boolean = false, specificEmail?: string) {
  try {
    const db = await getAuthDatabase();
    const usersCollection = db.collection('users');
    
    // Build query
    const query: any = {};
    if (specificEmail) {
      query.email = specificEmail;
    }
    
    // Find all users
    const users = await usersCollection.find(query).toArray();
    
    console.log(`\n📊 Found ${users.length} user(s) to check\n`);
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const user of users) {
      const has_id = !!user._id;
      const has_id_field = !!user.id;
      const _id_str = user._id ? user._id.toString() : null;
      const id_value = user.id;
      const needsUpdate = has_id && has_id_field && _id_str !== id_value;
      
      console.log(`User: ${user.email || 'no-email'}`);
      console.log(`  _id: ${user._id}`);
      console.log(`  id: ${id_value}`);
      console.log(`  Needs update: ${needsUpdate ? 'YES' : 'NO'}`);
      
      if (needsUpdate) {
        if (dryRun) {
          console.log(`  [DRY RUN] Would update id from "${id_value}" to "${_id_str}"`);
          skipped++;
        } else {
          try {
            await usersCollection.updateOne(
              { _id: user._id },
              { $set: { id: _id_str } }
            );
            console.log(`  ✅ Updated id to "${_id_str}"`);
            updated++;
          } catch (error: any) {
            console.log(`  ❌ Error updating: ${error.message}`);
            errors++;
          }
        }
      } else {
        skipped++;
      }
      console.log('');
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  Total users: ${users.length}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors: ${errors}`);
    
    if (dryRun) {
      console.log(`\n⚠️  DRY RUN MODE - No changes were made`);
      console.log(`   Run without --dry-run to apply changes`);
    }
    
  } finally {
    await closeAllConnections();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const emailIndex = args.indexOf('--email');
  const email = emailIndex >= 0 && args[emailIndex + 1] ? args[emailIndex + 1] : undefined;
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Usage: npx tsx scripts/typescript/auth/migrate-user-ids.ts [options]

Options:
  --dry-run          Show what would be updated without making changes
  --email <email>    Migrate only a specific user by email

Examples:
  npx tsx scripts/typescript/auth/migrate-user-ids.ts --dry-run
  npx tsx scripts/typescript/auth/migrate-user-ids.ts
  npx tsx scripts/typescript/auth/migrate-user-ids.ts --email system@demo.com
`);
    process.exit(0);
  }
  
  await migrateUserIds(dryRun, email);
}

main().catch(console.error);
