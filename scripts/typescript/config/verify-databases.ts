#!/usr/bin/env npx tsx
/**
 * Verify Database Creation
 * 
 * Verifies that all services can connect and create databases correctly
 * after a fresh start.
 */

import { MongoClient } from 'mongodb';
import { getAuthDatabase, getPaymentDatabase, getBonusDatabase, getNotificationDatabase } from './mongodb.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true';

// Ensure we're using localhost, not Docker hostname
const cleanUri = MONGO_URI.replace(/mongodb:\/\/ms-mongo/, 'mongodb://localhost');

async function verifyDatabases() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           VERIFYING DATABASE CREATION                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const client = new MongoClient(cleanUri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    // Get list of all databases
    const adminDb = client.db().admin();
    const dbList = await adminDb.listDatabases();
    
    const systemDbs = ['admin', 'config', 'local'];
    const expectedDbs = ['auth_service', 'payment_service', 'bonus_service', 'notification_service'];
    
    console.log('📊 Current databases:\n');
    const existingDbs: string[] = [];
    for (const dbInfo of dbList.databases) {
      const dbName = dbInfo.name;
      if (!systemDbs.includes(dbName)) {
        existingDbs.push(dbName);
        const isExpected = expectedDbs.includes(dbName);
        const marker = isExpected ? '✅' : '⚠️ ';
        console.log(`  ${marker} ${dbName}`);
      }
    }
    
    if (existingDbs.length === 0) {
      console.log('  (no non-system databases found)\n');
    } else {
      console.log('');
    }
    
    // Test centralized config connections
    console.log('🔍 Testing centralized MongoDB config connections...\n');
    
    try {
      const authDb = await getAuthDatabase();
      console.log(`  ✅ Auth Service DB: ${authDb.databaseName}`);
      
      // Create a test collection to verify write access
      await authDb.collection('_test').insertOne({ test: true, createdAt: new Date() });
      await authDb.collection('_test').deleteOne({ test: true });
      console.log(`     ✓ Read/Write access verified`);
    } catch (error: any) {
      console.log(`  ❌ Auth Service DB: ${error.message}`);
    }
    
    try {
      const paymentDb = await getPaymentDatabase();
      console.log(`  ✅ Payment Service DB: ${paymentDb.databaseName}`);
      
      await paymentDb.collection('_test').insertOne({ test: true, createdAt: new Date() });
      await paymentDb.collection('_test').deleteOne({ test: true });
      console.log(`     ✓ Read/Write access verified`);
    } catch (error: any) {
      console.log(`  ❌ Payment Service DB: ${error.message}`);
    }
    
    try {
      const bonusDb = await getBonusDatabase();
      console.log(`  ✅ Bonus Service DB: ${bonusDb.databaseName}`);
      
      await bonusDb.collection('_test').insertOne({ test: true, createdAt: new Date() });
      await bonusDb.collection('_test').deleteOne({ test: true });
      console.log(`     ✓ Read/Write access verified`);
    } catch (error: any) {
      console.log(`  ❌ Bonus Service DB: ${error.message}`);
    }
    
    try {
      const notificationDb = await getNotificationDatabase();
      console.log(`  ✅ Notification Service DB: ${notificationDb.databaseName}`);
      
      await notificationDb.collection('_test').insertOne({ test: true, createdAt: new Date() });
      await notificationDb.collection('_test').deleteOne({ test: true });
      console.log(`     ✓ Read/Write access verified`);
    } catch (error: any) {
      console.log(`  ❌ Notification Service DB: ${error.message}`);
    }
    
    console.log('\n✅ Database verification complete!\n');
    
    // Check for any databases with trailing spaces or %20
    const problematicDbs = existingDbs.filter(db => db.includes('%20') || db.endsWith(' '));
    if (problematicDbs.length > 0) {
      console.log('⚠️  WARNING: Found databases with trailing spaces or %20 encoding:\n');
      problematicDbs.forEach(db => {
        console.log(`  ⚠️  ${db}`);
      });
      console.log('\nThese should be cleaned up.\n');
    } else {
      console.log('✅ All database names are clean (no trailing spaces or %20 encoding)\n');
    }
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  } finally {
    await client.close();
    const { closeAllConnections } = await import('./mongodb.js');
    await closeAllConnections();
  }
}

verifyDatabases().catch(console.error);
