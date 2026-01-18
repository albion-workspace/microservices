#!/usr/bin/env npx tsx
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

async function checkDeposits() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const graphqlTxs = db.collection('transactions');
    const ledgerTxs = db.collection('ledger_transactions');
    
    // Get recent GraphQL deposits
    const recentGraphQL = await graphqlTxs.find({ 
      type: 'deposit',
      userId: { $regex: /^duplicate-test-/ }
    })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
    
    console.log(`\n📊 Found ${recentGraphQL.length} recent GraphQL deposits:\n`);
    
    // Group by timestamp to find duplicates
    const byTimestamp = new Map<string, any[]>();
    recentGraphQL.forEach(tx => {
      const key = tx.createdAt?.toString() || 'unknown';
      if (!byTimestamp.has(key)) {
        byTimestamp.set(key, []);
      }
      byTimestamp.get(key)!.push(tx);
    });
    
    // Show duplicates
    const duplicates = Array.from(byTimestamp.entries()).filter(([_, txs]) => txs.length > 1);
    console.log(`🔍 Found ${duplicates.length} duplicate timestamps:\n`);
    duplicates.slice(0, 5).forEach(([timestamp, txs]) => {
      console.log(`  Timestamp: ${timestamp}`);
      console.log(`    Count: ${txs.length}`);
      console.log(`    Transaction IDs: ${txs.map(t => t.id).join(', ')}`);
      console.log(`    Statuses: ${txs.map(t => t.status).join(', ')}`);
      console.log('');
    });
    
    // Get corresponding ledger transactions
    const graphqlIds = recentGraphQL.map(tx => tx.id);
    const ledgerTxsFound = await ledgerTxs.find({
      'metadata.fromUserId': { $exists: true },
      'metadata.toUserId': { $exists: true }
    })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
    
    console.log(`\n💰 Found ${ledgerTxsFound.length} recent ledger transactions:\n`);
    
    // Group by externalRef to find duplicates
    const byExternalRef = new Map<string, any[]>();
    ledgerTxsFound.forEach(tx => {
      if (tx.externalRef) {
        if (!byExternalRef.has(tx.externalRef)) {
          byExternalRef.set(tx.externalRef, []);
        }
        byExternalRef.get(tx.externalRef)!.push(tx);
      }
    });
    
    const duplicateRefs = Array.from(byExternalRef.entries()).filter(([_, txs]) => txs.length > 1);
    console.log(`🔍 Found ${duplicateRefs.length} duplicate externalRefs in ledger:\n`);
    duplicateRefs.slice(0, 5).forEach(([externalRef, txs]) => {
      console.log(`  externalRef: ${externalRef}`);
      console.log(`    Count: ${txs.length}`);
      console.log(`    Transaction IDs: ${txs.map(t => t._id).join(', ')}`);
      console.log(`    Statuses: ${txs.map(t => t.status).join(', ')}`);
      console.log(`    Created: ${txs.map(t => t.createdAt).join(', ')}`);
      console.log('');
    });
    
    // Show sample ledger transactions
    console.log(`\n📋 Sample ledger transactions (last 10):\n`);
    ledgerTxsFound.slice(0, 10).forEach(tx => {
      console.log(`  ID: ${tx._id}`);
      console.log(`    externalRef: ${tx.externalRef || '(null)'}`);
      console.log(`    Type: ${tx.type}`);
      console.log(`    Status: ${tx.status}`);
      console.log(`    Amount: ${tx.amount} ${tx.currency}`);
      console.log(`    From: ${tx.metadata?.fromUserId || 'N/A'}`);
      console.log(`    To: ${tx.metadata?.toUserId || 'N/A'}`);
      console.log(`    Created: ${tx.createdAt}`);
      console.log('');
    });
    
  } catch (error: any) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

checkDeposits().catch(console.error);
