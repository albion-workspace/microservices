/**
 * Payment Test Ledger - Diagnostic tool for ledger transactions
 * 
 * Naming: payment-test-ledger.ts
 * 
 * Tests if ledger transactions are being created correctly
 * 
 * Usage: npx tsx scripts/payment-test-ledger.ts
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
    
    // Check user ledger accounts
    console.log('\n👥 Checking User Ledger Accounts...');
    const userAccounts = await db.collection('ledger_accounts')
      .find({ type: 'user' })
      .limit(20)
      .toArray();
    
    console.log(`Found ${userAccounts.length} user accounts (showing first 20):`);
    userAccounts.forEach(acc => {
      const ownerId = acc.ownerId || 'N/A';
      console.log(`  - ${acc._id} (${ownerId}): balance=${acc.balance} (${(acc.balance / 100).toFixed(2)}), currency=${acc.currency}, allowNegative=${acc.allowNegative || false}`);
    });
    
    // Check wallets for payment-related users
    console.log('\n💼 Checking Payment-Related User Wallets...');
    const paymentWallets = await db.collection('wallets')
      .find({ 
        $or: [
          { userId: { $regex: '^payment-' } },
          { userId: { $regex: '^provider-' } },
          { userId: { $regex: '^test-' } },
        ]
      })
      .toArray();
    
    console.log(`Found ${paymentWallets.length} payment-related wallets:`);
    paymentWallets.forEach(w => {
      console.log(`  - ${w.userId}: balance=${w.balance} (${(w.balance / 100).toFixed(2)}), currency=${w.currency}`);
    });
    
    // Summary
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         DIAGNOSIS                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    
    if (ledgerTxs.length === 0) {
      console.log('\n❌ PROBLEM: No ledger transactions found!');
      console.log('   This means user-to-user transfers are not being recorded in ledger.');
      console.log('   Wallet transactions exist, but ledger transactions do not.');
      console.log('   This is why balances are 0 - wallets sync from ledger, but ledger has no transactions.');
    } else {
      console.log('\n✅ Ledger transactions exist');
      if (userAccounts.every(a => a.balance === 0)) {
        console.log('⚠️  But user account balances are 0');
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
