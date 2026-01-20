#!/usr/bin/env npx tsx
/**
 * Unified Payment Database Check Suite - Single Source of Truth
 * 
 * Consolidates all payment database check and maintenance scripts into one file.
 * Provides consistent database inspection and maintenance utilities.
 * 
 * Usage:
 *   npx tsx payment-command-db-check.ts                    # Run all checks
 *   npx tsx payment-command-db-check.ts duplicates         # Check for duplicates
 *   npx tsx payment-command-db-check.ts indexes             # Check indexes
 *   npx tsx payment-command-db-check.ts wallets            # Check wallets
 *   npx tsx payment-command-db-check.ts transactions        # Check transaction counts
 *   npx tsx payment-command-db-check.ts deposits           # Check recent deposits
 *   npx tsx payment-command-db-check.ts create-index        # Create unique indexes
 *   npx tsx payment-command-db-check.ts fix-index          # Fix/recreate indexes
 *   npx tsx payment-command-db-check.ts remove-duplicates  # Remove duplicate transactions
 *   npx tsx payment-command-db-check.ts clean              # Clean payment data (drops all databases)
 */

import { MongoClient } from 'mongodb';
import { closeAllConnections } from '../config/mongodb.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration - Single Source of Truth
// ═══════════════════════════════════════════════════════════════════

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/payment_service?directConnection=true';

// ═══════════════════════════════════════════════════════════════════
// Shared Database Helper
// ═══════════════════════════════════════════════════════════════════

