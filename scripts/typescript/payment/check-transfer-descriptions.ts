#!/usr/bin/env npx tsx
import { getPaymentDatabase, getAuthDatabase, closeAllConnections } from '../config/mongodb.js';

async function checkTransfers() {
  const paymentDb = await getPaymentDatabase();
  const authDb = await getAuthDatabase();
  
  const transfers = await paymentDb.collection('transfers')
    .find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
  
  // Get user emails
  const users = await authDb.collection('users').find({}).toArray();
  const userEmailMap = new Map<string, string>();
  users.forEach((u: any) => {
    const userId = u.id || u._id?.toString();
    if (userId && u.email) {
      userEmailMap.set(userId, u.email);
    }
  });
  
  console.log('\n📋 Recent Transfers with Descriptions:\n');
  
  transfers.forEach((t: any, i: number) => {
    const fromEmail = userEmailMap.get(t.fromUserId) || t.fromUserId.substring(0, 8) + '...';
    const toEmail = userEmailMap.get(t.toUserId) || t.toUserId.substring(0, 8) + '...';
    const description = t.meta?.description || 'N/A';
    
    console.log(`Transfer ${i + 1}:`);
    console.log(`  From User: ${fromEmail} (${t.fromUserId.substring(0, 12)}...)`);
    console.log(`  To User: ${toEmail} (${t.toUserId.substring(0, 12)}...)`);
    console.log(`  Description: ${description}`);
    console.log(`  Amount: €${(t.amount / 100).toFixed(2)}`);
    console.log(`  Status: ${t.status}`);
    console.log('');
  });
  
  await closeAllConnections();
}

checkTransfers().catch(console.error);
