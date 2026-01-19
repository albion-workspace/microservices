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
    
    console.log('📊 Checking transactions collection...');
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
          transactionIds: { $push: '$_id' },
          statuses: { $push: '$status' }
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
      ledgerDuplicateCheck.slice(0, 10).forEach((dup: any) => {
        console.log(`   - externalRef: ${dup._id}`);
        console.log(`     Count: ${dup.count}`);
        console.log(`     Statuses: ${dup.statuses.join(', ')}`);
        console.log(`     Transaction IDs: ${dup.transactionIds.slice(0, 3).join(', ')}${dup.transactionIds.length > 3 ? '...' : ''}`);
        console.log('');
      });
    } else {
      console.log(`✅ No duplicates found (checked all ledger transactions)`);
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
    
    const uniqueExternalRef = transactionsIndexes.find(idx => 
      idx.key && 
      typeof idx.key === 'object' && 
      'metadata.externalRef' in idx.key && 
      idx.unique === true
    );
    
    if (uniqueExternalRef) {
      console.log('\n✅ Unique index on metadata.externalRef EXISTS');
      console.log(`   Index name: ${uniqueExternalRef.name}`);
    } else {
      console.log('\n❌ Unique index on metadata.externalRef MISSING!');
      console.log('   This is why duplicates are being created.');
    }
    
    // Check ledger_transactions collection indexes
    console.log('\n📋 Indexes on ledger_transactions collection:\n');
    const ledgerIndexes = await db.collection('ledger_transactions').indexes();
    ledgerIndexes.forEach(idx => {
      const keyStr = JSON.stringify(idx.key);
      const unique = idx.unique ? 'UNIQUE' : '';
      const sparse = idx.sparse ? 'SPARSE' : '';
      console.log(`  ${idx.name}: ${keyStr} ${unique} ${sparse}`);
    });
    
    const ledgerExternalRefIndex = ledgerIndexes.find(idx => 
      idx.key && 'externalRef' in idx.key && idx.unique === true
    );
    
    if (ledgerExternalRefIndex) {
      console.log('\n✅ Unique index on externalRef EXISTS');
      console.log(`   Index name: ${ledgerExternalRefIndex.name}`);
    } else {
      console.log('\n❌ Unique index on externalRef NOT FOUND!');
      console.log('   This is why duplicates are getting through!');
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
    
    console.log(`📊 Found ${recentGraphQL.length} recent GraphQL deposits:\n`);
    
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
    // Create index on transactions.metadata.externalRef
    const transactionsCollection = db.collection('transactions');
    console.log('🔧 Creating unique index on transactions.metadata.externalRef...\n');
    
    try {
      // Drop existing non-unique index if it exists
      try {
        await transactionsCollection.dropIndex('type_1_metadata.externalRef_1_status_1');
        console.log('✅ Dropped existing compound index');
      } catch (e: any) {
        if (e.codeName !== 'IndexNotFound') {
          console.log(`⚠️  Could not drop compound index: ${e.message}`);
        }
      }
      
      // Create unique index on metadata.externalRef
      await transactionsCollection.createIndex(
        { 'metadata.externalRef': 1 },
        { 
          unique: true,
          sparse: true,
          name: 'metadata.externalRef_1_unique'
        }
      );
      
      console.log('✅ Unique index on metadata.externalRef created successfully!');
      
      // Verify it was created
      const indexes = await transactionsCollection.indexes();
      const uniqueIndex = indexes.find(idx => 
        idx.key && 
        typeof idx.key === 'object' && 
        'metadata.externalRef' in idx.key && 
        idx.unique === true
      );
      
      if (uniqueIndex) {
        console.log(`✅ Verified: Index "${uniqueIndex.name}" exists and is unique`);
      } else {
        console.log('❌ Index creation may have failed - not found in list');
      }
      
    } catch (error: any) {
      if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
        console.log('⚠️  Index already exists with different options');
        console.log('   Attempting to drop and recreate...');
        
        try {
          await transactionsCollection.dropIndex('metadata.externalRef_1');
        } catch {}
        
        try {
          await transactionsCollection.dropIndex('metadata.externalRef_1_unique');
        } catch {}
        
        await transactionsCollection.createIndex(
          { 'metadata.externalRef': 1 },
          { 
            unique: true,
            sparse: true,
            name: 'metadata.externalRef_1_unique'
          }
        );
        
        console.log('✅ Index recreated successfully!');
      } else {
        throw error;
      }
    }
    
    // Create index on ledger_transactions.externalRef
    const ledgerCollection = db.collection('ledger_transactions');
    console.log('\n🔧 Creating unique index on ledger_transactions.externalRef...\n');
    
    try {
      await ledgerCollection.createIndex(
        { externalRef: 1 },
        { 
          sparse: true, 
          unique: true,
          name: 'externalRef_1_unique'
        }
      );
      console.log('✅ Unique index on externalRef created successfully!');
    } catch (error: any) {
      if (error.code === 85) {
        console.log('⚠️  Index exists but with different options');
        console.log('   Dropping and recreating...');
        try {
          await ledgerCollection.dropIndex('externalRef_1');
        } catch (e: any) {
          // Ignore if doesn't exist
        }
        await ledgerCollection.createIndex(
          { externalRef: 1 },
          { 
            sparse: true, 
            unique: true,
            name: 'externalRef_1_unique'
          }
        );
        console.log('✅ Index recreated successfully!');
      } else {
        throw error;
      }
    }
    
    // Verify the index was created
    const ledgerIndexes = await ledgerCollection.indexes();
    const verifyIndex = ledgerIndexes.find(idx => 
      idx.key && 'externalRef' in idx.key && idx.unique === true
    );
    
    if (verifyIndex) {
      console.log('\n✅ Verification: Unique index on externalRef exists');
      console.log(`   Options: ${JSON.stringify(verifyIndex)}`);
    } else {
      console.log('\n❌ Verification failed: Index still not found');
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
    const transactions = db.collection('ledger_transactions');
    
    console.log('🔍 Checking existing indexes on ledger_transactions...\n');
    
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
    
    // Find all deposits with externalRef
    const transactions = await collection
      .find({ 
        type: 'deposit',
        'metadata.externalRef': { $exists: true }
      })
      .sort({ createdAt: 1 }) // Oldest first
      .toArray();
    
    console.log(`Found ${transactions.length} deposits with externalRef`);
    
    // Group by externalRef
    const byExternalRef: Record<string, any[]> = {};
    transactions.forEach(tx => {
      const extRef = tx.metadata?.externalRef;
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
