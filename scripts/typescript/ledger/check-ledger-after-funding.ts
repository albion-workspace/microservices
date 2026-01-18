#!/usr/bin/env npx tsx
/**
 * Check Ledger After Funding - Verify ledger transactions are created
 */

import { getPaymentDatabase, closeAllConnections } from '../config/mongodb.js';

async function checkLedgerAfterFunding() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CHECKING LEDGER AFTER FUNDING                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    const db = await getPaymentDatabase();
    
    // Check recent ledger transactions
    console.log('💰 Recent Ledger Transactions (last 10):\n');
    const recentTxs = await db.collection('ledger_transactions')
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    
    if (recentTxs.length === 0) {
      console.log('  ⚠️  NO LEDGER TRANSACTIONS FOUND');
    } else {
      recentTxs.forEach((tx, idx) => {
        const date = tx.createdAt ? new Date(tx.createdAt).toISOString() : 'N/A';
        console.log(`  ${idx + 1}. [${tx.type}] ${tx.fromAccountId} -> ${tx.toAccountId}`);
        console.log(`     Amount: ${(tx.amount / 100).toFixed(2)} ${tx.currency}`);
        console.log(`     Date: ${date}`);
        console.log(`     ExternalRef: ${tx.externalRef || 'N/A'}`);
        if (tx.metadata) {
          console.log(`     Metadata: ${JSON.stringify(tx.metadata)}`);
        }
        console.log('');
      });
    }
    
    // Check system house accounts
    console.log('🏛️  System House Accounts:\n');
    const systemHouseAccounts = await db.collection('ledger_accounts')
      .find({ type: 'system', subtype: 'house' })
      .toArray();
    
    systemHouseAccounts.forEach(acc => {
      console.log(`  ${acc._id}:`);
      console.log(`    Currency: ${acc.currency}`);
      console.log(`    Balance: ${(acc.balance / 100).toFixed(2)}`);
      console.log(`    Available: ${(acc.availableBalance / 100).toFixed(2)}`);
      console.log(`    Pending In: ${(acc.pendingIn / 100).toFixed(2)}`);
      console.log(`    Pending Out: ${(acc.pendingOut / 100).toFixed(2)}`);
      console.log('');
    });
    
    // Check provider accounts
    console.log('💳 Provider Accounts:\n');
    const providerAccounts = await db.collection('ledger_accounts')
      .find({ type: 'provider' })
      .toArray();
    
    providerAccounts.forEach(acc => {
      console.log(`  ${acc._id}:`);
      console.log(`    Currency: ${acc.currency}`);
      console.log(`    Balance: ${(acc.balance / 100).toFixed(2)}`);
      console.log(`    Available: ${(acc.availableBalance / 100).toFixed(2)}`);
      console.log('');
    });
    
    // Check user accounts
    console.log('👥 User Accounts (last 5):\n');
    const userAccounts = await db.collection('ledger_accounts')
      .find({ type: 'user' })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    
    userAccounts.forEach(acc => {
      console.log(`  ${acc._id}:`);
      console.log(`    Currency: ${acc.currency}`);
      console.log(`    Balance: ${(acc.balance / 100).toFixed(2)}`);
      console.log('');
    });
    
    // Summary
    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         SUMMARY                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    const totalSystemBalance = systemHouseAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
    const totalProviderBalance = providerAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
    const totalUserBalance = userAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
    
    console.log(`Total System House Balance: ${(totalSystemBalance / 100).toFixed(2)}`);
    console.log(`Total Provider Balance: ${(totalProviderBalance / 100).toFixed(2)}`);
    console.log(`Total User Balance (sample): ${(totalUserBalance / 100).toFixed(2)}`);
    console.log(`Total Ledger Transactions: ${recentTxs.length}`);
    
    // Check for funding transactions
    const fundingTxs = recentTxs.filter(tx => 
      tx.metadata?.fundingType === 'provider' || 
      tx.fromAccountId?.includes('system:house') && tx.toAccountId?.includes('provider:')
    );
    
    if (fundingTxs.length > 0) {
      console.log(`\n✅ Found ${fundingTxs.length} provider funding transactions`);
    } else {
      console.log(`\n⚠️  No provider funding transactions found`);
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await closeAllConnections();
  }
}

checkLedgerAfterFunding();
