#!/usr/bin/env npx tsx
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

async function checkDuplicates() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const txs = db.collection('ledger_transactions');
    
    // Find duplicate externalRefs
    const duplicates = await txs.aggregate([
      { $match: { externalRef: { $exists: true, $ne: null } } },
      { $group: { 
          _id: '$externalRef', 
          count: { $sum: 1 }, 
          txIds: { $push: '$_id' },
          statuses: { $push: '$status' }
        } 
      },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    console.log(`\n🔍 Found ${duplicates.length} duplicate externalRefs:\n`);
    duplicates.slice(0, 10).forEach(dup => {
      console.log(`  externalRef: ${dup._id}`);
      console.log(`    Count: ${dup.count}`);
      console.log(`    Statuses: ${dup.statuses.join(', ')}`);
      console.log(`    Transaction IDs: ${dup.txIds.slice(0, 3).join(', ')}${dup.txIds.length > 3 ? '...' : ''}`);
      console.log('');
    });
    
    // Check recent transactions
    const recent = await txs.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    
    console.log(`\n📊 Recent transactions (last 20):\n`);
    recent.forEach(tx => {
      console.log(`  ID: ${tx._id}`);
      console.log(`    externalRef: ${tx.externalRef || '(null)'}`);
      console.log(`    Status: ${tx.status}`);
      console.log(`    Type: ${tx.type}`);
      console.log(`    Amount: ${tx.amount} ${tx.currency}`);
      console.log(`    Created: ${tx.createdAt}`);
      console.log('');
    });
    
    // Check if unique index exists
    const indexes = await txs.indexes();
    const externalRefIndex = indexes.find(idx => 
      idx.key && 'externalRef' in idx.key && idx.unique === true
    );
    
    console.log(`\n🔑 Index check:\n`);
    if (externalRefIndex) {
      console.log(`  ✅ Unique index on externalRef exists`);
      console.log(`     Options: ${JSON.stringify(externalRefIndex)}`);
    } else {
      console.log(`  ❌ Unique index on externalRef NOT FOUND!`);
      console.log(`     This is why duplicates are getting through!`);
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

checkDuplicates().catch(console.error);
