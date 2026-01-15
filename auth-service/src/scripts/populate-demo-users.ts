/**
 * Populate Demo Users Script
 * Creates demo users with different roles and permissions for testing
 */

import { getDatabase, connectDatabase } from 'core-service';
import { RegistrationService } from '../services/registration.js';
import { OTPProviderFactory } from '../providers/otp-provider.js';
import { loadConfig } from '../config.js';
import { randomUUID } from 'node:crypto';

const DEMO_USERS = [
  {
    email: 'admin@demo.com',
    username: 'admin',
    password: 'Admin123!@#',
    roles: ['admin'],
    permissions: ['*:*:*'],
    status: 'active',
    emailVerified: true,
    metadata: { department: 'IT', level: 'senior' },
  },
  {
    email: 'moderator@demo.com',
    username: 'moderator',
    password: 'Mod123!@#',
    roles: ['moderator'],
    permissions: ['auth:user:read', 'notification:*:*', 'webhook:read:*'],
    status: 'active',
    emailVerified: true,
    metadata: { department: 'Content', level: 'mid' },
  },
  {
    email: 'user1@demo.com',
    username: 'user1',
    password: 'User123!@#',
    roles: ['user'],
    permissions: ['payment:wallet:*', 'bonus:claim:*'],
    status: 'active',
    emailVerified: true,
    metadata: { department: 'Sales', level: 'junior' },
  },
  {
    email: 'user2@demo.com',
    username: 'user2',
    password: 'User123!@#',
    roles: ['user'],
    permissions: ['payment:wallet:read', 'bonus:template:read'],
    status: 'active',
    emailVerified: true,
    metadata: { department: 'Marketing', level: 'junior' },
  },
  {
    email: 'viewer@demo.com',
    username: 'viewer',
    password: 'View123!@#',
    roles: ['viewer'],
    permissions: ['payment:wallet:read', 'bonus:template:read'],
    status: 'active',
    emailVerified: true,
    metadata: { department: 'Analytics', level: 'junior' },
  },
  {
    email: 'pending@demo.com',
    username: 'pending',
    password: 'Pending123!@#',
    roles: ['user'],
    permissions: [],
    status: 'pending',
    emailVerified: false,
    metadata: { department: 'Support', level: 'junior' },
  },
  {
    email: 'suspended@demo.com',
    username: 'suspended',
    password: 'Suspend123!@#',
    roles: ['user'],
    permissions: ['payment:wallet:*'],
    status: 'suspended',
    emailVerified: true,
    metadata: { department: 'Sales', level: 'mid', reason: 'Policy violation' },
  },
];

async function populateDemoUsers() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service';
  
  console.log('Connecting to database...');
  await connectDatabase(mongoUri);
  
  const db = getDatabase();
  const usersCollection = db.collection('users');
  
  // Load config and create registration service
  const config = loadConfig();
  const otpProviders = new OTPProviderFactory(config);
  const registrationService = new RegistrationService(config, otpProviders);
  
  console.log('Creating demo users...');
  
  for (const demoUser of DEMO_USERS) {
    // Check if user already exists
    const existing = await usersCollection.findOne({
      $or: [
        { email: demoUser.email },
        { username: demoUser.username },
      ],
    });
    
    if (existing) {
      console.log(`User ${demoUser.email} already exists, updating roles/permissions...`);
      // Update existing user's roles and permissions
      await usersCollection.updateOne(
        { id: existing.id },
        {
          $set: {
            roles: demoUser.roles,
            permissions: demoUser.permissions,
            status: demoUser.status,
            metadata: demoUser.metadata || {},
            updatedAt: new Date(),
          },
        }
      );
      console.log(`✅ Updated user: ${demoUser.email} (${demoUser.roles.join(', ')})`);
      continue;
    }
    
    // Register user using registration service (handles password hashing)
    try {
      const result = await registrationService.register({
        tenantId: 'default-tenant',
        email: demoUser.email,
        username: demoUser.username,
        password: demoUser.password,
        autoVerify: demoUser.emailVerified,
        metadata: demoUser.metadata,
      });
      
      if (result.success && result.user) {
        // Update roles, permissions, and status after registration
        await usersCollection.updateOne(
          { id: result.user.id },
          {
            $set: {
              roles: demoUser.roles,
              permissions: demoUser.permissions,
              status: demoUser.status,
              emailVerified: demoUser.emailVerified,
              updatedAt: new Date(),
            },
          }
        );
        console.log(`✅ Created user: ${demoUser.email} (${demoUser.roles.join(', ')})`);
      } else {
        console.log(`❌ Failed to create user: ${demoUser.email} - ${result.message}`);
      }
    } catch (err: any) {
      console.log(`❌ Error creating user ${demoUser.email}:`, err.message);
    }
  }
  
  console.log('\n✅ Demo users created successfully!');
  console.log('\nDemo Credentials:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  DEMO_USERS.forEach(u => {
    console.log(`${u.email.padEnd(25)} | ${u.password.padEnd(15)} | ${u.roles.join(', ')}`);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  process.exit(0);
}

populateDemoUsers().catch((err) => {
  console.error('Error populating demo users:', err);
  process.exit(1);
});
