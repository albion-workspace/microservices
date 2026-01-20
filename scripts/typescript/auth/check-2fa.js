// Quick script to check user's 2FA status in MongoDB
import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service';

async function checkUser() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db('auth_service');
    const user = await db.collection('users').findOne(
      { email: 'system@demo.com' },
      { 
        projection: { 
          email: 1, 
          username: 1,
          twoFactorEnabled: 1, 
          twoFactorSecret: 1,
          id: 1
        } 
      }
    );
    
    if (user) {
      console.log('\n=== USER 2FA STATUS ===');
      console.log('Email:', user.email);
      console.log('Username:', user.username);
      console.log('ID:', user.id);
      console.log('twoFactorEnabled:', user.twoFactorEnabled, `(type: ${typeof user.twoFactorEnabled})`);
      console.log('Has twoFactorSecret:', !!user.twoFactorSecret);
      console.log('========================\n');
    } else {
      console.log('User not found!');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

checkUser();
