import { MongoClient } from 'mongodb';

async function removeDuplicates() {
  const client = new MongoClient('mongodb://localhost:27017/payment_service?directConnection=true');
  
  try {
    await client.connect();
    const db = client.db('payment_service');
    const collection = db.collection('transactions');
    
    console.log('\n🧹 Removing duplicate transactions...\n');
    
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
    
  } finally {
    await client.close();
  }
}

removeDuplicates().catch(console.error);
