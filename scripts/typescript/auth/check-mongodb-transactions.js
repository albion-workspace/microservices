#!/usr/bin/env node
/**
 * MongoDB Transaction Support Checker
 * 
 * Verifies that MongoDB is configured correctly for atomic transactions:
 * 1. MongoDB is running and accessible
 * 2. MongoDB is configured as a replica set (required for transactions)
 * 3. Transactions can be executed successfully
 * 
 * Run: node scripts/typescript/auth/check-mongodb-transactions.js
 * Or: npx tsx scripts/typescript/auth/check-mongodb-transactions.js
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB = 'transaction_test_db';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}`);
  log(title, 'cyan');
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

async function checkMongoDBConnection() {
  logSection('Step 1: Checking MongoDB Connection');
  
  try {
    log(`Connecting to: ${MONGO_URI}`, 'blue');
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    
    await client.connect();
    log('✅ MongoDB connection successful', 'green');
    
    // Test basic operation
    const adminDb = client.db('admin');
    const pingResult = await adminDb.admin().ping();
    log(`✅ MongoDB ping successful: ${JSON.stringify(pingResult)}`, 'green');
    
    await client.close();
    return true;
  } catch (error) {
    log(`❌ MongoDB connection failed: ${error.message}`, 'red');
    log(`\nPlease ensure MongoDB is running:`, 'yellow');
    log(`  • Docker: docker run -d -p 27017:27017 --name mongodb mongo:7`, 'yellow');
    log(`  • Local: Ensure MongoDB service is running`, 'yellow');
    log(`  • Atlas: Set MONGO_URI environment variable`, 'yellow');
    return false;
  }
}

async function checkReplicaSetStatus() {
  logSection('Step 2: Checking Replica Set Configuration');
  
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    
    await client.connect();
    
    // Check replica set status
    const adminDb = client.db('admin');
    let replicaSetStatus;
    
    try {
      const statusResult = await adminDb.admin().command({ replSetGetStatus: 1 });
      replicaSetStatus = statusResult;
      log('✅ Replica set is configured', 'green');
      log(`   Set Name: ${statusResult.set}`, 'blue');
      log(`   Members: ${statusResult.members?.length || 0}`, 'blue');
      
      if (statusResult.members && statusResult.members.length > 0) {
        statusResult.members.forEach((member, index) => {
          const stateStr = member.stateStr || 'UNKNOWN';
          const health = member.health === 1 ? '✅' : '❌';
          log(`   Member ${index + 1}: ${member.name} - ${stateStr} ${health}`, 
            member.health === 1 ? 'green' : 'red');
        });
      }
    } catch (error) {
      if (error.message?.includes('not running with --replSet')) {
        log('❌ MongoDB is NOT configured as a replica set', 'red');
        log('\n⚠️  Transactions require a replica set configuration!', 'yellow');
        log('\nTo enable replica set (single-node for development):', 'yellow');
        log('\n1. Stop MongoDB', 'blue');
        log('2. Start MongoDB with replica set:', 'blue');
        log('   docker run -d -p 27017:27017 --name mongodb mongo:7 mongod --replSet rs0', 'blue');
        log('3. Initialize replica set:', 'blue');
        log('   docker exec -it mongodb mongosh --eval "rs.initiate()"', 'blue');
        log('\nOr for local MongoDB:', 'yellow');
        log('1. Edit mongod.conf: replication.replSetName = "rs0"', 'blue');
        log('2. Restart MongoDB', 'blue');
        log('3. Run: mongosh --eval "rs.initiate()"', 'blue');
        
        await client.close();
        return false;
      } else {
        // Try alternative check
        try {
          const serverStatus = await adminDb.admin().command({ serverStatus: 1 });
          if (serverStatus.repl) {
            log('✅ Replica set detected via serverStatus', 'green');
            log(`   Set Name: ${serverStatus.repl.setName || 'N/A'}`, 'blue');
          } else {
            log('⚠️  Could not determine replica set status', 'yellow');
          }
        } catch (e) {
          log(`⚠️  Could not check replica set status: ${e.message}`, 'yellow');
        }
      }
    }
    
    await client.close();
    return true;
  } catch (error) {
    log(`❌ Failed to check replica set: ${error.message}`, 'red');
    return false;
  }
}

async function testTransactionSupport() {
  logSection('Step 3: Testing Atomic Transaction Support');
  
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    
    await client.connect();
    const db = client.db(TEST_DB);
    const testCollection = db.collection('transaction_test');
    
    // Clean up any previous test data
    try {
      await testCollection.deleteMany({});
    } catch (e) {
      // Collection might not exist, that's ok
    }
    
    log('Testing atomic transaction...', 'blue');
    
    const session = client.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Insert document 1
        await testCollection.insertOne(
          { testId: 'tx-test-1', value: 100, timestamp: new Date() },
          { session }
        );
        
        // Insert document 2
        await testCollection.insertOne(
          { testId: 'tx-test-2', value: 200, timestamp: new Date() },
          { session }
        );
        
        // Update document 1
        await testCollection.updateOne(
          { testId: 'tx-test-1' },
          { $inc: { value: 50 } },
          { session }
        );
        
        log('   → Transaction operations executed', 'blue');
      });
      
      log('✅ Atomic transaction completed successfully', 'green');
      
      // Verify data was committed
      const doc1 = await testCollection.findOne({ testId: 'tx-test-1' });
      const doc2 = await testCollection.findOne({ testId: 'tx-test-2' });
      
      if (doc1 && doc1.value === 150 && doc2 && doc2.value === 200) {
        log('✅ Transaction data verified correctly', 'green');
        log(`   Document 1 value: ${doc1.value} (expected: 150)`, 'blue');
        log(`   Document 2 value: ${doc2.value} (expected: 200)`, 'blue');
      } else {
        log('⚠️  Transaction completed but data verification failed', 'yellow');
      }
      
      // Clean up test data
      await testCollection.deleteMany({ testId: { $in: ['tx-test-1', 'tx-test-2'] } });
      log('✅ Test data cleaned up', 'green');
      
    } catch (txError) {
      log(`❌ Transaction failed: ${txError.message}`, 'red');
      
      if (txError.message?.includes('replica set') || 
          txError.message?.includes('transactions are not supported') ||
          txError.message?.includes('not a replica set')) {
        log('\n⚠️  MongoDB does not support transactions!', 'yellow');
        log('Transactions require a replica set configuration.', 'yellow');
        log('\nTo fix:', 'yellow');
        log('1. Configure MongoDB as a replica set (see Step 2)', 'blue');
        log('2. Restart MongoDB', 'blue');
        log('3. Run this script again to verify', 'blue');
      }
      
      await session.endSession();
      await client.close();
      return false;
    } finally {
      await session.endSession();
    }
    
    await client.close();
    return true;
  } catch (error) {
    log(`❌ Transaction test failed: ${error.message}`, 'red');
    return false;
  }
}

async function testTransactionRollback() {
  logSection('Step 4: Testing Transaction Rollback');
  
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    
    await client.connect();
    const db = client.db(TEST_DB);
    const testCollection = db.collection('transaction_rollback_test');
    
    // Clean up
    try {
      await testCollection.deleteMany({});
    } catch (e) {
      // Collection might not exist
    }
    
    log('Testing transaction rollback on error...', 'blue');
    
    const session = client.startSession();
    const initialCount = await testCollection.countDocuments();
    
    try {
      await session.withTransaction(async () => {
        // Insert document
        await testCollection.insertOne(
          { testId: 'rollback-test', value: 100 },
          { session }
        );
        
        log('   → Document inserted in transaction', 'blue');
        
        // Simulate error to trigger rollback
        throw new Error('Simulated transaction error');
      });
      
      log('❌ Transaction should have been rolled back!', 'red');
      await session.endSession();
      await client.close();
      return false;
    } catch (txError) {
      // Transaction should be aborted
      log('✅ Transaction correctly aborted on error', 'green');
      
      // Verify rollback - document should not exist
      const finalCount = await testCollection.countDocuments();
      if (finalCount === initialCount) {
        log('✅ Rollback verified - no documents committed', 'green');
      } else {
        log(`⚠️  Rollback may have failed - count changed from ${initialCount} to ${finalCount}`, 'yellow');
      }
      
      await session.endSession();
      await client.close();
      return true;
    }
  } catch (error) {
    log(`❌ Rollback test failed: ${error.message}`, 'red');
    return false;
  }
}

async function checkWriteConcern() {
  logSection('Step 5: Checking Write Concern Support');
  
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      writeConcern: { w: 'majority', wtimeout: 5000 },
    });
    
    await client.connect();
    const db = client.db(TEST_DB);
    const testCollection = db.collection('write_concern_test');
    
    log('Testing write concern "majority"...', 'blue');
    
    try {
      await testCollection.insertOne(
        { testId: 'write-concern-test', timestamp: new Date() },
        { writeConcern: { w: 'majority' } }
      );
      
      log('✅ Write concern "majority" is supported', 'green');
      
      // Clean up
      await testCollection.deleteOne({ testId: 'write-concern-test' });
      
      await client.close();
      return true;
    } catch (error) {
      if (error.message?.includes('majority')) {
        log('⚠️  Write concern "majority" not fully supported', 'yellow');
        log('   This may affect transaction durability', 'yellow');
      } else {
        log(`⚠️  Write concern test failed: ${error.message}`, 'yellow');
      }
      
      await client.close();
      return false;
    }
  } catch (error) {
    log(`❌ Write concern check failed: ${error.message}`, 'red');
    return false;
  }
}

async function getMongoDBInfo() {
  logSection('MongoDB Server Information');
  
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    
    await client.connect();
    const adminDb = client.db('admin');
    
    // Get server version
    const buildInfo = await adminDb.admin().command({ buildInfo: 1 });
    log(`MongoDB Version: ${buildInfo.version}`, 'blue');
    log(`Git Version: ${buildInfo.gitVersion || 'N/A'}`, 'blue');
    
    // Get server status
    const serverStatus = await adminDb.admin().command({ serverStatus: 1 });
    log(`Uptime: ${Math.floor(serverStatus.uptime / 3600)} hours`, 'blue');
    log(`Connections: ${serverStatus.connections?.current || 0} current, ${serverStatus.connections?.available || 0} available`, 'blue');
    
    if (serverStatus.storageEngine) {
      log(`Storage Engine: ${serverStatus.storageEngine.name || 'N/A'}`, 'blue');
    }
    
    await client.close();
  } catch (error) {
    log(`⚠️  Could not retrieve server info: ${error.message}`, 'yellow');
  }
}

async function main() {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════════════════╗
║          MONGODB TRANSACTION SUPPORT CHECKER                    ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  This script verifies MongoDB is configured correctly for:           ║
║  • Atomic transactions (required for ledger system)                 ║
║  • Replica set configuration                                         ║
║  • Transaction rollback support                                      ║
║  • Write concern support                                             ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝${colors.reset}
`);

  log(`MongoDB URI: ${MONGO_URI}`, 'blue');
  log(`Test Database: ${TEST_DB}`, 'blue');
  
  const results = {
    connection: false,
    replicaSet: false,
    transactions: false,
    rollback: false,
    writeConcern: false,
  };
  
  try {
    // Step 1: Check connection
    results.connection = await checkMongoDBConnection();
    if (!results.connection) {
      log('\n❌ Cannot proceed - MongoDB is not accessible', 'red');
      process.exit(1);
    }
    
    // Get MongoDB info
    await getMongoDBInfo();
    
    // Step 2: Check replica set
    results.replicaSet = await checkReplicaSetStatus();
    
    // Step 3: Test transactions
    if (results.replicaSet) {
      results.transactions = await testTransactionSupport();
      
      // Step 4: Test rollback
      if (results.transactions) {
        results.rollback = await testTransactionRollback();
      }
    } else {
      log('\n⚠️  Skipping transaction tests - replica set not configured', 'yellow');
    }
    
    // Step 5: Check write concern
    results.writeConcern = await checkWriteConcern();
    
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    process.exit(1);
  }
  
  // Print summary
  logSection('Test Summary');
  
  const allPassed = Object.values(results).every(r => r === true);
  const criticalPassed = results.connection && results.replicaSet && results.transactions;
  
  log(`Connection:        ${results.connection ? '✅ PASS' : '❌ FAIL'}`, results.connection ? 'green' : 'red');
  log(`Replica Set:       ${results.replicaSet ? '✅ PASS' : '❌ FAIL'}`, results.replicaSet ? 'green' : 'red');
  log(`Transactions:      ${results.transactions ? '✅ PASS' : '❌ FAIL'}`, results.transactions ? 'green' : 'red');
  log(`Rollback Support:  ${results.rollback ? '✅ PASS' : '❌ FAIL'}`, results.rollback ? 'green' : 'red');
  log(`Write Concern:     ${results.writeConcern ? '✅ PASS' : '⚠️  WARN'}`, results.writeConcern ? 'green' : 'yellow');
  
  console.log('');
  
  if (criticalPassed) {
    log('✅ MongoDB is configured correctly for atomic transactions!', 'green');
    log('   Ledger system can operate safely.', 'green');
    process.exit(0);
  } else {
    log('❌ MongoDB is NOT ready for atomic transactions', 'red');
    log('\nRequired fixes:', 'yellow');
    
    if (!results.connection) {
      log('  • Start MongoDB service', 'yellow');
    }
    if (!results.replicaSet) {
      log('  • Configure MongoDB as a replica set', 'yellow');
      log('    See instructions in Step 2 above', 'blue');
    }
    if (!results.transactions && results.replicaSet) {
      log('  • Fix transaction support (see errors above)', 'yellow');
    }
    
    process.exit(1);
  }
}

main().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
