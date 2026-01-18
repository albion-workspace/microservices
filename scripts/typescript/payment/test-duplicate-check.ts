#!/usr/bin/env npx tsx
import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb://localhost:27017/payment_service?directConnection=true';

async function checkDuplicates() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    
    // Check transactions collection
    const transactionsCollection = db.collection('transactions');
    const duplicateCheck = await transactionsCollection.aggregate([
      {
        $match: {
          'metadata.externalRef': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$metadata.externalRef',
          count: { $sum: 1 },
          transactionIds: { $push: '$_id' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();
    
    console.log(`\n📊 Checking transactions collection...`);
    if (duplicateCheck.length > 0) {
      console.log(`❌ Found ${duplicateCheck.length} duplicate externalRefs:`);
      duplicateCheck.forEach((dup: any) => {
        console.log(`   - externalRef: ${dup._id} appears ${dup.count} times`);
      });
    } else {
      console.log(`✅ No duplicates found (checked all transactions)`);
    }
    
    // Check ledger_transactions collection
    const ledgerTransactionsCollection = db.collection('ledger_transactions');
    const ledgerDuplicateCheck = await ledgerTransactionsCollection.aggregate([
      {
        $match: {
          externalRef: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$externalRef',
          count: { $sum: 1 },
          transactionIds: { $push: '$_id' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();
    
    console.log(`\n📊 Checking ledger_transactions collection...`);
    if (ledgerDuplicateCheck.length > 0) {
      console.log(`❌ Found ${ledgerDuplicateCheck.length} duplicate externalRefs:`);
      ledgerDuplicateCheck.forEach((dup: any) => {
        console.log(`   - externalRef: ${dup._id} appears ${dup.count} times`);
      });
    } else {
      console.log(`✅ No duplicates found (checked all ledger transactions)`);
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  } finally {
    await client.close();
  }
}

checkDuplicates();
