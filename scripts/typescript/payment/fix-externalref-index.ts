#!/usr/bin/env npx tsx
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

async function fixIndex() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const transactions = db.collection('ledger_transactions');
    
    console.log('\n🔍 Checking existing indexes on ledger_transactions...\n');
    
    const indexes = await transactions.indexes();
    console.log(`Found ${indexes.length} indexes:\n`);
    
    // Find all indexes on externalRef
    const externalRefIndexes = indexes.filter(idx => 
      idx.key && typeof idx.key === 'object' && 'externalRef' in idx.key
    );
    
    if (externalRefIndexes.length === 0) {
      console.log('✅ No indexes found on externalRef field');
    } else {
      console.log(`⚠️  Found ${externalRefIndexes.length} index(es) on externalRef:\n`);
      externalRefIndexes.forEach(idx => {
        console.log(`  Name: ${idx.name}`);
        console.log(`    Key: ${JSON.stringify(idx.key)}`);
        console.log(`    Unique: ${idx.unique || false}`);
        console.log(`    Sparse: ${idx.sparse || false}`);
        console.log('');
      });
      
      // Drop all existing externalRef indexes
      console.log('🗑️  Dropping all existing externalRef indexes...\n');
      for (const idx of externalRefIndexes) {
        try {
          await transactions.dropIndex(idx.name);
          console.log(`  ✅ Dropped index: ${idx.name}`);
        } catch (error: any) {
          console.log(`  ⚠️  Failed to drop ${idx.name}: ${error.message}`);
        }
      }
    }
    
    // Create the correct unique index
    console.log('\n📝 Creating unique index on externalRef...\n');
    try {
      await transactions.createIndex(
        { externalRef: 1 },
        { 
          sparse: true, 
          unique: true,
          name: 'externalRef_1_unique'
        }
      );
      console.log('✅ Successfully created unique index: externalRef_1_unique\n');
    } catch (error: any) {
      if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
        console.log('⚠️  Index conflict detected. Trying to resolve...\n');
        // Try dropping by common names
        const namesToTry = ['externalRef_1', 'externalRef_1_unique'];
        for (const name of namesToTry) {
          try {
            await transactions.dropIndex(name);
            console.log(`  ✅ Dropped index: ${name}`);
          } catch (e: any) {
            // Ignore if doesn't exist
          }
        }
        // Try creating again
        await transactions.createIndex(
          { externalRef: 1 },
          { 
            sparse: true, 
            unique: true,
            name: 'externalRef_1_unique'
          }
        );
        console.log('✅ Successfully created unique index after cleanup\n');
      } else {
        throw error;
      }
    }
    
    // Verify the index was created
    const finalIndexes = await transactions.indexes();
    const finalExternalRefIndex = finalIndexes.find(idx => 
      idx.key && typeof idx.key === 'object' && 'externalRef' in idx.key
    );
    
    if (finalExternalRefIndex && finalExternalRefIndex.unique === true) {
      console.log('✅ Verification: Unique index on externalRef exists and is correct');
      console.log(`   Name: ${finalExternalRefIndex.name}`);
      console.log(`   Unique: ${finalExternalRefIndex.unique}`);
      console.log(`   Sparse: ${finalExternalRefIndex.sparse || false}\n`);
    } else {
      console.log('⚠️  Warning: Could not verify unique index was created correctly\n');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

fixIndex().catch(console.error);
