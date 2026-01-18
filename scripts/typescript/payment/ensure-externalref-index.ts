#!/usr/bin/env npx tsx
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

async function ensureIndex() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const txs = db.collection('ledger_transactions');
    
    console.log('🔍 Checking existing indexes...');
    const indexes = await txs.indexes();
    console.log(`Found ${indexes.length} indexes:`);
    indexes.forEach(idx => {
      console.log(`  - ${JSON.stringify(idx.key)} (unique: ${idx.unique || false})`);
    });
    
    // Check if unique index on externalRef exists
    const externalRefIndex = indexes.find(idx => 
      idx.key && 'externalRef' in idx.key && idx.unique === true
    );
    
    if (externalRefIndex) {
      console.log('\n✅ Unique index on externalRef already exists');
      console.log(`   Options: ${JSON.stringify(externalRefIndex)}`);
    } else {
      console.log('\n❌ Unique index on externalRef NOT FOUND');
      console.log('   Creating unique index on externalRef...');
      
      try {
        await txs.createIndex(
          { externalRef: 1 },
          { 
            sparse: true, 
            unique: true,
            name: 'externalRef_1_unique'
          }
        );
        console.log('   ✅ Index created successfully!');
      } catch (error: any) {
        if (error.code === 85) {
          // Index already exists with different options
          console.log('   ⚠️  Index exists but with different options');
          console.log('   Dropping and recreating...');
          try {
            await txs.dropIndex('externalRef_1');
          } catch (e: any) {
            // Ignore if doesn't exist
          }
          await txs.createIndex(
            { externalRef: 1 },
            { 
              sparse: true, 
              unique: true,
              name: 'externalRef_1_unique'
            }
          );
          console.log('   ✅ Index recreated successfully!');
        } else {
          throw error;
        }
      }
    }
    
    // Verify the index was created
    const newIndexes = await txs.indexes();
    const verifyIndex = newIndexes.find(idx => 
      idx.key && 'externalRef' in idx.key && idx.unique === true
    );
    
    if (verifyIndex) {
      console.log('\n✅ Verification: Unique index on externalRef exists');
      console.log(`   Options: ${JSON.stringify(verifyIndex)}`);
    } else {
      console.log('\n❌ Verification failed: Index still not found');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  } finally {
    await client.close();
  }
}

ensureIndex().catch(console.error);
