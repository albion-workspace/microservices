#!/usr/bin/env npx tsx
/**
 * Quick script to check users and their roles
 */

import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient('mongodb://localhost:27017/auth_service?directConnection=true');
  
  try {
    await client.connect();
    const db = client.db();
    
    const users = await db.collection('users').find({}).toArray();
    
    console.log('\n👥 Users in database:\n');
    users.forEach((u: any) => {
      console.log(`  Email: ${u.email || 'N/A'}`);
      console.log(`    ID: ${u.id}`);
      console.log(`    Roles: ${JSON.stringify(u.roles)}`);
      console.log(`    Permissions: ${JSON.stringify(u.permissions)}`);
      console.log('');
    });
    
    // Test the query
    console.log('\n🔍 Testing queries:\n');
    
    const adminUsers = await db.collection('users').find({ roles: { $in: ['admin'] } }).toArray();
    console.log(`Users with 'admin' role: ${adminUsers.length}`);
    adminUsers.forEach((u: any) => console.log(`  - ${u.email} (${u.id})`));
    
    const gatewayUsers = await db.collection('users').find({ roles: { $in: ['payment-gateway'] } }).toArray();
    console.log(`\nUsers with 'payment-gateway' role: ${gatewayUsers.length}`);
    gatewayUsers.forEach((u: any) => console.log(`  - ${u.email} (${u.id})`));
    
    const providerUsers = await db.collection('users').find({ roles: { $in: ['payment-provider'] } }).toArray();
    console.log(`\nUsers with 'payment-provider' role: ${providerUsers.length}`);
    providerUsers.forEach((u: any) => console.log(`  - ${u.email} (${u.id})`));
    
    console.log(`\nTotal users: ${users.length}\n`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
