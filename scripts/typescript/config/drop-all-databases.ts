#!/usr/bin/env npx tsx
/**
 * Drop All Databases Script
 * 
 * Drops all service databases using database strategy from config store.
 * Supports per-service, per-brand, per-tenant strategies.
 * 
 * Usage: 
 *   npx tsx scripts/typescript/config/drop-all-databases.ts
 *   npx tsx scripts/typescript/config/drop-all-databases.ts --brand brand-a
 *   npx tsx scripts/typescript/config/drop-all-databases.ts --tenant tenant-123
 */

import {
  dropAllDatabases as dropDatabases,
  closeAllConnections,
  parseBrandTenantArgs,
  getErrorMessage,
} from './scripts.js';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments using utility function
  const { brand, tenantId } = parseBrandTenantArgs(args);

  console.log('🗑️  Dropping all service databases...\n');
  
  if (brand) {
    console.log(`📌 Strategy: per-brand (brand: ${brand})`);
    console.log(`   Will drop databases for brand: ${brand}\n`);
  } else if (tenantId) {
    console.log(`📌 Strategy: per-tenant (tenant: ${tenantId})`);
    console.log(`   Will drop databases for tenant: ${tenantId}\n`);
  } else {
    console.log(`📌 Strategy: per-service (default - no brand/tenant)`);
    console.log(`   Will drop: core_service, payment_service, bonus_service, notification_service\n`);
  }

  try {
    const dropped = await dropDatabases({ brand, tenantId });
    
    console.log(`\n✅ Successfully dropped ${dropped.length} database(s):`);
    dropped.forEach(dbName => console.log(`   - ${dbName}`));
    console.log('\n✨ Done!');
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    // Close all connections (with timeout to prevent hanging)
    try {
      await Promise.race([
        closeAllConnections(),
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error('Connection close timed out')), 3000)
        )
      ]);
    } catch (error) {
      // Non-fatal - connections will be recreated when needed
      console.warn(`⚠️  Connection close: ${getErrorMessage(error)} (non-fatal)`);
    }
  }
}

// Run the script
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
