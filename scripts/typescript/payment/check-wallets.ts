#!/usr/bin/env npx tsx
/**
 * Quick script to check current wallet balances
 */

import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient('mongodb://localhost:27017/payment_service?directConnection=true');
  
  try {
    await client.connect();
    const db = client.db();
    
    const wallets = await db.collection('wallets').find({}).toArray();
    
    console.log('\n📊 Current Wallets:\n');
    wallets.forEach((w: any) => {
      const balance = (w.balance || 0) / 100; // Convert from cents
      console.log(`  User: ${w.userId}`);
      console.log(`    Balance: €${balance.toFixed(2)}`);
      console.log(`    Currency: ${w.currency}`);
      console.log(`    Status: ${w.status}`);
      console.log('');
    });
    
    console.log(`Total wallets: ${wallets.length}\n`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
