/**
 * Payment Clean - Cleanup payment service data
 * 
 * Naming: payment-clean.ts
 * 
 * Removes all payment-related collections to start fresh
 * Use --full flag to clean everything including bonus and system accounts
 * 
 * Usage: npx tsx scripts/payment-clean.ts [--full]
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

// Check for --full flag to clean everything including system accounts and bonus data
const args = process.argv.slice(2);
const fullCleanup = args.includes('--full');

async function cleanupPaymentData() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CLEANUP PAYMENT SERVICE DATA                          ║');
  if (fullCleanup) {
    console.log('║                    FULL CLEANUP MODE                             ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  if (fullCleanup) {
    console.log('⚠️  FULL CLEANUP MODE: This will delete ALL ledger data including system accounts and bonus data!\n');
  }

  const client = new MongoClient(MONGO_URI, { directConnection: true });
  
  try {
    await client.connect();
    const db = client.db();
    
    console.log('📊 Checking collections...\n');
    
    // Payment-specific collections
    const paymentCollections = [
      'wallets',
      'wallet_transactions',
      'deposits',
      'withdrawals',
      'transactions', // Deposits/withdrawals are stored here
      'provider_configs',
      'payment_webhooks',
      'payment_webhook_deliveries',
    ];
    
    // Bonus-related collections (if full cleanup)
    const bonusCollections = fullCleanup ? [
      'user_bonuses',
      'bonus_transactions',
    ] : [];
    
    // Check what exists
    const existingCollections = await db.listCollections().toArray();
    const collectionNames = existingCollections.map(c => c.name);
    
    console.log('Found collections:', collectionNames.join(', '), '\n');
    
    // Delete payment-specific collections
    console.log('🗑️  Deleting payment-specific collections...');
    for (const collectionName of paymentCollections) {
      if (collectionNames.includes(collectionName)) {
        const count = await db.collection(collectionName).countDocuments();
        await db.collection(collectionName).drop();
        console.log(`   ✅ Deleted ${collectionName} (${count} documents)`);
      } else {
        console.log(`   ⏭️  ${collectionName} does not exist`);
      }
    }
    
    // Delete bonus collections if full cleanup
    if (fullCleanup && bonusCollections.length > 0) {
      console.log('\n🗑️  Deleting bonus-related collections...');
      for (const collectionName of bonusCollections) {
        if (collectionNames.includes(collectionName)) {
          const count = await db.collection(collectionName).countDocuments();
          await db.collection(collectionName).drop();
          console.log(`   ✅ Deleted ${collectionName} (${count} documents)`);
        } else {
          console.log(`   ⏭️  ${collectionName} does not exist`);
        }
      }
    }
    
    // Clean ledger data related to payments
    console.log('\n🧹 Cleaning payment-related ledger data...');
    
    // Reset all ledger account balances to 0 first (before deleting accounts)
    if (collectionNames.includes('ledger_accounts')) {
      const resetResult = await db.collection('ledger_accounts').updateMany(
        {},
        { $set: { balance: 0 } }
      );
      console.log(`   ✅ Reset ${resetResult.modifiedCount} ledger account balances to 0`);
    }
    
    // Delete user accounts (simplified: all accounts are user accounts)
    if (collectionNames.includes('ledger_accounts')) {
      // Only delete user accounts created for payments (not system accounts like fee-collection, bonus-pool)
      const userAccounts = await db.collection('ledger_accounts')
        .deleteMany({ 
          type: 'user',
          ownerId: { $exists: true, $ne: null },
          $or: [
            { ownerId: { $regex: '^test-' } },
            { ownerId: { $regex: '^payment-' } },
            { ownerId: { $regex: '^provider-' } },
          ]
        });
      console.log(`   ✅ Deleted ${userAccounts.deletedCount} payment-related user ledger accounts`);
    }
    
    // Delete bonus accounts if full cleanup
    if (fullCleanup && collectionNames.includes('ledger_accounts')) {
      const bonusAccounts = await db.collection('ledger_accounts')
        .deleteMany({ type: 'user', subtype: 'bonus' });
      console.log(`   ✅ Deleted ${bonusAccounts.deletedCount} user bonus balance accounts`);
      
      const bonusPoolAccounts = await db.collection('ledger_accounts')
        .deleteMany({ type: 'system', subtype: 'bonus_pool' });
      console.log(`   ✅ Deleted ${bonusPoolAccounts.deletedCount} bonus pool accounts`);
    }
    
    // Delete system accounts if full cleanup
    if (fullCleanup && collectionNames.includes('ledger_accounts')) {
      const systemAccounts = await db.collection('ledger_accounts')
        .deleteMany({ type: 'system' });
      console.log(`   ✅ Deleted ${systemAccounts.deletedCount} system ledger accounts`);
    }
    
    // Delete payment-related transactions (transfers involving providers or users)
    if (collectionNames.includes('ledger_transactions')) {
      const paymentTxs = await db.collection('ledger_transactions')
        .deleteMany({
          $or: [
            { 'metadata.fundingType': 'provider' },
            { 'metadata.providerId': { $exists: true } },
            { fromAccountId: { $regex: '^provider:' } },
            { toAccountId: { $regex: '^provider:' } },
            { fromAccountId: { $regex: '^user:.*:real$' } },
            { toAccountId: { $regex: '^user:.*:real$' } },
          ]
        });
      console.log(`   ✅ Deleted ${paymentTxs.deletedCount} payment-related ledger transactions`);
    }
    
    // Delete bonus-related transactions if full cleanup
    if (fullCleanup && collectionNames.includes('ledger_transactions')) {
      const bonusTxs = await db.collection('ledger_transactions')
        .deleteMany({
          $or: [
            { type: { $in: ['bonus_award', 'bonus_conversion', 'bonus_forfeit'] } },
            { fromAccountId: { $regex: '^user:.*:bonus$' } },
            { toAccountId: { $regex: '^user:.*:bonus$' } },
            { fromAccountId: { $regex: '^system:bonus_pool' } },
            { toAccountId: { $regex: '^system:bonus_pool' } },
          ]
        });
      console.log(`   ✅ Deleted ${bonusTxs.deletedCount} bonus-related ledger transactions`);
    }
    
    // Delete all transactions if full cleanup
    if (fullCleanup && collectionNames.includes('ledger_transactions')) {
      const allTxs = await db.collection('ledger_transactions').countDocuments();
      if (allTxs > 0) {
        await db.collection('ledger_transactions').deleteMany({});
        console.log(`   ✅ Deleted all remaining ${allTxs} ledger transactions`);
      }
    }
    
    // Delete entries for deleted accounts
    if (collectionNames.includes('ledger_entries')) {
      const providerEntries = await db.collection('ledger_entries')
        .deleteMany({ accountId: { $regex: '^provider:' } });
      console.log(`   ✅ Deleted ${providerEntries.deletedCount} provider ledger entries`);
      
      const userEntries = await db.collection('ledger_entries')
        .deleteMany({ accountId: { $regex: '^user:.*:real$' } });
      console.log(`   ✅ Deleted ${userEntries.deletedCount} user real balance ledger entries`);
    }
    
    // Delete bonus entries if full cleanup
    if (fullCleanup && collectionNames.includes('ledger_entries')) {
      const bonusEntries = await db.collection('ledger_entries')
        .deleteMany({ accountId: { $regex: '^user:.*:bonus$' } });
      console.log(`   ✅ Deleted ${bonusEntries.deletedCount} user bonus balance ledger entries`);
      
      const bonusPoolEntries = await db.collection('ledger_entries')
        .deleteMany({ accountId: { $regex: '^system:bonus_pool' } });
      console.log(`   ✅ Deleted ${bonusPoolEntries.deletedCount} bonus pool ledger entries`);
    }
    
    // Delete all entries if full cleanup
    if (fullCleanup && collectionNames.includes('ledger_entries')) {
      const allEntries = await db.collection('ledger_entries').countDocuments();
      if (allEntries > 0) {
        await db.collection('ledger_entries').deleteMany({});
        console.log(`   ✅ Deleted all remaining ${allEntries} ledger entries`);
      }
    }
    
    // Drop and recreate the externalRef index to clear any duplicate null key issues
    if (collectionNames.includes('ledger_transactions')) {
      try {
        await db.collection('ledger_transactions').dropIndex('externalRef_1');
        console.log('   ✅ Dropped externalRef index');
      } catch (e: any) {
        if (!e.message?.includes('index not found')) {
          console.log(`   ⚠️  Could not drop externalRef index: ${e.message}`);
        }
      }
      
      // The index will be recreated on next ledger initialization
    }
    
    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         CLEANUP SUMMARY                            ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    console.log('\n✅ Payment collections cleaned!');
    console.log('✅ Payment-related ledger data cleaned!');
    if (fullCleanup) {
      console.log('✅ Bonus collections cleaned!');
      console.log('✅ All ledger data cleaned!');
      console.log('\n⚠️  Note: All ledger accounts, transactions, and entries have been deleted.');
      console.log('   The ledger system will recreate system accounts on next initialization.');
    } else {
      console.log('\n⚠️  Note: System accounts and bonus-related accounts were preserved.');
      console.log('   To clean everything including ledger, run with --full flag.\n');
    }
    
  } catch (error: any) {
    console.error('\n❌ Cleanup failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

cleanupPaymentData();