async function withDatabase<T>(fn: (db: any, client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    return await fn(db, client);
  } finally {
    await client.close();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Check: Duplicates
// ═══════════════════════════════════════════════════════════════════

async function checkDuplicates() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CHECKING FOR DUPLICATES                                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    // Check transactions collection (new schema)
    const transactionsCollection = db.collection('transactions');
    const duplicateCheck = await transactionsCollection.aggregate([
      {
        $match: {
          $or: [
            { 'meta.externalRef': { $exists: true, $ne: null } },
            { externalRef: { $exists: true, $ne: null } }
          ]
        }
      },
      {
        $group: {
          _id: { $ifNull: ['$meta.externalRef', '$externalRef'] },
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
    
    console.log('📊 Checking transactions collection...');
    if (duplicateCheck.length > 0) {
      console.log(`❌ Found ${duplicateCheck.length} duplicate externalRefs:`);
      duplicateCheck.forEach((dup: any) => {
        console.log(`   - externalRef: ${dup._id} appears ${dup.count} times`);
      });
    } else {
      console.log(`✅ No duplicates found (checked all transactions)`);
    }
    
    // Check transfers collection (new schema)
    const transfersCollection = db.collection('transfers');
    const transferDuplicateCheck = await transfersCollection.aggregate([
      {
        $match: {
          'meta.externalRef': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$meta.externalRef',
          count: { $sum: 1 },
          transferIds: { $push: '$_id' },
          statuses: { $push: '$status' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();
    
    console.log(`\n📊 Checking transfers collection...`);
    if (transferDuplicateCheck.length > 0) {
      console.log(`❌ Found ${transferDuplicateCheck.length} duplicate externalRefs:`);
      transferDuplicateCheck.slice(0, 10).forEach((dup: any) => {
        console.log(`   - externalRef: ${dup._id}`);
        console.log(`     Count: ${dup.count}`);
        console.log(`     Statuses: ${dup.statuses.join(', ')}`);
        console.log(`     Transfer IDs: ${dup.transferIds.slice(0, 3).join(', ')}${dup.transferIds.length > 3 ? '...' : ''}`);
        console.log('');
      });
    } else {
      console.log(`✅ No duplicates found (checked all transfers)`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Check: Indexes
// ═══════════════════════════════════════════════════════════════════

async function checkIndexes() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CHECKING INDEXES                                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    // Check transactions collection indexes
    const transactionsIndexes = await db.collection('transactions').indexes();
    
    console.log('📋 Indexes on transactions collection:\n');
    transactionsIndexes.forEach(idx => {
      const keyStr = JSON.stringify(idx.key);
      const unique = idx.unique ? 'UNIQUE' : '';
      const sparse = idx.sparse ? 'SPARSE' : '';
      console.log(`  ${idx.name}: ${keyStr} ${unique} ${sparse}`);
    });
    
    // Check for unique index on meta.externalRef or externalRef
    const uniqueExternalRefMeta = transactionsIndexes.find(idx => 
      idx.key && 
      typeof idx.key === 'object' && 
      'meta.externalRef' in idx.key && 
      ('charge' in idx.key || idx.unique === true) &&
      idx.unique === true
    );
    
    const uniqueExternalRefTop = transactionsIndexes.find(idx => 
      idx.key && 
      typeof idx.key === 'object' && 
      'externalRef' in idx.key && 
      idx.unique === true
    );
    
    if (uniqueExternalRefMeta || uniqueExternalRefTop) {
      const idx = uniqueExternalRefMeta || uniqueExternalRefTop;
      console.log(`\n✅ Unique index on ${uniqueExternalRefMeta ? 'meta.externalRef' : 'externalRef'} EXISTS`);
      console.log(`   Index name: ${idx!.name}`);
    } else {
      console.log('\n❌ Unique index on meta.externalRef or externalRef MISSING!');
      console.log('   This is why duplicates are being created.');
    }
    
    // Check transfers collection indexes
    console.log('\n📋 Indexes on transfers collection:\n');
    const transfersIndexes = await db.collection('transfers').indexes();
    transfersIndexes.forEach(idx => {
      const keyStr = JSON.stringify(idx.key);
      const unique = idx.unique ? 'UNIQUE' : '';
      const sparse = idx.sparse ? 'SPARSE' : '';
      console.log(`  ${idx.name}: ${keyStr} ${unique} ${sparse}`);
    });
    
    const transferExternalRefIndex = transfersIndexes.find(idx => 
      idx.key && 
      typeof idx.key === 'object' && 
      'meta.externalRef' in idx.key && 
      idx.unique === true
    );
    
    if (transferExternalRefIndex) {
      console.log('\n✅ Unique index on transfers.meta.externalRef EXISTS');
      console.log(`   Index name: ${transferExternalRefIndex.name}`);
    } else {
      console.log('\n⚠️  Unique index on transfers.meta.externalRef NOT FOUND (optional)');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Check: Wallets
// ═══════════════════════════════════════════════════════════════════

async function checkWallets() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CHECKING WALLETS                                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    const wallets = await db.collection('wallets').find({}).toArray();
    
    console.log('📊 Current Wallets:\n');
    wallets.forEach((w: any) => {
      const balance = (w.balance || 0) / 100; // Convert from cents
      console.log(`  User: ${w.userId}`);
      console.log(`    Balance: €${balance.toFixed(2)}`);
      console.log(`    Currency: ${w.currency}`);
      console.log(`    Status: ${w.status}`);
      console.log('');
    });
    
    console.log(`Total wallets: ${wallets.length}\n`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Check: Transaction Counts
// ═══════════════════════════════════════════════════════════════════

async function checkTransactions() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CHECKING TRANSACTION COUNTS                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    const collection = db.collection('transactions');
    
    const totalCount = await collection.countDocuments();
    console.log(`📊 Total transactions in MongoDB: ${totalCount}`);
    
    const byType = await collection.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log('\n📈 Transactions by type:');
    byType.forEach(({ _id, count }) => {
      console.log(`  ${_id || '(null)'}: ${count}`);
    });
    
    const byStatus = await collection.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log('\n📊 Transactions by status:');
    byStatus.forEach(({ _id, count }) => {
      console.log(`  ${_id || '(null)'}: ${count}`);
    });
    
    const sample = await collection.find({}).limit(1).toArray();
    if (sample.length > 0) {
      console.log('\n📋 Sample transaction fields:');
      console.log('  Fields:', Object.keys(sample[0]).join(', '));
      console.log('  Has description?', 'description' in sample[0]);
      console.log('  Has metadata?', 'metadata' in sample[0]);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Check: Recent Deposits
// ═══════════════════════════════════════════════════════════════════

async function checkDeposits() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CHECKING RECENT DEPOSITS                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    const transactionsCollection = db.collection('transactions');
    const transfersCollection = db.collection('transfers');
    
    // Get recent deposit transactions (charge='credit' with deposit method)
    const recentTransactions = await transactionsCollection.find({ 
      charge: 'credit',
      'meta.method': { $in: ['card', 'bank_transfer', 'deposit'] },
      userId: { $regex: /^duplicate-test-/ }
    })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
    
    console.log(`📊 Found ${recentTransactions.length} recent deposit transactions:\n`);
    
    // Group by externalRef to find duplicates
    const byExternalRef = new Map<string, any[]>();
    recentTransactions.forEach(tx => {
      const extRef = tx.meta?.externalRef || tx.externalRef;
      if (extRef) {
        if (!byExternalRef.has(extRef)) {
          byExternalRef.set(extRef, []);
        }
        byExternalRef.get(extRef)!.push(tx);
      }
    });
    
    const duplicateRefs = Array.from(byExternalRef.entries()).filter(([_, txs]) => txs.length > 1);
    console.log(`🔍 Found ${duplicateRefs.length} duplicate externalRefs:\n`);
    duplicateRefs.slice(0, 5).forEach(([externalRef, txs]) => {
      console.log(`  externalRef: ${externalRef}`);
      console.log(`    Count: ${txs.length}`);
      console.log(`    Transaction IDs: ${txs.map(t => t.id).join(', ')}`);
      console.log(`    Created: ${txs.map(t => t.createdAt).join(', ')}`);
      console.log('');
    });
    
    // Get corresponding transfers
    const recentTransfers = await transfersCollection.find({
      'meta.method': { $in: ['card', 'bank_transfer', 'deposit'] }
    })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
    
    console.log(`\n💰 Found ${recentTransfers.length} recent transfers:\n`);
    
    // Show sample transfers
    console.log(`\n📋 Sample transfers (last 10):\n`);
    recentTransfers.slice(0, 10).forEach(tf => {
      console.log(`  ID: ${tf.id}`);
      console.log(`    externalRef: ${tf.meta?.externalRef || '(null)'}`);
      console.log(`    Method: ${tf.meta?.method || 'N/A'}`);
      console.log(`    Status: ${tf.status}`);
      console.log(`    Amount: ${tf.amount}`);
      console.log(`    From: ${tf.fromUserId}`);
      console.log(`    To: ${tf.toUserId}`);
      console.log(`    Created: ${tf.createdAt}`);
      console.log('');
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// Maintenance: Create Unique Indexes
// ═══════════════════════════════════════════════════════════════════

async function createIndexes() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CREATING UNIQUE INDEXES                                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    // Create index on transactions.meta.externalRef (new schema)
    const transactionsCollection = db.collection('transactions');
    console.log('🔧 Creating unique index on transactions.meta.externalRef...\n');
    
    try {
      // First, list all indexes and find any externalRef indexes to drop
      const existingIndexes = await transactionsCollection.indexes();
      const externalRefIndexes = existingIndexes.filter(idx => 
        idx.key && typeof idx.key === 'object' && 
        ('meta.externalRef' in idx.key || 'externalRef' in idx.key || 'metadata.externalRef' in idx.key)
      );
      
      // Drop all externalRef-related indexes
      for (const idx of externalRefIndexes) {
        if (idx.name) {
          try {
            await transactionsCollection.dropIndex(idx.name);
            console.log(`✅ Dropped existing index: ${idx.name}`);
          } catch (e: any) {
            if (e.codeName !== 'IndexNotFound' && e.code !== 27) {
              console.log(`⚠️  Could not drop index ${idx.name}: ${e.message}`);
            }
          }
        }
      }
      
      // Also try dropping by common names (in case name is different)
      const indexesToDrop = [
        'type_1_metadata.externalRef_1_status_1',
        'metadata.externalRef_1',
        'metadata.externalRef_1_unique',
        'meta.externalRef_1',
        'meta.externalRef_1_unique', // Old unique index (without charge)
        'meta.externalRef_1_charge_1_unique' // New compound index (in case we need to recreate)
      ];
      
      for (const indexName of indexesToDrop) {
        try {
          await transactionsCollection.dropIndex(indexName);
          console.log(`✅ Dropped existing index: ${indexName}`);
        } catch (e: any) {
          if (e.codeName !== 'IndexNotFound' && e.code !== 27) {
            console.log(`⚠️  Could not drop index ${indexName}: ${e.message}`);
          }
        }
      }
      
      // Create unique compound index on meta.externalRef + charge
      // This allows the same externalRef for both debit and credit transactions
      await transactionsCollection.createIndex(
        { 'meta.externalRef': 1, charge: 1 },
        { 
          unique: true,
          sparse: true,
          name: 'meta.externalRef_1_charge_1_unique'
        }
      );
      
      console.log('✅ Unique compound index on meta.externalRef + charge created successfully!');
      
      // Create compound unique index on top-level externalRef + charge
      // This allows the same externalRef for both debit and credit transactions
      try {
        // Drop old top-level externalRef unique index if it exists
        try {
          await transactionsCollection.dropIndex('externalRef_1_unique');
          console.log('✅ Dropped old top-level externalRef unique index');
        } catch (e: any) {
          // Index might not exist, which is fine
        }
        
        await transactionsCollection.createIndex(
          { externalRef: 1, charge: 1 },
          { 
            unique: true,
            sparse: true,
            name: 'externalRef_1_charge_1_unique'
          }
        );
        console.log('✅ Unique compound index on externalRef (top-level) + charge created successfully!');
      } catch (e: any) {
        if (e.code !== 85) {
          console.log(`⚠️  Could not create top-level externalRef compound index: ${e.message}`);
        }
      }
      
      // Verify indexes were created
      const indexes = await transactionsCollection.indexes();
      const uniqueIndexMeta = indexes.find(idx => 
        idx.key && 
        typeof idx.key === 'object' &&
        'meta.externalRef' in idx.key && 
        'charge' in idx.key &&
        idx.unique === true
      );
      
      if (uniqueIndexMeta) {
        console.log(`✅ Verified: Index "${uniqueIndexMeta.name}" exists and is unique`);
      } else {
        console.log('❌ Index creation may have failed - not found in list');
      }
      
    } catch (error: any) {
      if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
        console.log('⚠️  Index already exists with different options');
        console.log('   Attempting to drop and recreate...');
        
        try {
          await transactionsCollection.dropIndex('meta.externalRef_1');
        } catch {}
        
        try {
          await transactionsCollection.dropIndex('meta.externalRef_1_unique');
        } catch {}
        
        await transactionsCollection.createIndex(
          { 'meta.externalRef': 1 },
          { 
            unique: true,
            sparse: true,
            name: 'meta.externalRef_1_charge_1_unique'
          }
        );
        
        console.log('✅ Index recreated successfully!');
      } else {
        throw error;
      }
    }
    
    // Create index on transfers.meta.externalRef (optional but recommended)
    const transfersCollection = db.collection('transfers');
    console.log('\n🔧 Creating unique index on transfers.meta.externalRef...\n');
    
    try {
      await transfersCollection.createIndex(
        { 'meta.externalRef': 1 },
        { 
          sparse: true, 
          unique: true,
          name: 'meta.externalRef_1_charge_1_unique'
        }
      );
      console.log('✅ Unique index on transfers.meta.externalRef created successfully!');
    } catch (error: any) {
      if (error.code === 85) {
        console.log('⚠️  Index exists but with different options');
        console.log('   Dropping and recreating...');
        try {
          await transfersCollection.dropIndex('meta.externalRef_1');
        } catch (e: any) {
          // Ignore if doesn't exist
        }
        try {
          await transfersCollection.dropIndex('meta.externalRef_1_unique');
        } catch (e: any) {
          // Ignore if doesn't exist
        }
        await transfersCollection.createIndex(
          { 'meta.externalRef': 1 },
          { 
            sparse: true, 
            unique: true,
            name: 'meta.externalRef_1_charge_1_unique'
          }
        );
        console.log('✅ Index recreated successfully!');
      } else {
        console.log(`⚠️  Could not create transfers index: ${error.message}`);
      }
    }
    
    // Verify the transfers index was created
    const transfersIndexes = await transfersCollection.indexes();
    const verifyTransferIndex = transfersIndexes.find(idx => 
      idx.key && 
      typeof idx.key === 'object' && 
      'meta.externalRef' in idx.key && 
      idx.unique === true
    );
    
    if (verifyTransferIndex) {
      console.log('\n✅ Verification: Unique index on transfers.meta.externalRef exists');
      console.log(`   Options: ${JSON.stringify(verifyTransferIndex)}`);
    } else {
      console.log('\n⚠️  Verification: Transfers index not found (optional)');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Maintenance: Fix Indexes
// ═══════════════════════════════════════════════════════════════════

async function fixIndexes() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           FIXING INDEXES                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    const transactionsCollection = db.collection('transactions');
    
    console.log('🔍 Checking existing indexes on transactions...\n');
    
    const indexes = await transactionsCollection.indexes();
    console.log(`Found ${indexes.length} indexes:\n`);
    
    // Find all indexes on meta.externalRef or externalRef
    const externalRefIndexes = indexes.filter(idx => 
      idx.key && typeof idx.key === 'object' && 
      ('meta.externalRef' in idx.key || 'externalRef' in idx.key)
    );
    
    if (externalRefIndexes.length === 0) {
      console.log('⚠️  No indexes found on externalRef fields');
    } else {
      console.log(`Found ${externalRefIndexes.length} index(es) on externalRef:\n`);
      externalRefIndexes.forEach(idx => {
        console.log(`  Name: ${idx.name}`);
        console.log(`    Key: ${JSON.stringify(idx.key)}`);
        console.log(`    Unique: ${idx.unique || false}`);
        console.log(`    Sparse: ${idx.sparse || false}`);
        console.log('');
      });
      
      // Drop all existing externalRef indexes that aren't unique
      console.log('🗑️  Dropping non-unique externalRef indexes...\n');
      for (const idx of externalRefIndexes) {
        if (!idx.unique) {
          try {
            await transactionsCollection.dropIndex(idx.name);
            console.log(`  ✅ Dropped non-unique index: ${idx.name}`);
          } catch (error: any) {
            console.log(`  ⚠️  Failed to drop ${idx.name}: ${error.message}`);
          }
        }
      }
    }
    
    // Create the correct unique index on meta.externalRef
    console.log('\n📝 Creating unique index on meta.externalRef...\n');
    try {
      await transactionsCollection.createIndex(
        { 'meta.externalRef': 1 },
        { 
          sparse: true, 
          unique: true,
          name: 'meta.externalRef_1_charge_1_unique'
        }
      );
      console.log('✅ Successfully created unique index: meta.externalRef_1_unique\n');
    } catch (error: any) {
      if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
        console.log('⚠️  Index conflict detected. Trying to resolve...\n');
        // Try dropping by common names
        const namesToTry = ['meta.externalRef_1', 'meta.externalRef_1_unique', 'meta.externalRef_1_charge_1_unique'];
        for (const name of namesToTry) {
          try {
            await transactionsCollection.dropIndex(name);
            console.log(`  ✅ Dropped index: ${name}`);
          } catch (e: any) {
            // Ignore if doesn't exist
          }
        }
        // Try creating again
        await transactionsCollection.createIndex(
          { 'meta.externalRef': 1, charge: 1 },
          { 
            sparse: true, 
            unique: true,
            name: 'meta.externalRef_1_charge_1_unique'
          }
        );
        console.log('✅ Successfully created unique index after cleanup\n');
      } else {
        throw error;
      }
    }
    
    // Verify the index was created
    const finalIndexes = await transactionsCollection.indexes();
    const finalExternalRefIndex = finalIndexes.find(idx => 
      idx.key && typeof idx.key === 'object' && 'meta.externalRef' in idx.key && idx.unique === true
    );
    
    if (finalExternalRefIndex) {
      console.log('✅ Verification: Unique index on meta.externalRef exists and is correct');
      console.log(`   Name: ${finalExternalRefIndex.name}`);
      console.log(`   Unique: ${finalExternalRefIndex.unique}`);
      console.log(`   Sparse: ${finalExternalRefIndex.sparse || false}\n`);
    } else {
      console.log('⚠️  Warning: Could not verify unique index was created correctly\n');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Maintenance: Remove Duplicates
// ═══════════════════════════════════════════════════════════════════

async function removeDuplicates() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           REMOVING DUPLICATE TRANSACTIONS                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  await withDatabase(async (db) => {
    const collection = db.collection('transactions');
    
    console.log('🧹 Removing duplicate transactions...\n');
    
    // Find all transactions with externalRef (new schema uses meta.externalRef)
    const transactions = await collection
      .find({ 
        $or: [
          { 'meta.externalRef': { $exists: true } },
          { externalRef: { $exists: true } }
        ]
      })
      .sort({ createdAt: 1 }) // Oldest first
      .toArray();
    
    console.log(`Found ${transactions.length} transactions with externalRef`);
    
    // Group by externalRef
    const byExternalRef: Record<string, any[]> = {};
    transactions.forEach(tx => {
      const extRef = tx.meta?.externalRef || tx.externalRef;
      if (extRef) {
        if (!byExternalRef[extRef]) {
          byExternalRef[extRef] = [];
        }
        byExternalRef[extRef].push(tx);
      }
    });
    
    // Find duplicates
    const duplicates = Object.entries(byExternalRef).filter(([ref, txs]) => txs.length > 1);
    
    console.log(`Found ${duplicates.length} externalRefs with duplicates\n`);
    
    let totalRemoved = 0;
    
    // For each duplicate group, keep the first one, delete the rest
    for (const [extRef, txs] of duplicates) {
      // Sort by createdAt (keep the oldest)
      txs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      
      const toKeep = txs[0];
      const toRemove = txs.slice(1);
      
      console.log(`externalRef: ${extRef.substring(0, 40)}...`);
      console.log(`  Keeping: ${toKeep.id} (${new Date(toKeep.createdAt).toLocaleString()})`);
      
      for (const tx of toRemove) {
        await collection.deleteOne({ _id: tx._id });
        console.log(`  Removed: ${tx.id} (${new Date(tx.createdAt).toLocaleString()})`);
        totalRemoved++;
      }
    }
    
    console.log(`\n✅ Removed ${totalRemoved} duplicate transactions`);
    console.log(`   Kept ${duplicates.length} original transactions`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Maintenance: Clean Payment Data
// ═══════════════════════════════════════════════════════════════════

async function cleanPaymentData() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           CLEANUP PAYMENT SERVICE DATA                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const { execSync } = await import('child_process');
  
  try {
    // Drop all databases
    console.log('📊 Dropping all databases...\n');
    execSync('npx tsx typescript/config/drop-all-databases.ts', { 
      stdio: 'inherit', 
      cwd: process.cwd() 
    });
    
    console.log('\n✅ All databases dropped!');
    console.log('\nℹ️  All databases will be recreated fresh when services start.');
    console.log('   Indexes will be created automatically after services start.\n');
  } catch (error: any) {
    console.error('\n❌ Cleanup failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Command Registry and Runner
// ═══════════════════════════════════════════════════════════════════

const COMMAND_REGISTRY: Record<string, () => Promise<void>> = {
  duplicates: checkDuplicates,
  indexes: checkIndexes,
  wallets: checkWallets,
  transactions: checkTransactions,
  deposits: checkDeposits,
  'create-index': createIndexes,
  'fix-index': fixIndexes,
  'remove-duplicates': removeDuplicates,
  clean: cleanPaymentData,
};

async function runCommands(commandNames: string[]) {
  // Filter out flags
  const filteredCommands = commandNames.filter(name => !name.startsWith('--'));
  
  const commandsToRun = filteredCommands.length > 0 
    ? filteredCommands.filter(name => COMMAND_REGISTRY[name])
    : Object.keys(COMMAND_REGISTRY);
  
  if (commandsToRun.length === 0) {
    console.error('❌ No valid commands found. Available commands:', Object.keys(COMMAND_REGISTRY).join(', '));
    process.exit(1);
  }
  
  console.log(`\n🔍 Running ${commandsToRun.length} command(s): ${commandsToRun.join(', ')}\n`);
  
  const results: Record<string, { success: boolean; error?: string }> = {};
  
  for (const commandName of commandsToRun) {
    try {
      console.log(`\n${'═'.repeat(75)}`);
      console.log(`🔧 Running: ${commandName}`);
      console.log('─'.repeat(75));
      
      await COMMAND_REGISTRY[commandName]();
      
      results[commandName] = { success: true };
      console.log(`\n✅ ${commandName} - COMPLETED`);
    } catch (error: any) {
      results[commandName] = { success: false, error: error.message };
      console.log(`\n❌ ${commandName} - FAILED: ${error.message}`);
    }
  }
  
  // Summary (only show if multiple commands or failures)
  const passed = Object.values(results).filter(r => r.success).length;
  const failed = Object.values(results).filter(r => !r.success).length;
  
  if (commandsToRun.length > 1 || failed > 0) {
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                         COMMAND SUMMARY                          ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
    
    console.log(`✅ Completed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total:  ${commandsToRun.length}\n`);
    
    if (failed > 0) {
      console.log('Failed commands:');
      Object.entries(results).forEach(([name, result]) => {
        if (!result.success) {
          console.log(`  ❌ ${name}: ${result.error}`);
        }
      });
      process.exit(1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  
  try {
    await runCommands(args);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
