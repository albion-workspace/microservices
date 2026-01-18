#!/usr/bin/env npx tsx
/**
 * Test Registration
 */

const AUTH_SERVICE_URL = 'http://localhost:3003/graphql';

async function graphql<T = any>(
  url: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function main() {
  try {
    console.log('Testing registration...\n');
    
    const result = await graphql<{ register: { success: boolean; message?: string; user?: { id: string; email: string } } }>(
      AUTH_SERVICE_URL,
      `
        mutation Register($input: RegisterInput!) {
          register(input: $input) {
            success
            message
            user {
              id
              email
            }
          }
        }
      `,
      {
        input: {
          email: 'admin@demo.com',
          password: 'Admin123!@#',
          tenantId: 'default-tenant',
        },
      }
    );
    
    console.log('Registration result:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.register.success) {
      console.log('\n✅ Registration successful!');
      console.log(`   User ID: ${result.register.user?.id}`);
      console.log(`   Email: ${result.register.user?.email}`);
    } else {
      console.log('\n❌ Registration failed!');
      console.log(`   Message: ${result.register.message}`);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

main().catch(console.error);
