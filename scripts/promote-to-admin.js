/**
 * Promote User to Admin Script
 * Promotes a user to admin role via MongoDB (only updates roles field, doesn't bypass Passport.js)
 */

import { MongoClient } from 'mongodb';

// Note: Use directConnection=true when connecting from outside Docker to avoid replica set discovery
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service?directConnection=true';
const USER_EMAIL = process.argv[2] || 'admin@test.com';

async function promoteToAdmin() {
  // Use directConnection option to bypass replica set discovery when connecting from outside Docker
  const client = new MongoClient(MONGO_URI, {
    directConnection: true,
  });
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const usersCollection = db.collection('users');
    
    // Find user by email
    const user = await usersCollection.findOne({
      email: USER_EMAIL,
    });
    
    if (!user) {
      console.error(`❌ User ${USER_EMAIL} not found`);
      console.log('Available users:');
      const allUsers = await usersCollection.find({}).limit(10).toArray();
      allUsers.forEach(u => {
        console.log(`  - ${u.email || u.username || u.id} (roles: ${u.roles?.join(', ') || 'none'})`);
      });
      process.exit(1);
    }
    
    // Update user to admin and system roles (only roles and permissions, password stays the same)
    // 'system' role allows system operations like funding providers
    await usersCollection.updateOne(
      { id: user.id },
      {
        $set: {
          roles: ['admin', 'system'],
          permissions: ['*:*:*'],
          updatedAt: new Date(),
        },
      }
    );
    
    console.log(`✅ User promoted to admin and system roles successfully!`);
    console.log(`   Email: ${user.email || user.username || user.id}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Roles: admin, system`);
    console.log(`   Permissions: *:*:*`);
    console.log(`\n   You can now login with this user and use admin operations.`);
    
  } catch (error) {
    console.error('❌ Error promoting user:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

promoteToAdmin();
