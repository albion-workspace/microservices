import { MongoClient } from 'mongodb';

async function checkDuplicates() {
  const client = new MongoClient('mongodb://localhost:27017/payment_service?directConnection=true');
  
  try {
    await client.connect();
    const db = client.db('payment_service');
    
    // Get all deposits with externalRef
    const transactions = await db.collection('transactions')
      .find({ 
        type: 'deposit',
        'metadata.externalRef': { $exists: true }
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    
    console.log(`\n📊 Found ${transactions.length} deposits with externalRef\n`);
    
    // Count occurrences of each externalRef
    const externalRefCounts: Record<string, number> = {};
    transactions.forEach(tx => {
      const extRef = tx.metadata?.externalRef;
      if (extRef) {
        externalRefCounts[extRef] = (externalRefCounts[extRef] || 0) + 1;
      }
    });
    
    // Find duplicates
    const duplicates = Object.entries(externalRefCounts).filter(([ref, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log('❌ FOUND DUPLICATES:');
      duplicates.forEach(([ref, count]) => {
        console.log(`  externalRef: ${ref.substring(0, 40)}... (${count} transactions)`);
        // Show the duplicate transaction IDs
        const dupTxs = transactions.filter(tx => tx.metadata?.externalRef === ref);
        dupTxs.forEach(tx => {
          const date = new Date(tx.createdAt).toLocaleString();
          console.log(`    - ${date} | ${tx.id} | status: ${tx.status}`);
        });
      });
    } else {
      console.log('✅ NO DUPLICATES FOUND - All externalRefs are unique!');
    }
    
    // Show recent transactions
    const recent = transactions.slice(0, 20);
    console.log(`\n📋 Recent 20 deposits:`);
    recent.forEach(tx => {
      const extRef = tx.metadata?.externalRef || 'N/A';
      const date = new Date(tx.createdAt).toLocaleString();
      console.log(`  ${date} | ${tx.id.substring(0, 8)}... | externalRef: ${extRef.substring(0, 30)}... | status: ${tx.status}`);
    });
    
    // Check for transactions with same timestamp (potential duplicates)
    const timestampGroups: Record<string, any[]> = {};
    transactions.forEach(tx => {
      const ts = new Date(tx.createdAt).toISOString();
      if (!timestampGroups[ts]) {
        timestampGroups[ts] = [];
      }
      timestampGroups[ts].push(tx);
    });
    
    const sameTimestamp = Object.entries(timestampGroups).filter(([ts, txs]) => txs.length > 1);
    if (sameTimestamp.length > 0) {
      console.log(`\n⚠️  Found ${sameTimestamp.length} timestamps with multiple transactions:`);
      sameTimestamp.slice(0, 5).forEach(([ts, txs]) => {
        console.log(`  ${ts}: ${txs.length} transactions`);
        txs.forEach(tx => {
          console.log(`    - ${tx.id} | externalRef: ${tx.metadata?.externalRef?.substring(0, 30)}...`);
        });
      });
    } else {
      console.log(`\n✅ No transactions with identical timestamps found`);
    }
    
  } finally {
    await client.close();
  }
}

checkDuplicates().catch(console.error);
