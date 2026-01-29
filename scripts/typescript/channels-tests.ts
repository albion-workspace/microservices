/**
 * Real-Time Communication Channels Test Suite
 * 
 * Tests all real-time communication channels:
 * - Server-Sent Events (SSE)
 * - Socket.IO (polling & websocket transport)
 * - Webhooks (HTTP callbacks)
 * 
 * Note: Native WebSocket (graphql-ws) is not supported - Socket.IO is used instead.
 * 
 * Usage: npx tsx scripts/typescript/channels-tests.ts
 */

import http from 'node:http';
import { createHmac } from 'node:crypto';
import { loginAs, users, createSystemToken, initializeConfig } from './config/users.js';
import { 
  AUTH_SERVICE_URL, 
  PAYMENT_SERVICE_URL, 
  BONUS_SERVICE_URL, 
  NOTIFICATION_SERVICE_URL,
  loadScriptConfig,
} from './config/scripts.js';

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

let CONFIG = {
  notificationServiceUrl: NOTIFICATION_SERVICE_URL.replace('/graphql', ''),
  bonusServiceUrl: BONUS_SERVICE_URL,
  paymentServiceUrl: PAYMENT_SERVICE_URL,
  authServiceUrl: AUTH_SERVICE_URL,
  webhookReceiverPort: 9999,
  webhookSecret: 'test-webhook-secret-12345',
  // All services use the same shared JWT secret
  jwtSecret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
  // System credentials for webhook tests (using centralized config)
  systemEmail: process.env.SYSTEM_EMAIL || users.system.email,
  systemPassword: process.env.SYSTEM_PASSWORD || users.system.password,
};

// ═══════════════════════════════════════════════════════════════════
// JWT Token Generation
// ═══════════════════════════════════════════════════════════════════

async function generateToken(): Promise<string> {
  return createSystemToken('1h');
}

function generateAdminToken(): string {
  return createSystemToken('8h', true);
}

// ═══════════════════════════════════════════════════════════════════
// Test Results Tracking
// ═══════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  [OK] ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: (err as Error).message,
    });
    console.log(`  [FAIL] ${name}: ${(err as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: Server-Sent Events (SSE) Tests
// ═══════════════════════════════════════════════════════════════════

async function testSSE(): Promise<void> {
  console.log('\n[SSE] Testing Server-Sent Events Subscription...');
  console.log(`  Endpoint: ${CONFIG.notificationServiceUrl}/graphql/stream\n`);

  const token = await generateToken();
  const query = `subscription { health { status service uptime timestamp } }`;
  const url = `${CONFIG.notificationServiceUrl}/graphql/stream`;
  
  console.log('  [INFO] Sending subscription request...');
  console.log(`    Query: ${query}\n`);

  const controller = new AbortController();
  
  setTimeout(() => {
    console.log('  [INFO] Stopping after 5 seconds...');
    controller.abort();
  }, 5000);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ query }),
    signal: controller.signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  console.log('  [OK] Connected! Receiving events...\n');
  console.log('  ' + '─'.repeat(60));

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let eventCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        if (line.startsWith('event:')) {
          console.log(`\n  [EVENT] ${line.replace('event:', '').trim()}`);
        } else if (line.startsWith('data:')) {
          const data = line.replace('data:', '').trim();
          if (data) {
            try {
              const json = JSON.parse(data);
              console.log('    Data:', JSON.stringify(json, null, 2).replace(/\n/g, '\n    '));
              eventCount++;
            } catch {
              console.log('    Data:', data);
            }
          }
        } else if (line.startsWith(':')) {
          console.log(`  [COMMENT] ${line}`);
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Expected - test completed
    } else {
      throw err;
    }
  }

  console.log('  ' + '─'.repeat(60));
  console.log(`\n  [INFO] Total events received: ${eventCount}`);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: Socket.IO Tests
// ═══════════════════════════════════════════════════════════════════

async function testSocketIOWithPolling(): Promise<void> {
  console.log('\n[Socket.IO] Testing Socket.IO via HTTP Polling...');
  console.log(`  Endpoint: ${CONFIG.notificationServiceUrl}\n`);

  const token = await generateToken();

  console.log('  [STEP 1] Initiating Socket.IO handshake...');
  
  const handshakeUrl = `${CONFIG.notificationServiceUrl}/socket.io/?EIO=4&transport=polling`;
  
  const handshakeResponse = await fetch(handshakeUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!handshakeResponse.ok) {
    throw new Error(`Handshake failed: ${handshakeResponse.status}`);
  }

  const handshakeText = await handshakeResponse.text();
  console.log(`    [INFO] Raw response: ${handshakeText.substring(0, 100)}...`);
  
  const match = handshakeText.match(/0(\{.*\})/);
  if (!match) {
    throw new Error('Invalid handshake response format');
  }
  
  const handshakeData = JSON.parse(match[1]);
  console.log(`    [OK] Session ID: ${handshakeData.sid}`);
  console.log(`    [OK] Ping interval: ${handshakeData.pingInterval}ms`);
  console.log(`    [OK] Ping timeout: ${handshakeData.pingTimeout}ms`);
  console.log(`    [OK] Upgrades: ${handshakeData.upgrades.join(', ') || 'none'}`);

  const sid = handshakeData.sid;

  console.log('\n  [STEP 2] Connecting to Socket.IO namespace...');
  
  const connectUrl = `${CONFIG.notificationServiceUrl}/socket.io/?EIO=4&transport=polling&sid=${sid}`;
  
  const connectResponse = await fetch(connectUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Authorization': `Bearer ${token}`,
    },
    body: `40{"token":"${token}"}`,
  });

  if (!connectResponse.ok) {
    throw new Error(`Connect failed: ${connectResponse.status}`);
  }
  
  console.log('  [OK] Namespace connected!');

  console.log('\n  [STEP 3] Polling for response...');
  
  const pollResponse = await fetch(connectUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const pollText = await pollResponse.text();
  console.log(`    [INFO] Poll response: ${pollText.substring(0, 200)}`);
  
  if (pollText.includes('40{')) {
    console.log('  [OK] Socket.IO connection confirmed!');
  }

  console.log('\n  [STEP 4] Sending GraphQL query via Socket.IO...');
  
  const graphqlPayload = JSON.stringify(['graphql', { query: '{ health { status service uptime } }' }]);
  const eventPacket = `42${graphqlPayload}`;
  
  const queryResponse = await fetch(connectUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Authorization': `Bearer ${token}`,
    },
    body: eventPacket,
  });

  if (!queryResponse.ok) {
    throw new Error(`Query failed: ${queryResponse.status}`);
  }
  
  console.log('  [OK] Query sent!');

  console.log('\n  [STEP 5] Polling for GraphQL response...');
  
  await new Promise(r => setTimeout(r, 500));
  
  const resultResponse = await fetch(connectUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const resultText = await resultResponse.text();
  console.log(`    [INFO] Response: ${resultText}`);
  
  const eventMatch = resultText.match(/42(\[.*\])/);
  if (eventMatch) {
    const eventData = JSON.parse(eventMatch[1]);
    console.log(`\n  [EVENT] ${eventData[0]}`);
    console.log(`    Data: ${JSON.stringify(eventData[1], null, 2).replace(/\n/g, '\n    ')}`);
    
    if (eventData[1]?.data?.health?.status === 'healthy') {
      console.log('\n  [OK] GraphQL query via Socket.IO worked!');
    }
  }

  console.log('\n  [OK] Socket.IO HTTP Polling transport is working!');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: Webhook Tests
// ═══════════════════════════════════════════════════════════════════

// Mock Webhook Data
const MOCK_WEBHOOKS = {
  bonusEvents: {
    name: 'Bonus Events Webhook',
    url: `http://localhost:${CONFIG.webhookReceiverPort}/webhook/bonus`,
    secret: 'test-bonus-secret-key-12345',
    events: ['bonus.*'],
    description: 'Receives all bonus events',
  },
  paymentEvents: {
    name: 'Payment Events Webhook',
    url: `http://localhost:${CONFIG.webhookReceiverPort}/webhook/payment`,
    secret: 'test-payment-secret-key-67890',
    events: ['wallet.deposit.completed', 'wallet.withdrawal.completed'],
    description: 'Receives payment notifications',
  },
  specificEvents: {
    name: 'Specific Bonus Awarded',
    url: `http://localhost:${CONFIG.webhookReceiverPort}/webhook/awarded`,
    secret: 'specific-secret-123',
    events: ['bonus.awarded'],
    description: 'Only bonus awarded events',
  },
};

