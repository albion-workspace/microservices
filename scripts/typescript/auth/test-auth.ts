#!/usr/bin/env npx tsx
/**
 * Unified Auth Test Script
 * 
 * Tests authentication flow, Passport lookup, token decoding, and permissions
 * 
 * Usage:
 *   npx tsx scripts/typescript/auth/test-auth.ts login              # Test login flow
 *   npx tsx scripts/typescript/auth/test-auth.ts token             # Decode token
 *   npx tsx scripts/typescript/auth/test-auth.ts passport         # Test Passport lookup
 *   npx tsx scripts/typescript/auth/test-auth.ts permission       # Test permission check
 *   npx tsx scripts/typescript/auth/test-auth.ts trace            # Trace login flow
 */

import { loginAs, users, getUserDefinition } from '../config/users.js';

const AUTH_SERVICE_URL = process.env.AUTH_URL || 'http://localhost:3003/graphql';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_URL || 'http://localhost:3004/graphql';
const DEFAULT_TENANT_ID = 'default-tenant';

async function graphql<T = any>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result: any = await response.json();

  if (result.errors) {
    const errorMessage = result.errors.map((e: any) => e.message).join('; ');
    throw new Error(`GraphQL Error: ${errorMessage}`);
  }

  return result.data as T;
}

function decodeJWT(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT token');
  }
  
  const payload = parts[1];
  const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
  return JSON.parse(decoded);
}

async function login(userKeyOrEmail: string = 'system'): Promise<string> {
  const user = getUserDefinition(userKeyOrEmail);
  const { token } = await loginAs(userKeyOrEmail);
  return token;
}

