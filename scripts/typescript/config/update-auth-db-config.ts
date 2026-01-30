#!/usr/bin/env npx tsx
/**
 * Update Auth Service Database Config
 * 
 * Updates the auth-service database config to use core_service instead of auth_service
 * This fixes the issue where auth-service was using auth_service database
 */

import { loadScriptConfig, closeAllConnections, getCoreDatabase } from './scripts.js';
import { resolveContext, createConfigStore } from '../../../core-service/src/index.js';

async function main() {
  console.log('🔧 Updating auth-service database config...\n');
  
  try {
    // Load script config (initializes connections)
    await loadScriptConfig();
    
    // Get context
    const context = await resolveContext();
    
    // Get database using script utilities
    const database = await getCoreDatabase();
    
    // Create config store
    const configStore = createConfigStore({ database });
    
    // Update auth-service database config to use core_service
    // NOTE: mongoUri and redisUrl are NOT stored here - they come from environment variables
    // This follows CODING_STANDARDS: single source of truth, no hardcoded localhost
    console.log('📝 Updating database config for auth-service...');
    await configStore.set(
      'auth-service',
      'database',
      {
        strategy: 'shared', // Use shared strategy to ensure core_service is used
        dbNameTemplate: 'core_service', // Explicitly use core_service
        // NOTE: mongoUri and redisUrl come from MONGO_URI and REDIS_URL env vars
        // Do NOT hardcode localhost values here - see CODING_STANDARDS.md
      },
      {
        brand: context.brand,
        tenantId: context.tenantId,
        metadata: {
          description: 'Database strategy and connection configuration. Auth-service uses core_service for users.',
        },
      }
    );
    
    console.log('✅ Successfully updated auth-service database config!');
    console.log('   Strategy: shared');
    console.log('   Database: core_service');
    console.log('\n💡 Restart auth-service for changes to take effect.');
    
  } catch (error: any) {
    console.error('\n❌ Error updating config:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await closeAllConnections();
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
