import { MongoClient } from 'mongodb';

async function createUniqueIndex() {
  const client = new MongoClient('mongodb://localhost:27017/payment_service?directConnection=true');
  
  try {
    await client.connect();
    const db = client.db('payment_service');
    const collection = db.collection('transactions');
    
    console.log('\n🔧 Creating unique index on metadata.externalRef...\n');
    
    try {
      // Drop existing non-unique index if it exists
      try {
        await collection.dropIndex('type_1_metadata.externalRef_1_status_1');
        console.log('✅ Dropped existing compound index');
      } catch (e: any) {
        if (e.codeName !== 'IndexNotFound') {
          console.log(`⚠️  Could not drop compound index: ${e.message}`);
        }
      }
      
      // Create unique index on metadata.externalRef
      await collection.createIndex(
        { 'metadata.externalRef': 1 },
        { 
          unique: true,
          sparse: true,
          name: 'metadata.externalRef_1_unique'
        }
      );
      
      console.log('✅ Unique index on metadata.externalRef created successfully!');
      
      // Verify it was created
      const indexes = await collection.indexes();
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
          await collection.dropIndex('metadata.externalRef_1');
        } catch {}
        
        try {
          await collection.dropIndex('metadata.externalRef_1_unique');
        } catch {}
        
        await collection.createIndex(
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
    
  } finally {
    await client.close();
  }
}

createUniqueIndex().catch(console.error);