async function testLogin(userKeyOrEmail: string = 'system') {
  const user = getUserDefinition(userKeyOrEmail);
  const email = user.email;
  const password = user.password;
  console.log('🔐 Testing login...\n');
  
  try {
    const response = await fetch(AUTH_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          mutation Login($input: LoginInput!) {
            login(input: $input) {
              success
              message
              tokens {
                accessToken
              }
              user {
                id
                email
                roles
                permissions
              }
            }
          }
        `,
        variables: {
          input: {
            tenantId: DEFAULT_TENANT_ID,
            identifier: email,
            password: password,
          },
        },
      }),
    });
    
    const result = await response.json();
    
    if (result.errors) {
      console.error('❌ GraphQL errors:', result.errors);
      return;
    }
    
    const loginData = result.data.login;
    
    if (!loginData.success) {
      console.error('❌ Login failed:', loginData.message);
      return;
    }
    
    console.log('✅ Login successful!\n');
    console.log('User object from GraphQL response:');
    console.log(`  ID: ${loginData.user.id}`);
    console.log(`  Email: ${loginData.user.email}`);
    console.log(`  Roles: ${JSON.stringify(loginData.user.roles)}`);
    console.log(`  Permissions: ${JSON.stringify(loginData.user.permissions)}`);
    
    // Decode token
    const token = loginData.tokens.accessToken;
    const payload = decodeJWT(token);
    
    console.log('\n📋 Token payload:');
    console.log(`  sub (User ID): ${payload.sub}`);
    console.log(`  tid (Tenant ID): ${payload.tid}`);
    console.log(`  Roles: ${JSON.stringify(payload.roles)}`);
    console.log(`  Permissions: ${JSON.stringify(payload.permissions)}`);
    
    // Verify consistency
    if (payload.sub !== loginData.user.id) {
      console.log('\n❌ MISMATCH: Token user ID does not match GraphQL user ID!');
      console.log(`  GraphQL user ID: ${loginData.user.id}`);
      console.log(`  Token user ID (sub): ${payload.sub}`);
    } else {
      console.log('\n✅ Token user ID matches GraphQL user ID');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

async function testToken(userKeyOrEmail: string = 'system') {
  const user = getUserDefinition(userKeyOrEmail);
  const email = user.email;
  const password = user.password;
  console.log('🔐 Logging in...');
  const token = await login(email, password);
  
  console.log('\n📋 Decoding JWT token...');
  const payload = decodeJWT(token);
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('JWT TOKEN PAYLOAD:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(JSON.stringify(payload, null, 2));
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('📊 Summary:');
  console.log(`   User ID: ${payload.sub}`);
  console.log(`   Tenant ID: ${payload.tid}`);
  console.log(`   Roles: ${JSON.stringify(payload.roles || [])}`);
  console.log(`   Permissions: ${JSON.stringify(payload.permissions || [])}`);
  console.log(`   Roles count: ${(payload.roles || []).length}`);
  console.log(`   Permissions count: ${(payload.permissions || []).length}`);
  
  if ((payload.roles || []).length === 0) {
    console.log('\n⚠️  WARNING: Token has NO roles!');
  }
  
  if ((payload.permissions || []).length === 0) {
    console.log('\n⚠️  WARNING: Token has NO permissions!');
  }
  
  if ((payload.roles || []).includes('system')) {
    console.log('\n✅ Token has system role');
  } else {
    console.log('\n❌ Token does NOT have system role');
  }
}

async function testPassport(userKeyOrEmail: string = 'system') {
  const user = getUserDefinition(userKeyOrEmail);
  const email = user.email;
  const { MongoClient } = await import('mongodb');
  
  function normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
  
  console.log('🔍 Testing Passport user lookup...\n');
  
  const { getAuthDatabase } = await import('../config/mongodb.js');
  try {
    const db = await getAuthDatabase();
    const usersCollection = db.collection('users');
    
    const identifier = email;
    const tenantId = DEFAULT_TENANT_ID;
    const normalizedEmail = normalizeEmail(identifier);
    
    console.log(`   Identifier: ${identifier}`);
    console.log(`   Normalized email: ${normalizedEmail}`);
    console.log(`   Tenant ID: ${tenantId}`);
    
    const query = { 
      tenantId,
      email: normalizedEmail
    };
    
    console.log(`\n📋 Query:`, JSON.stringify(query, null, 2));
    
    const user = await usersCollection.findOne(query);
    
    if (user) {
      console.log(`\n✅ User found:`);
      console.log(`   ID: ${user.id || user._id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Tenant ID: ${user.tenantId}`);
      console.log(`   Roles: ${JSON.stringify(user.roles || [])}`);
      console.log(`   Permissions: ${JSON.stringify(user.permissions || [])}`);
    } else {
      console.log(`\n❌ User NOT found with query:`, query);
      
      // Try without normalization
      const userNoNorm = await usersCollection.findOne({ tenantId, email: identifier });
      if (userNoNorm) {
        console.log(`\n⚠️  But found user without normalization:`);
        console.log(`   ID: ${userNoNorm.id || userNoNorm._id}`);
        console.log(`   Email: ${userNoNorm.email}`);
      }
    }
    
  } finally {
    const { closeAllConnections } = await import('../config/mongodb.js');
    await closeAllConnections();
  }
}

async function testPermission(userKeyOrEmail: string = 'system') {
  const user = getUserDefinition(userKeyOrEmail);
  const email = user.email;
  const password = user.password;
  console.log('🔐 Logging in...');
  const token = await login(email, password);
  
  console.log('\n📋 Decoding JWT token...');
  const payload = decodeJWT(token);
  console.log(`Roles in token: ${JSON.stringify(payload.roles || [])}`);
  console.log(`Permissions in token: ${JSON.stringify(payload.permissions || [])}`);
  
  // Try to call a mutation that requires system role
  console.log('\n🧪 Testing createTransfer mutation (requires system role)...');
  try {
    const result = await graphql(
      PAYMENT_SERVICE_URL,
      `
        mutation CreateTransfer($input: CreateTransferInput!) {
          createTransfer(input: $input) {
            success
            errors
          }
        }
      `,
      {
        input: {
          fromUserId: 'test-user-id',
          toUserId: 'test-user-id',
          amount: 100,
          currency: 'EUR',
          method: 'transfer',
          description: 'Test transfer',
        },
      },
      token
    );
    console.log('✅ Mutation succeeded');
  } catch (error: any) {
    console.log(`❌ Mutation failed: ${error.message}`);
    if (error.message.includes('Not authorized')) {
      console.log('\n🔍 Analysis:');
      console.log('   The payment service is correctly rejecting the request.');
      console.log('   This means the JWT token does NOT have admin/system roles.');
      console.log(`   Token has roles: ${JSON.stringify(payload.roles || [])}`);
      console.log('   Required roles: ["system"] or authenticated user for transfers');
    }
  }
}

async function testTrace(userKeyOrEmail: string = 'system') {
  console.log('🔐 Testing login and tracing user object...\n');
  
  await testLogin(userKeyOrEmail);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: npx tsx scripts/typescript/auth/test-auth.ts <command> [options]

Commands:
  login [email] [password]
    Test login flow and show user/token data

  token [email] [password]
    Decode JWT token and show payload

  passport [email]
    Test Passport user lookup query

  permission [email] [password]
    Test permission check with payment service

  trace [email] [password]
    Trace complete login flow

Examples:
  npx tsx scripts/typescript/auth/test-auth.ts login
  npx tsx scripts/typescript/auth/test-auth.ts token
  npx tsx scripts/typescript/auth/test-auth.ts passport system@demo.com
  npx tsx scripts/typescript/auth/test-auth.ts permission
  npx tsx scripts/typescript/auth/test-auth.ts trace
`);
    process.exit(1);
  }
  
  const command = args[0];
  const userKeyOrEmail = args[1] || 'system';
  
  try {
    switch (command) {
      case 'login':
        await testLogin(userKeyOrEmail);
        break;
        
      case 'token':
        await testToken(userKeyOrEmail);
        break;
        
      case 'passport':
        await testPassport(userKeyOrEmail);
        break;
        
      case 'permission':
        await testPermission(userKeyOrEmail);
        break;
        
      case 'trace':
        await testTrace(userKeyOrEmail);
        break;
        
      default:
        console.error(`❌ Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
