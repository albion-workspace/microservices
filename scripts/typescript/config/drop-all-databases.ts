#!/usr/bin/env npx tsx
/**
 * Drop All Databases Script
 * 
 * Drops all service databases:
 * - auth_service
 * - payment_service
 * - bonus_service
 * - notification_service
 * 
 * Usage: npx tsx scripts/typescript/config/drop-all-databases.ts
 */

import {
  getAuthClient,
  getPaymentClient,
  getBonusClient,
  getNotificationClient,
  closeAllConnections,
} from './mongodb.js';

const DATABASES = [
  { name: 'auth_service', getClient: getAuthClient },
  { name: 'payment_service', getClient: getPaymentClient },
  { name: 'bonus_service', getClient: getBonusClient },
  { name: 'notification_service', getClient: getNotificationClient },
] as const;

async function dropAllDatabases() {
  console.log('🗑️  Dropping all databases...\n');

  for (const { name, getClient } of DATABASES) {
    try {
      console.log(`📦 Dropping database: ${name}`);
      const client = await getClient();
      const db = client.db(name);
      
      // Drop the database
      await db.dropDatabase();
      console.log(`✅ Successfully dropped: ${name}\n`);
    } catch (error) {
      console.error(`❌ Error dropping ${name}:`, error instanceof Error ? error.message : String(error));
      // Continue with other databases even if one fails
    }
  }

  // Close all connections
  await closeAllConnections();
  console.log('✅ All databases dropped successfully!');
}

// Run the script
dropAllDatabases()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
