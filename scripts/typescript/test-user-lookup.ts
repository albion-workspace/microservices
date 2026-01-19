#!/usr/bin/env npx tsx
/**
 * Test script to verify user lookup in auth_service database
 */

import { getAuthDatabase, closeAllConnections } from './config/mongodb.js';

async function main() {
  try {
    const db = await getAuthDatabase();
    
    const systemUserId = '696d42a6b5dac3ff318f031f';
    
    console.log(`\n🔍 Looking up system user with ID: ${systemUserId}\n`);
    
    // Try query by id field
    const userById = await db.collection('users').findOne(
      { id: systemUserId },
      { projection: { id: 1, _id: 1, email: 1, permissions: 1, roles: 1 } }
    );
    
    console.log('Query by id field:');
    console.log('  Found:', !!userById);
    if (userById) {
      console.log('  Email:', userById.email);
      console.log('  ID:', userById.id);
      console.log('  _id:', userById._id?.toString());
      console.log('  Permissions:', JSON.stringify(userById.permissions));
      console.log('  Roles:', JSON.stringify(userById.roles));
    }
    
    // Try query by _id field
    const { ObjectId } = await import('mongodb');
    let userBy_id: any = null;
    try {
      if (ObjectId.isValid(systemUserId)) {
        const objectId = new ObjectId(systemUserId);
        userBy_id = await db.collection('users').findOne(
          { _id: objectId },
          { projection: { id: 1, _id: 1, email: 1, permissions: 1, roles: 1 } }
        );
      }
    } catch (e) {
      console.log('  Error querying by _id:', e);
    }
    
    console.log('\nQuery by _id field:');
    console.log('  Found:', !!userBy_id);
    if (userBy_id) {
      console.log('  Email:', userBy_id.email);
      console.log('  ID:', userBy_id.id);
      console.log('  _id:', userBy_id._id?.toString());
      console.log('  Permissions:', JSON.stringify(userBy_id.permissions));
      console.log('  Roles:', JSON.stringify(userBy_id.roles));
    }
    
    // Try query by email
    const userByEmail = await db.collection('users').findOne(
      { email: 'system@demo.com' },
      { projection: { id: 1, _id: 1, email: 1, permissions: 1, roles: 1 } }
    );
    
    console.log('\nQuery by email (system@demo.com):');
    console.log('  Found:', !!userByEmail);
    if (userByEmail) {
      console.log('  Email:', userByEmail.email);
      console.log('  ID:', userByEmail.id);
      console.log('  _id:', userByEmail._id?.toString());
      console.log('  Permissions:', JSON.stringify(userByEmail.permissions));
      console.log('  Roles:', JSON.stringify(userByEmail.roles));
      
      // Check allowNegative
      const permissions = userByEmail.permissions;
      let allowNegative = false;
      if (Array.isArray(permissions)) {
        allowNegative = permissions.includes('allowNegative') || permissions.includes('*:*:*');
      } else if (typeof permissions === 'object') {
        allowNegative = permissions.allowNegative === true || permissions['*:*:*'] === true;
      }
      console.log('\n  allowNegative detected:', allowNegative);
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    await closeAllConnections();
  }
}

main();
