#!/usr/bin/env npx tsx
/**
 * Check Ledger Accounts - Verify system accounts were created
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

async function checkLedgerAccounts() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CHECKING LEDGER ACCOUNTS                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const client = new MongoClient(MONGO_URI, { directConnection: true });
  
  try {
    await client.connect();
    const db = client.db();
    
    // Check user accounts (simplified: all accounts are user accounts)
    console.log('👥 User Accounts:');
    const userAccounts = await db.collection('ledger_accounts')
      .find({ type: 'user' })
      .limit(20)
      .toArray();
    
    if (userAccounts.length === 0) {
      console.log('  ⚠️  NO USER ACCOUNTS FOUND');
      console.log('  → Ledger accounts will be created on first transaction');
    } else {
      console.log(`  Found ${userAccounts.length} user accounts (showing first 20):`);
      userAccounts.forEach(acc => {
        const ownerId = acc.ownerId || 'N/A';
        const allowNegative = acc.allowNegative ? ' (can go negative)' : '';
        console.log(`    - ${acc._id}`);
        console.log(`      Owner: ${ownerId}, Subtype: ${acc.subtype}, Currency: ${acc.currency}${allowNegative}`);
        console.log(`      Balance: ${(acc.balance / 100).toFixed(2)}`);
      });
    }
    
    // Check accounts by currency
    console.log('\n💰 Accounts by Currency:');
    const currencies = ['EUR', 'USD', 'GBP', 'BTC', 'ETH'];
    for (const currency of currencies) {
      const accounts = await db.collection('ledger_accounts')
        .find({ type: 'user', currency })
        .toArray();
      
      if (accounts.length > 0) {
        const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);
        console.log(`  ${currency}: ${accounts.length} accounts, Total: ${(totalBalance / 100).toFixed(2)}`);
      } else {
        console.log(`  ${currency}: No accounts found`);
      }
    }
    
    // Check accounts that can go negative (special users)
    console.log('\n🔓 Accounts with Negative Balance Permission:');
    const negativeAccounts = await db.collection('ledger_accounts')
      .find({ type: 'user', allowNegative: true })
      .toArray();
    
    console.log(`  Found ${negativeAccounts.length} accounts that can go negative:`);
    negativeAccounts.forEach(acc => {
      const ownerId = acc.ownerId || 'N/A';
      console.log(`    - ${acc._id} (${ownerId}): ${(acc.balance / 100).toFixed(2)} ${acc.currency}`);
    });
    
    // Check user accounts
    console.log('\n👥 User Accounts:');
    const userAccounts = await db.collection('ledger_accounts')
      .find({ type: 'user' })
      .limit(10)
      .toArray();
    
    console.log(`  Found ${userAccounts.length} user accounts (showing first 10)`);
    userAccounts.forEach(acc => {
      console.log(`    - ${acc._id}: ${(acc.balance / 100).toFixed(2)} ${acc.currency}`);
    });
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await closeAllConnections();
  }
}

checkLedgerAccounts();
