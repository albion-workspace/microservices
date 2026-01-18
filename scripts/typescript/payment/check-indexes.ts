import { MongoClient } from 'mongodb';

async function checkIndexes() {
  const client = new MongoClient('mongodb://localhost:27017/payment_service?directConnection=true');
  
  try {
    await client.connect();
    const db = client.db('payment_service');
    const indexes = await db.collection('transactions').indexes();
    
    console.log('\n📋 Indexes on transactions collection:\n');
    indexes.forEach(idx => {
      const keyStr = JSON.stringify(idx.key);
      const unique = idx.unique ? 'UNIQUE' : '';
      const sparse = idx.sparse ? 'SPARSE' : '';
      console.log(`  ${idx.name}: ${keyStr} ${unique} ${sparse}`);
    });
    
    const uniqueExternalRef = indexes.find(idx => 
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
    
  } finally {
    await client.close();
  }
}

checkIndexes().catch(console.error);
