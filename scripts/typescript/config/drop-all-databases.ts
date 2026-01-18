#!/usr/bin/env npx tsx
/**
 * Drop All MongoDB Databases
 * 
 * Drops all non-system databases (auth_service, payment_service, bonus_service, notification_service)
 * This ensures a clean slate for development.
 * 
 * Usage:
 *   npx tsx scripts/typescript/config/drop-all-databases.ts [--confirm]
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true';

// Ensure we're using localhost, not Docker hostname
const cleanUri = MONGO_URI.replace(/mongodb:\/\/ms-mongo/, 'mongodb://localhost');

async function dropAllDatabases(confirm: boolean = false) {
  if (!confirm) {
    console.log(`
⚠️  WARNING: This will DROP ALL databases!

This will delete:
  - auth_service
  - payment_service
  - bonus_service
  - notification_service
  - Any other non-system databases

System databases (admin, config, local) will be preserved.

To confirm, run with --confirm flag:
  npx tsx scripts/typescript/config/drop-all-databases.ts --confirm
`);
    process.exit(1);
  }

  const client = new MongoClient(cleanUri);
  
  try {
    await client.connect();
    console.log('\n🗑️  Dropping all non-system databases...\n');
    
    // Get list of all databases
    const adminDb = client.db().admin();
    const dbList = await adminDb.listDatabases();
    
    const systemDbs = ['admin', 'config', 'local'];
    const databasesToDrop: string[] = [];
    
    // Find all non-system databases
    for (const dbInfo of dbList.databases) {
      const dbName = dbInfo.name;
      if (!systemDbs.includes(dbName)) {
        databasesToDrop.push(dbName);
      }
    }
    
    if (databasesToDrop.length === 0) {
      console.log('✅ No databases to drop (only system databases exist)\n');
      return;
    }
    
    console.log(`📊 Found ${databasesToDrop.length} database(s) to drop:\n`);
    databasesToDrop.forEach((dbName, index) => {
      console.log(`  ${index + 1}. ${dbName}`);
    });
    console.log('');
    
    // Drop each database
    let dropped = 0;
    let errors = 0;
    
    for (const dbName of databasesToDrop) {
      try {
        const db = client.db(dbName);
        await db.dropDatabase();
        console.log(`  ✅ Dropped: ${dbName}`);
        dropped++;
      } catch (error: any) {
        console.error(`  ❌ Failed to drop ${dbName}: ${error.message}`);
        errors++;
      }
    }
    
    console.log(`\n✅ Drop complete! Dropped ${dropped} database(s), ${errors} error(s)\n`);
    
    // Verify
    const finalDbList = await adminDb.listDatabases();
    const remainingDbs = finalDbList.databases
      .map((d: any) => d.name)
      .filter((name: string) => !systemDbs.includes(name));
    
    if (remainingDbs.length === 0) {
      console.log('✅ All non-system databases have been dropped.\n');
    } else {
      console.log(`⚠️  ${remainingDbs.length} database(s) still exist: ${remainingDbs.join(', ')}\n`);
    }
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Parse arguments
const args = process.argv.slice(2);
const confirm = args.includes('--confirm');

dropAllDatabases(confirm).catch(console.error);
