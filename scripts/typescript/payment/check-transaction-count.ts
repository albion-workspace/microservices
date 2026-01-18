import { MongoClient } from 'mongodb';

async function checkTransactions() {
  const client = new MongoClient('mongodb://localhost:27017');
  
  try {
    await client.connect();
    const db = client.db('payment');
    const collection = db.collection('transactions');
    
    const totalCount = await collection.countDocuments();
    console.log(`\n📊 Total transactions in MongoDB: ${totalCount}`);
    
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
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkTransactions();