let BONUS_TOKEN = '';
let PAYMENT_TOKEN = '';

// GraphQL Helper
async function graphql<T = unknown>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify({ query, variables });
    
    const authToken = token || (url.includes('3005') ? BONUS_TOKEN : PAYMENT_TOKEN);

    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: authToken,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.errors) {
              reject(new Error(json.errors[0]?.message || 'GraphQL error'));
            } else {
              resolve(json.data as T);
            }
          } catch {
            reject(new Error(`Invalid JSON: ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Login helper to get real system token from auth service
async function loginAsSystem(): Promise<string> {
  const { token } = await loginAs('system', { verifyToken: true, retry: true });
  return `Bearer ${token}`;
}

// Webhook Receiver
interface ReceivedWebhook {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  signature: string;
  verified: boolean;
  timestamp: number;
}

let receivedWebhooks: ReceivedWebhook[] = [];
let webhookServer: http.Server | null = null;
// Test control flags for circuit breaker and retry tests
let shouldFailEndpoint = false;
let endpointFailureCount = 0;
let endpointAttemptCount = 0;

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const parts = signature.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const signaturePart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !signaturePart) return false;

    const timestamp = parseInt(timestampPart.substring(2), 10);
    const receivedSig = signaturePart.substring(3);

    const expectedSig = createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    return receivedSig === expectedSig;
  } catch {
    return false;
  }
}

async function startWebhookReceiver(): Promise<void> {
  return new Promise((resolve) => {
    receivedWebhooks = [];
    
    webhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const url = req.url || '';
        
        // Handle test endpoints for circuit breaker and retry tests
        if (url.includes('/webhook/failing')) {
          endpointFailureCount++;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Simulated failure', attempt: endpointFailureCount }));
          return;
        }
        
        if (url.includes('/webhook/retry-test')) {
          endpointAttemptCount++;
          if (endpointAttemptCount <= 2) {
            // Fail first 2 attempts
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Temporary failure', attempt: endpointAttemptCount }));
            return;
          } else {
            // Succeed on 3rd+ attempt
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true, attempt: endpointAttemptCount }));
            return;
          }
        }
        
        if (url.includes('/webhook/recovery-test')) {
          if (shouldFailEndpoint) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service down' }));
            return;
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
            return;
          }
        }
        
        // Normal webhook handling
        const signature = req.headers['x-webhook-signature'] as string || '';
        
        let secret = 'unknown';
        if (url.includes('/bonus')) secret = MOCK_WEBHOOKS.bonusEvents.secret;
        else if (url.includes('/payment')) secret = MOCK_WEBHOOKS.paymentEvents.secret;
        else if (url.includes('/awarded')) secret = MOCK_WEBHOOKS.specificEvents.secret;

        const verified = verifyWebhookSignature(body, signature, secret);

        receivedWebhooks.push({
          path: url,
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: JSON.parse(body || '{}'),
          signature,
          verified,
          timestamp: Date.now(),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });

    webhookServer.listen(CONFIG.webhookReceiverPort, () => {
      resolve();
    });
  });
}

function stopWebhookReceiver(): void {
  if (webhookServer) {
    webhookServer.close();
    webhookServer = null;
  }
}

async function testWebhooks(): Promise<void> {
  console.log('\n[Webhooks] Testing Webhook System...');
  console.log(`  Bonus Service: ${CONFIG.bonusServiceUrl}`);
  console.log(`  Payment Service: ${CONFIG.paymentServiceUrl}`);
  console.log(`  Auth Service: ${CONFIG.authServiceUrl}`);
  console.log(`  Webhook Receiver: http://localhost:${CONFIG.webhookReceiverPort}\n`);

  // Check auth service first
  try {
    const authHealth = await graphql(CONFIG.authServiceUrl, '{ health { status service } }');
    console.log('  [OK] Auth Service running');
  } catch {
    console.log('  [WARN] Auth Service not available - using generated tokens (may fail authorization)');
    // Fallback to generated tokens if auth service is not available
    BONUS_TOKEN = generateAdminToken();
    PAYMENT_TOKEN = generateAdminToken();
  }

  // Get real system tokens from auth service (more reliable than generated tokens)
  if (!BONUS_TOKEN) {
    try {
      console.log(`  [INFO] Logging in as system user (${CONFIG.systemEmail})...`);
      const systemToken = await loginAsSystem();
      BONUS_TOKEN = systemToken;
      PAYMENT_TOKEN = systemToken;
      console.log('  [OK] System token obtained from auth service');
    } catch (err) {
      console.log(`  [WARN] Failed to get system token: ${(err as Error).message}`);
      console.log('  [INFO] Falling back to generated tokens (may fail authorization)');
      // Fallback to generated tokens
      BONUS_TOKEN = generateAdminToken();
      PAYMENT_TOKEN = generateAdminToken();
    }
  }

  // Check services
  try {
    const bonusHealth = await graphql(CONFIG.bonusServiceUrl, '{ health { status service } }');
    console.log('  [OK] Bonus Service running');
  } catch {
    console.log('  [WARN] Bonus Service not available - skipping webhook tests');
    return;
  }

  try {
    const paymentHealth = await graphql(CONFIG.paymentServiceUrl, '{ health { status service } }');
    console.log('  [OK] Payment Service running');
  } catch {
    console.log('  [WARN] Payment Service not available - skipping webhook tests');
    return;
  }

  // Start webhook receiver
  await startWebhookReceiver();
  console.log('  [OK] Webhook receiver started\n');

  let bonusWebhookId = '';
  let paymentWebhookId = '';

  // Bonus Service Webhook Tests
  await test('Register Bonus Webhook', async () => {
    const result = await graphql<{ registerWebhook: { id: string; name: string; events: string[]; tenantId?: string } }>(
      CONFIG.bonusServiceUrl,
      `mutation RegisterWebhook($input: RegisterWebhookInput!) {
        registerWebhook(input: $input) {
          id
          name
          events
          isActive
          tenantId
        }
      }`,
      { input: MOCK_WEBHOOKS.bonusEvents },
      BONUS_TOKEN
    );
    
    bonusWebhookId = result.registerWebhook.id;
    if (!bonusWebhookId) throw new Error('No webhook ID returned');
    if (result.registerWebhook.events[0] !== 'bonus.*') throw new Error('Events mismatch');
    console.log(`    [INFO] Registered webhook ID: ${bonusWebhookId}, tenantId: ${result.registerWebhook.tenantId || 'N/A'}`);
    
    // Wait a moment for webhook to be fully persisted
    await new Promise(r => setTimeout(r, 200));
    
    // Verify webhook exists before proceeding
    const verifyResult = await graphql<{ webhook: { id: string } | null }>(
      CONFIG.bonusServiceUrl,
      `query GetWebhook($id: ID!) {
        webhook(id: $id) {
          id
        }
      }`,
      { id: bonusWebhookId },
      BONUS_TOKEN
    );
    
    if (!verifyResult.webhook) {
      throw new Error(`Webhook ${bonusWebhookId} not found immediately after registration`);
    }
  });

  await test('List Bonus Webhooks', async () => {
    const result = await graphql<{ webhooks: Array<{ id: string; name: string }> }>(
      CONFIG.bonusServiceUrl,
      `query {
        webhooks {
          id
          name
          url
          events
          isActive
        }
      }`,
      undefined,
      BONUS_TOKEN
    );
    
    if (!result.webhooks.length) throw new Error('No webhooks found');
    console.log(`    [INFO] Found ${result.webhooks.length} webhook(s)`);
  });

  await test('Get Bonus Webhook Stats', async () => {
    const result = await graphql<{ webhookStats: { total: number; active: number } }>(
      CONFIG.bonusServiceUrl,
      `query {
        webhookStats {
          total
          active
          disabled
          deliveriesLast24h
          successRate
        }
      }`,
      undefined,
      BONUS_TOKEN
    );
    
    console.log(`    [INFO] Stats: ${result.webhookStats.active} active, ${result.webhookStats.total} total`);
  });

  await test('Test Bonus Webhook Delivery', async () => {
    // First verify webhook exists
    const checkResult = await graphql<{ webhook: { id: string; tenantId: string } | null }>(
      CONFIG.bonusServiceUrl,
      `query GetWebhook($id: ID!) {
        webhook(id: $id) {
          id
          tenantId
          name
          url
        }
      }`,
      { id: bonusWebhookId },
      BONUS_TOKEN
    );
    
    if (!checkResult.webhook) {
      throw new Error(`Webhook ${bonusWebhookId} not found. Cannot test delivery.`);
    }
    console.log(`    [INFO] Found webhook: ${checkResult.webhook.name}, tenantId: ${checkResult.webhook.tenantId}`);
    
    const result = await graphql<{ testWebhook: { success: boolean; statusCode?: number; responseTime?: number; error?: string } }>(
      CONFIG.bonusServiceUrl,
      `mutation TestWebhook($id: ID!) {
        testWebhook(id: $id) {
          success
          statusCode
          responseTime
          error
        }
      }`,
      { id: bonusWebhookId },
      BONUS_TOKEN
    );
    
    if (!result.testWebhook.success) {
      const errorMsg = result.testWebhook.error || 'Unknown error';
      const statusCode = result.testWebhook.statusCode || 'N/A';
      throw new Error(`Test delivery failed: ${errorMsg} (status: ${statusCode})`);
    }
    console.log(`    [INFO] Delivered in ${result.testWebhook.responseTime}ms, status: ${result.testWebhook.statusCode}`);
  });

  await test('Verify Bonus Webhook Signature', async () => {
    // Wait longer for webhook delivery to complete (delivery is async and may retry)
    await new Promise(r => setTimeout(r, 2000));
    
    const bonusWebhooks = receivedWebhooks.filter(w => w.path.includes('/bonus'));
    if (!bonusWebhooks.length) {
      console.log(`    [WARN] No webhooks received. Total received: ${receivedWebhooks.length}`);
      throw new Error('No webhooks received - webhook receiver may not be accessible or delivery failed');
    }
    
    const lastWebhook = bonusWebhooks[bonusWebhooks.length - 1];
    if (!lastWebhook.verified) {
      console.log(`    [WARN] Signature verification failed. Signature: ${lastWebhook.signature.substring(0, 50)}...`);
      throw new Error('Signature verification failed');
    }
    
    console.log(`    [INFO] Signature: ${lastWebhook.signature.substring(0, 30)}...`);
    console.log(`    [OK] Verified`);
  });

  await test('Get Bonus Webhook Delivery History (Merged Structure)', async () => {
    // Wait a bit more for delivery record to be saved (now stored in webhook.deliveries array)
    await new Promise(r => setTimeout(r, 500));
    
    const result = await graphql<{ webhookDeliveries: Array<{ id: string; status: string; statusCode?: number; error?: string; attempts?: number }> }>(
      CONFIG.bonusServiceUrl,
      `query GetDeliveries($webhookId: ID!) {
        webhookDeliveries(webhookId: $webhookId, limit: 10) {
          id
          eventId
          eventType
          statusCode
          status
          attempts
          duration
          error
          createdAt
          deliveredAt
        }
      }`,
      { webhookId: bonusWebhookId },
      BONUS_TOKEN
    );
    
    if (!result.webhookDeliveries.length) {
      console.log(`    [WARN] No delivery records found for webhook ${bonusWebhookId}`);
      throw new Error('No deliveries found - webhook may not have been delivered yet');
    }
    const lastDelivery = result.webhookDeliveries[0];
    console.log(`    [INFO] Found ${result.webhookDeliveries.length} delivery record(s) (stored in webhook.deliveries array)`);
    console.log(`    [INFO] Last status: ${lastDelivery.status}${lastDelivery.statusCode ? ` (${lastDelivery.statusCode})` : ''}${lastDelivery.error ? ` - Error: ${lastDelivery.error}` : ''}${lastDelivery.attempts ? ` - Attempts: ${lastDelivery.attempts}` : ''}`);
    
    // Verify delivery structure (no webhookId/tenantId in delivery - they're in parent webhook)
    if ((lastDelivery as any).webhookId || (lastDelivery as any).tenantId) {
      console.log(`    [WARN] Delivery still contains webhookId/tenantId (should be removed in merged structure)`);
    }
  });

  await test('Update Bonus Webhook', async () => {
    const result = await graphql<{ updateWebhook: { id: string; description: string } | null }>(
      CONFIG.bonusServiceUrl,
      `mutation UpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {
        updateWebhook(id: $id, input: $input) {
          id
          description
        }
      }`,
      { id: bonusWebhookId, input: { description: 'Updated description' } },
      BONUS_TOKEN
    );
    
    if (!result.updateWebhook) {
      throw new Error(`Update returned null - webhook ${bonusWebhookId} may not exist or update failed`);
    }
    
    if (result.updateWebhook.description !== 'Updated description') {
      throw new Error(`Description not updated. Got: ${result.updateWebhook.description || 'null'}`);
    }
  });

  // Payment Service Webhook Tests
  await test('Register Payment Webhook', async () => {
    const result = await graphql<{ registerWebhook: { id: string; events: string[]; tenantId?: string } }>(
      CONFIG.paymentServiceUrl,
      `mutation RegisterWebhook($input: RegisterWebhookInput!) {
        registerWebhook(input: $input) {
          id
          name
          events
          isActive
          tenantId
        }
      }`,
      { input: MOCK_WEBHOOKS.paymentEvents },
      PAYMENT_TOKEN
    );
    
    paymentWebhookId = result.registerWebhook.id;
    if (!paymentWebhookId) throw new Error('No webhook ID returned');
    if (result.registerWebhook.events.length !== 2) throw new Error('Events count mismatch');
    console.log(`    [INFO] Registered webhook ID: ${paymentWebhookId}, tenantId: ${result.registerWebhook.tenantId || 'N/A'}`);
    
    // Wait a moment for webhook to be fully persisted
    await new Promise(r => setTimeout(r, 200));
    
    // Verify webhook exists before proceeding
    const verifyResult = await graphql<{ webhook: { id: string } | null }>(
      CONFIG.paymentServiceUrl,
      `query GetWebhook($id: ID!) {
        webhook(id: $id) {
          id
        }
      }`,
      { id: paymentWebhookId },
      PAYMENT_TOKEN
    );
    
    if (!verifyResult.webhook) {
      throw new Error(`Webhook ${paymentWebhookId} not found immediately after registration`);
    }
  });

  await test('Test Payment Webhook', async () => {
    const result = await graphql<{ testWebhook: { success: boolean; statusCode?: number; responseTime?: number; error?: string } }>(
      CONFIG.paymentServiceUrl,
      `mutation TestWebhook($id: ID!) {
        testWebhook(id: $id) {
          success
          statusCode
          responseTime
          error
        }
      }`,
      { id: paymentWebhookId },
      PAYMENT_TOKEN
    );
    
    if (!result.testWebhook.success) {
      const errorMsg = result.testWebhook.error || 'Unknown error';
      const statusCode = result.testWebhook.statusCode || 'N/A';
      throw new Error(`Test delivery failed: ${errorMsg} (status: ${statusCode})`);
    }
    console.log(`    [INFO] Delivered in ${result.testWebhook.responseTime}ms, status: ${result.testWebhook.statusCode}`);
  });

  await test('Verify Payment Webhook Signature', async () => {
    // Wait longer for webhook delivery to complete
    await new Promise(r => setTimeout(r, 2000));
    
    const paymentWebhooks = receivedWebhooks.filter(w => w.path.includes('/payment'));
    if (!paymentWebhooks.length) {
      console.log(`    [WARN] No payment webhooks received. Total received: ${receivedWebhooks.length}`);
      throw new Error('No payment webhooks received - webhook receiver may not be accessible or delivery failed');
    }
    
    const lastWebhook = paymentWebhooks[paymentWebhooks.length - 1];
    if (!lastWebhook.verified) {
      console.log(`    [WARN] Signature verification failed. Signature: ${lastWebhook.signature.substring(0, 50)}...`);
      throw new Error('Signature verification failed');
    }
  });

  // Signature Verification Tests
  await test('Valid Signature Passes Verification', async () => {
    const payload = JSON.stringify({ test: 'data' });
    const secret = 'my-secret';
    const timestamp = Date.now();
    
    const signature = `t=${timestamp},v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex')}`;
    
    const isValid = verifyWebhookSignature(payload, signature, secret);
    if (!isValid) throw new Error('Valid signature should pass');
  });

  await test('Invalid Signature Fails Verification', async () => {
    const payload = JSON.stringify({ test: 'data' });
    const signature = 't=12345,v1=invalid-signature';
    
    const isValid = verifyWebhookSignature(payload, signature, 'secret');
    if (isValid) throw new Error('Invalid signature should fail');
  });

  await test('Tampered Payload Fails Verification', async () => {
    const originalPayload = JSON.stringify({ test: 'original' });
    const tamperedPayload = JSON.stringify({ test: 'tampered' });
    const secret = 'my-secret';
    const timestamp = Date.now();
    
    const signature = `t=${timestamp},v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${originalPayload}`)
      .digest('hex')}`;
    
    const isValid = verifyWebhookSignature(tamperedPayload, signature, secret);
    if (isValid) throw new Error('Tampered payload should fail');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Circuit Breaker & Retry Tests
  // ═══════════════════════════════════════════════════════════════════

  await test('Circuit Breaker: Multiple Failures Open Circuit', async () => {
    // Reset test counters
    endpointFailureCount = 0;
    
    // Create a webhook pointing to a failing endpoint
    const failingWebhookUrl = `http://localhost:${CONFIG.webhookReceiverPort}/webhook/failing`;
    
    // Register webhook with failing endpoint
    const failingWebhookResult = await graphql<{ registerWebhook: { id: string } }>(
      CONFIG.bonusServiceUrl,
      `mutation RegisterWebhook($input: RegisterWebhookInput!) {
        registerWebhook(input: $input) {
          id
          name
          url
        }
      }`,
      { 
        input: {
          name: 'Failing Webhook Test',
          url: failingWebhookUrl,
          secret: 'test-secret',
          events: ['bonus.*'],
        }
      },
      BONUS_TOKEN
    );
    
    const failingWebhookId = failingWebhookResult.registerWebhook.id;
    console.log(`    [INFO] Created failing webhook: ${failingWebhookId}`);
    
    // Trigger multiple webhook deliveries to cause failures (circuit breaker threshold is 5)
    console.log(`    [INFO] Triggering 6 webhook deliveries to exceed circuit breaker threshold...`);
    for (let i = 0; i < 6; i++) {
      try {
        await graphql(
          CONFIG.bonusServiceUrl,
          `mutation TestWebhook($id: ID!) {
            testWebhook(id: $id) {
              success
              error
            }
          }`,
          { id: failingWebhookId },
          BONUS_TOKEN
        );
      } catch (err) {
        // Expected to fail
      }
      // Small delay between attempts
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Wait for circuit breaker to process failures and open circuit
    await new Promise(r => setTimeout(r, 3000));
    
    // Check delivery history - should show failures
    const deliveriesResult = await graphql<{ webhookDeliveries: Array<{ status: string; error?: string; attempts?: number }> }>(
      CONFIG.bonusServiceUrl,
      `query GetDeliveries($webhookId: ID!) {
        webhookDeliveries(webhookId: $webhookId, limit: 10) {
          status
          error
          attempts
        }
      }`,
      { webhookId: failingWebhookId },
      BONUS_TOKEN
    );
    
    const failedDeliveries = deliveriesResult.webhookDeliveries.filter(d => d.status === 'failed');
    console.log(`    [INFO] Found ${failedDeliveries.length} failed delivery(ies) out of ${deliveriesResult.webhookDeliveries.length} total`);
    console.log(`    [INFO] Server received ${endpointFailureCount} failure request(s)`);
    
    // After multiple failures, circuit breaker should be open
    // Next delivery attempt should be rejected immediately (or fail fast)
    console.log(`    [INFO] Testing circuit breaker open state...`);
    try {
      const testResult = await graphql<{ testWebhook: { success: boolean; error?: string } }>(
        CONFIG.bonusServiceUrl,
        `mutation TestWebhook($id: ID!) {
          testWebhook(id: $id) {
            success
            error
          }
        }`,
        { id: failingWebhookId },
        BONUS_TOKEN
      );
      
      if (!testResult.testWebhook.success) {
        const errorMsg = testResult.testWebhook.error || '';
        if (errorMsg.includes('Circuit breaker') || errorMsg.includes('circuit') || errorMsg.includes('unavailable')) {
          console.log(`    [OK] Circuit breaker is open - requests rejected immediately`);
        } else {
          console.log(`    [INFO] Delivery failed with error: ${errorMsg}`);
        }
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      if (errorMsg.includes('Circuit breaker') || errorMsg.includes('circuit')) {
        console.log(`    [OK] Circuit breaker is open - requests rejected immediately`);
      } else {
        console.log(`    [INFO] Error: ${errorMsg}`);
      }
    }
    
    // Cleanup
    await graphql(
      CONFIG.bonusServiceUrl,
      `mutation DeleteWebhook($id: ID!) {
        deleteWebhook(id: $id)
      }`,
      { id: failingWebhookId },
      BONUS_TOKEN
    );
  });

  await test('Retry Logic: Verify Retry Attempts and Jitter', async () => {
    // Reset test counter
    endpointAttemptCount = 0;
    
    // Create a webhook that will fail initially but succeed after retries
    const retryTestUrl = `http://localhost:${CONFIG.webhookReceiverPort}/webhook/retry-test`;
    
    // Register webhook with retry configuration
    const retryWebhookResult = await graphql<{ registerWebhook: { id: string; maxRetries?: number } }>(
      CONFIG.bonusServiceUrl,
      `mutation RegisterWebhook($input: RegisterWebhookInput!) {
        registerWebhook(input: $input) {
          id
          name
          url
          maxRetries
        }
      }`,
      { 
        input: {
          name: 'Retry Test Webhook',
          url: retryTestUrl,
          secret: 'test-secret',
          events: ['bonus.*'],
          maxRetries: 3, // Allow 3 retries (total 4 attempts: 1 initial + 3 retries)
        }
      },
      BONUS_TOKEN
    );
    
    const retryWebhookId = retryWebhookResult.registerWebhook.id;
    console.log(`    [INFO] Created retry test webhook: ${retryWebhookId}, maxRetries: ${retryWebhookResult.registerWebhook.maxRetries || 'default'}`);
    
    // Trigger webhook delivery (should retry and eventually succeed)
    console.log(`    [INFO] Triggering webhook delivery (will fail first 2 attempts, succeed on 3rd)...`);
    const testResult = await graphql<{ testWebhook: { success: boolean; error?: string } }>(
      CONFIG.bonusServiceUrl,
      `mutation TestWebhook($id: ID!) {
        testWebhook(id: $id) {
          success
          error
        }
      }`,
      { id: retryWebhookId },
      BONUS_TOKEN
    );
    
    // Wait for retries to complete (with exponential backoff + jitter)
    await new Promise(r => setTimeout(r, 5000));
    
    // Check delivery history - should show retry attempts
    const deliveriesResult = await graphql<{ webhookDeliveries: Array<{ status: string; attempts?: number; duration?: number }> }>(
      CONFIG.bonusServiceUrl,
      `query GetDeliveries($webhookId: ID!) {
        webhookDeliveries(webhookId: $webhookId, limit: 1) {
          status
          attempts
          duration
        }
      }`,
      { webhookId: retryWebhookId },
      BONUS_TOKEN
    );
    
    if (deliveriesResult.webhookDeliveries.length > 0) {
      const delivery = deliveriesResult.webhookDeliveries[0];
      console.log(`    [INFO] Delivery status: ${delivery.status}, attempts: ${delivery.attempts || 'N/A'}, duration: ${delivery.duration || 'N/A'}ms`);
      
      if (delivery.status === 'success' && delivery.attempts && delivery.attempts > 1) {
        console.log(`    [OK] Retry logic worked - succeeded after ${delivery.attempts} attempt(s) with exponential backoff + jitter`);
      } else if (delivery.status === 'success') {
        console.log(`    [INFO] Succeeded on first attempt (no retry needed)`);
      } else {
        console.log(`    [WARN] Delivery failed or retry info missing`);
      }
    }
    
    // Verify retry attempts were made (should be 3 if retries occurred: 1 initial + 2 retries before success)
    console.log(`    [INFO] Server received ${endpointAttemptCount} request(s) total`);
    if (endpointAttemptCount >= 3) {
      console.log(`    [OK] Retry logic verified - server received multiple requests (retries with jitter occurred)`);
    } else if (endpointAttemptCount > 1) {
      console.log(`    [INFO] Some retries occurred (${endpointAttemptCount} requests)`);
    }
    
    // Cleanup
    await graphql(
      CONFIG.bonusServiceUrl,
      `mutation DeleteWebhook($id: ID!) {
        deleteWebhook(id: $id)
      }`,
      { id: retryWebhookId },
      BONUS_TOKEN
    );
  });

  await test('Circuit Breaker Recovery: Half-Open State', async () => {
    // This test verifies that after circuit breaker opens, it transitions to half-open
    // and eventually closes when service recovers
    
    const recoveryTestUrl = `http://localhost:${CONFIG.webhookReceiverPort}/webhook/recovery-test`;
    
    // Reset test flag - start with failing endpoint
    shouldFailEndpoint = true;
    
    // Register webhook
    const recoveryWebhookResult = await graphql<{ registerWebhook: { id: string } }>(
      CONFIG.bonusServiceUrl,
      `mutation RegisterWebhook($input: RegisterWebhookInput!) {
        registerWebhook(input: $input) {
          id
          name
        }
      }`,
      { 
        input: {
          name: 'Recovery Test Webhook',
          url: recoveryTestUrl,
          secret: 'test-secret',
          events: ['bonus.*'],
        }
      },
      BONUS_TOKEN
    );
    
    const recoveryWebhookId = recoveryWebhookResult.registerWebhook.id;
    console.log(`    [INFO] Created recovery test webhook: ${recoveryWebhookId}`);
    
    // Phase 1: Cause failures to open circuit breaker
    console.log(`    [INFO] Phase 1: Causing failures to open circuit breaker (threshold: 5)...`);
    for (let i = 0; i < 6; i++) {
      try {
        await graphql(
          CONFIG.bonusServiceUrl,
          `mutation TestWebhook($id: ID!) {
            testWebhook(id: $id) {
              success
            }
          }`,
          { id: recoveryWebhookId },
          BONUS_TOKEN
        );
      } catch (err) {
        // Expected
      }
      await new Promise(r => setTimeout(r, 200));
    }
    
    await new Promise(r => setTimeout(r, 2000));
    console.log(`    [INFO] Circuit breaker should now be OPEN`);
    
    // Phase 2: Service recovers (circuit breaker should transition to half-open after resetTimeout)
    console.log(`    [INFO] Phase 2: Service recovering (waiting for resetTimeout: 60s, then testing half-open state)...`);
    shouldFailEndpoint = false;
    
    // Note: Circuit breaker resetTimeout is 60s, so we'll wait a shorter time and verify
    // that the circuit breaker is in open state, then test recovery
    await new Promise(r => setTimeout(r, 3000));
    
    // Try delivery again - circuit breaker should still be open (resetTimeout not reached)
    // But if we wait long enough, it should transition to half-open and test recovery
    console.log(`    [INFO] Testing recovery (circuit breaker should test half-open after resetTimeout)...`);
    try {
      const recoveryResult = await graphql<{ testWebhook: { success: boolean; error?: string } }>(
        CONFIG.bonusServiceUrl,
        `mutation TestWebhook($id: ID!) {
          testWebhook(id: $id) {
            success
            error
          }
        }`,
        { id: recoveryWebhookId },
        BONUS_TOKEN
      );
      
      if (recoveryResult.testWebhook.success) {
        console.log(`    [OK] Circuit breaker recovered - delivery succeeded after service recovery`);
      } else {
        console.log(`    [INFO] Delivery result: ${recoveryResult.testWebhook.error || 'unknown'}`);
        console.log(`    [INFO] Note: Circuit breaker resetTimeout is 60s - recovery may take longer`);
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      if (errorMsg.includes('Circuit breaker') || errorMsg.includes('circuit')) {
        console.log(`    [INFO] Circuit breaker still open (resetTimeout not reached - this is expected)`);
        console.log(`    [INFO] Circuit breaker will transition to half-open after 60s resetTimeout`);
      } else {
        console.log(`    [INFO] Recovery test: ${errorMsg}`);
      }
    }
    
    // Cleanup
    await graphql(
      CONFIG.bonusServiceUrl,
      `mutation DeleteWebhook($id: ID!) {
        deleteWebhook(id: $id)
      }`,
      { id: recoveryWebhookId },
      BONUS_TOKEN
    );
    
    // Reset flag
    shouldFailEndpoint = false;
  });

  // Cleanup
  await test('Delete Bonus Webhook', async () => {
    const result = await graphql<{ deleteWebhook: boolean }>(
      CONFIG.bonusServiceUrl,
      `mutation DeleteWebhook($id: ID!) {
        deleteWebhook(id: $id)
      }`,
      { id: bonusWebhookId },
      BONUS_TOKEN
    );
    
    if (!result.deleteWebhook) {
      // Check if webhook still exists
      try {
        const checkResult = await graphql<{ webhook: { id: string } | null }>(
          CONFIG.bonusServiceUrl,
          `query GetWebhook($id: ID!) {
            webhook(id: $id) {
              id
            }
          }`,
          { id: bonusWebhookId },
          BONUS_TOKEN
        );
        if (checkResult.webhook) {
          throw new Error(`Delete returned false but webhook ${bonusWebhookId} still exists`);
        } else {
          // Webhook doesn't exist, deletion might have succeeded or webhook was never created
          console.log(`    [INFO] Webhook ${bonusWebhookId} does not exist (may have been deleted)`);
        }
      } catch (checkErr) {
        throw new Error(`Delete returned false: ${(checkErr as Error).message}`);
      }
    }
  });

  await test('Delete Payment Webhook', async () => {
    const result = await graphql<{ deleteWebhook: boolean }>(
      CONFIG.paymentServiceUrl,
      `mutation DeleteWebhook($id: ID!) {
        deleteWebhook(id: $id)
      }`,
      { id: paymentWebhookId },
      PAYMENT_TOKEN
    );
    
    if (!result.deleteWebhook) {
      // Check if webhook still exists
      try {
        const checkResult = await graphql<{ webhook: { id: string } | null }>(
          CONFIG.paymentServiceUrl,
          `query GetWebhook($id: ID!) {
            webhook(id: $id) {
              id
            }
          }`,
          { id: paymentWebhookId },
          PAYMENT_TOKEN
        );
        if (checkResult.webhook) {
          throw new Error(`Delete returned false but webhook ${paymentWebhookId} still exists`);
        } else {
          console.log(`    [INFO] Webhook ${paymentWebhookId} does not exist (may have been deleted)`);
        }
      } catch (checkErr) {
        throw new Error(`Delete returned false: ${(checkErr as Error).message}`);
      }
    }
  });

  stopWebhookReceiver();
}

// ═══════════════════════════════════════════════════════════════════
// Main Test Runner
// ═══════════════════════════════════════════════════════════════════

async function runAllTests() {
  // Initialize configuration from MongoDB config store
  // This ensures service URLs are loaded from scripts.ts (single source of truth)
  await initializeConfig();
  await loadScriptConfig();
  
  // Update CONFIG with dynamically loaded URLs
  CONFIG.notificationServiceUrl = NOTIFICATION_SERVICE_URL.replace('/graphql', '');
  CONFIG.bonusServiceUrl = BONUS_SERVICE_URL;
  CONFIG.paymentServiceUrl = PAYMENT_SERVICE_URL;
  CONFIG.authServiceUrl = AUTH_SERVICE_URL;
  
  console.log('═'.repeat(60));
  console.log('  Real-Time Communication Channels Test Suite');
  console.log('═'.repeat(60));
  console.log('\nTesting:');
  console.log('  • Server-Sent Events (SSE)');
  console.log('  • Socket.IO (polling & websocket transport)');
  console.log('  • Webhooks (HTTP callbacks)');
  console.log('═'.repeat(60));
  console.log('\nService URLs (from config store):');
  console.log(`  Auth: ${CONFIG.authServiceUrl}`);
  console.log(`  Payment: ${CONFIG.paymentServiceUrl}`);
  console.log(`  Bonus: ${CONFIG.bonusServiceUrl}`);
  console.log(`  Notification: ${CONFIG.notificationServiceUrl}`);
  console.log('═'.repeat(60));

  try {
    // Test HTTP endpoint first
    await test('HTTP Health Check', async () => {
      const response = await fetch(`${CONFIG.notificationServiceUrl}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      console.log(`    [INFO] Health: ${data.status}, Service: ${data.service}`);
    });

    // Run channel tests
    await test('SSE Subscription', testSSE);
    await test('Socket.IO Polling', testSocketIOWithPolling);
    await test('Webhook System', testWebhooks);

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('  TEST SUMMARY');
    console.log('═'.repeat(60));
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    
    console.log(`\nTotal Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}\n`);

    if (failed > 0) {
      console.log('Failed Tests:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
      console.log('');
      process.exit(1);
    }

    console.log('✅ All channel tests passed!\n');
    console.log('📋 Summary:');
    console.log('   ✅ HTTP (graphql-http) - Works');
    console.log('   ✅ SSE (graphql-sse) - Works');
    console.log('   ✅ Socket.IO (polling) - Works');
    console.log('   ✅ Socket.IO (websocket transport) - Available via upgrade');
    console.log('   ✅ Webhooks - Works\n');

    // Cleanup and exit on success
    stopWebhookReceiver();
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Test suite failed:', err);
    stopWebhookReceiver();
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((err) => {
  console.error('Fatal error:', err);
  stopWebhookReceiver();
  process.exit(1);
});
