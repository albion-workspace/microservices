/**
 * Get Admin User ID
 * Retrieves the user ID for admin@demo.com
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service?directConnection=true';

async function getAdminUserId() {
  const client = new MongoClient(MONGO_URI, { directConnection: true });
  
  try {
    await client.connect();
    const db = client.db();
    
    const adminUser = await db.collection('users').findOne({ email: 'admin@demo.com' });
    
    if (!adminUser) {
      throw new Error('Admin user not found');
    }
    
    console.log('Admin User ID:', adminUser.id);
    console.log('Email:', adminUser.email);
    console.log('Roles:', adminUser.roles);
    
    return adminUser.id;
  } finally {
    await client.close();
  }
}

getAdminUserId().catch(console.error);
