/**
 * Test Ledger Funding Directly
 * Tests if ledger transactions are being created when funding providers
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

async function testLedgerFunding() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           TESTING LEDGER FUNDING DIRECTLY                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const client = new MongoClient(MONGO_URI, { directConnection: true });
  
  try {
    await client.connect();
    const db = client.db();
    
    // Check wallet transactions
    console.log('📝 Checking Wallet Transactions...');
    const walletTxs = await db.collection('wallet_transactions')
      .find({ userId: 'system', type: 'deposit' })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    
    console.log(`Found ${walletTxs.length} system deposit wallet transactions:`);
    walletTxs.forEach(tx => {
      console.log(`  - ${tx.id}: ${(tx.amount / 100).toFixed(2)} ${tx.currency} - ${tx.description || 'N/A'}`);
    });
    
    // Check ledger transactions
    console.log('\n💰 Checking Ledger Transactions...');
    const ledgerTxs = await db.collection('ledger_transactions')
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    
    console.log(`Found ${ledgerTxs.length} ledger transactions:`);
    if (ledgerTxs.length === 0) {
      console.log('  ⚠️  NO LEDGER TRANSACTIONS FOUND - This is the problem!');
    } else {
      ledgerTxs.forEach(tx => {
        const date = tx.createdAt ? new Date(tx.createdAt).toISOString() : 'N/A';
        console.log(`  - [${tx.type}] ${tx.fromAccountId} -> ${tx.toAccountId}: ${(tx.amount / 100).toFixed(2)} ${tx.currency} - ${date}`);
      });
    }
    
    // Check ledger accounts for providers
    console.log('\n🏦 Checking Provider Ledger Accounts...');
    const providerAccounts = await db.collection('ledger_accounts')
      .find({ type: 'provider', subtype: 'deposit' })
      .toArray();
    
    console.log(`Found ${providerAccounts.length} provider deposit accounts:`);
    providerAccounts.forEach(acc => {
      console.log(`  - ${acc._id}: balance=${acc.balance} (${(acc.balance / 100).toFixed(2)}), currency=${acc.currency}`);
    });
    
    // Check system house account
    console.log('\n🏛️  Checking System House Account...');
    const houseAccount = await db.collection('ledger_accounts')
      .findOne({ type: 'system', subtype: 'house' });
    
    if (houseAccount) {
      console.log(`  System House: balance=${houseAccount.balance} (${(houseAccount.balance / 100).toFixed(2)}), currency=${houseAccount.currency}`);
    } else {
      console.log('  ⚠️  System House account NOT FOUND');
    }
    
    // Check wallets for providers
    console.log('\n💼 Checking Provider Wallets...');
    const providerWallets = await db.collection('wallets')
      .find({ userId: { $regex: '^provider-' } })
      .toArray();
    
    console.log(`Found ${providerWallets.length} provider wallets:`);
    providerWallets.forEach(w => {
      console.log(`  - ${w.userId}: balance=${w.balance} (${(w.balance / 100).toFixed(2)}), currency=${w.currency}`);
    });
    
    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         DIAGNOSIS                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    
    if (ledgerTxs.length === 0) {
      console.log('\n❌ PROBLEM: No ledger transactions found!');
      console.log('   This means recordSystemFundProviderLedgerEntry() is either:');
      console.log('   1. Not being called');
      console.log('   2. Failing silently');
      console.log('   3. Creating transactions but they\'re not being saved');
      console.log('\n   Wallet transactions exist, but ledger transactions do not.');
      console.log('   This is why balances are 0 - wallets sync from ledger, but ledger has no transactions.');
    } else {
      console.log('\n✅ Ledger transactions exist');
      if (providerAccounts.every(a => a.balance === 0)) {
        console.log('⚠️  But provider account balances are 0');
        console.log('   This might be a currency mismatch or sync issue');
      }
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testLedgerFunding();
