/**
 * Bonus Clean - Cleanup bonus service data
 * 
 * Naming: bonus-clean.ts
 * 
 * Removes all bonus-related collections to start fresh
 * Use --full flag to clean everything including ledger bonus accounts
 * 
 * Usage: npx tsx scripts/typescript/bonus/bonus-clean.ts [--full]
 */

import { getBonusDatabase, closeAllConnections } from '../config/mongodb.js';

// Check for --full flag to clean everything including ledger bonus accounts
const args = process.argv.slice(2);
const fullCleanup = args.includes('--full');

async function cleanupBonusData() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CLEANUP BONUS SERVICE DATA                             ║');
  if (fullCleanup) {
    console.log('║                    FULL CLEANUP MODE                             ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  if (fullCleanup) {
    console.log('⚠️  FULL CLEANUP MODE: This will delete ALL bonus-related ledger data!\n');
  }

  try {
    const db = await getBonusDatabase();
    
    console.log('📊 Checking collections...\n');
    
    // Bonus-specific collections
    const bonusCollections = [
      'user_bonuses',
      'bonus_transactions',
      'bonus_templates',
    ];
    
    // Check what exists
    const existingCollections = await db.listCollections().toArray();
    const collectionNames = existingCollections.map(c => c.name);
    
    console.log('Found collections:', collectionNames.join(', '), '\n');
    
    // Delete bonus-specific collections
    console.log('🗑️  Deleting bonus-specific collections...');
    for (const collectionName of bonusCollections) {
      if (collectionNames.includes(collectionName)) {
        const count = await db.collection(collectionName).countDocuments();
        await db.collection(collectionName).drop();
        console.log(`   ✅ Deleted ${collectionName} (${count} documents)`);
      } else {
        console.log(`   ⏭️  ${collectionName} does not exist`);
      }
    }
    
    // Clean ledger bonus data if full cleanup
    if (fullCleanup) {
      console.log('\n🧹 Cleaning bonus-related ledger data...');
      
      // Connect to payment_service database (where ledger is stored)
      const { getPaymentDatabase } = await import('../config/mongodb.js');
      const paymentDb = await getPaymentDatabase();
      
      // Reset bonus pool account balance to 0 before deleting
      const ledgerAccounts = paymentDb.collection('ledger_accounts');
      const resetResult = await ledgerAccounts.updateMany(
        { accountId: { $regex: '^user:bonus-pool:' } },
        { $set: { balance: 0 } }
      );
      console.log(`   ✅ Reset ${resetResult.modifiedCount} bonus pool account balances to 0`);
      
      // Delete user bonus balance accounts
      const bonusAccountsResult = await ledgerAccounts.deleteMany({
        accountId: { $regex: '^user:.*:bonus$' },
      });
      console.log(`   ✅ Deleted ${bonusAccountsResult.deletedCount} user bonus balance accounts`);
      
      // Delete bonus pool accounts
      const bonusPoolResult = await ledgerAccounts.deleteMany({
        accountId: { $regex: '^user:bonus-pool:' },
      });
      console.log(`   ✅ Deleted ${bonusPoolResult.deletedCount} bonus pool accounts`);
      
      // Delete bonus-related ledger transactions
      const ledgerTransactions = paymentDb.collection('ledger_transactions');
      const bonusTxResult = await ledgerTransactions.deleteMany({
        $or: [
          { 'metadata.transactionType': { $in: ['bonus_award', 'bonus_conversion', 'bonus_forfeit'] } },
          { 'metadata.bonusId': { $exists: true } },
          { externalRef: { $regex: '^bonus-' } },
        ],
      });
      console.log(`   ✅ Deleted ${bonusTxResult.deletedCount} bonus-related ledger transactions`);
      
      // Delete bonus-related ledger entries
      const ledgerEntries = paymentDb.collection('ledger_entries');
      const bonusEntryResult = await ledgerEntries.deleteMany({
        $or: [
          { transactionId: { $in: (await ledgerTransactions.find({ 'metadata.bonusId': { $exists: true } }).map(t => t._id).toArray()) } },
          { accountId: { $regex: '^user:.*:bonus$' } },
          { accountId: { $regex: '^user:bonus-pool:' } },
        ],
      });
      console.log(`   ✅ Deleted ${bonusEntryResult.deletedCount} bonus-related ledger entries`);
    }
    
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         CLEANUP SUMMARY                            ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    console.log('✅ Bonus collections cleaned!');
    if (fullCleanup) {
      console.log('✅ Bonus-related ledger data cleaned!');
      console.log('\n⚠️  Note: Bonus pool and user bonus accounts have been deleted.');
      console.log('   The ledger system will recreate accounts on next bonus operation.');
    }
    
    console.log('\n✅ Bonus data cleaned successfully!\n');
    
  } catch (error: any) {
    console.error('\n❌ Cleanup failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await closeAllConnections();
  }
}

cleanupBonusData();
