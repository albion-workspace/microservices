/**
 * Generic Microservice Load Test
 * 
 * Simulates realistic load with concurrent users across multiple services.
 * 
 * Usage:
 *   npx tsx load-test.ts                           # Test all services
 *   npx tsx load-test.ts --service bonus           # Test specific service
 *   npx tsx load-test.ts --users 1000 --duration 30
 *   npx tsx load-test.ts --full                    # Extended test with scaling
 * 
 * Environment Variables:
 *   BONUS_URL, PAYMENT_URL, RETAIL_URL - Service URLs
 */

import http from 'node:http';
import { createHmac } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// JWT Token Generation
// ═══════════════════════════════════════════════════════════════════

const SERVICE_SECRETS: Record<string, string> = {
  bonus: process.env.BONUS_JWT_SECRET || 'bonus-service-secret-change-in-production',
  payment: process.env.PAYMENT_JWT_SECRET || 'payment-gateway-secret-change-in-production',
  retail: process.env.RETAIL_JWT_SECRET || 'retail-app-secret-change-in-production',
};

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function generateAdminToken(secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'load-test-user',
    tid: 'load-test',
    roles: ['admin'],
    permissions: ['*:*:*'],
    type: 'access',
    iat: now,
    exp: now + 8 * 60 * 60, // 8 hours
  };
  
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  
  return `Bearer ${headerB64}.${payloadB64}.${signature}`;
}

// ═══════════════════════════════════════════════════════════════════
// Service Registry
// ═══════════════════════════════════════════════════════════════════

interface ServiceConfig {
  name: string;
  url: string;
  readQuery: string;
  writeQuery: string;
  writeVariables: () => Record<string, unknown>;
  countQuery: string;
  countExtractor: (data: unknown) => number;
  description: string;
}

const SERVICES: Record<string, ServiceConfig> = {
  bonus: {
    name: 'bonus-service',
    url: process.env.BONUS_URL || 'http://localhost:3005/graphql',
    readQuery: `query { bonusTemplates(take: 10, skip: \${skip}) { nodes { id code type } totalCount } }`,
    writeQuery: `mutation CreateTemplate($input: CreateBonusTemplateInput!) {
      createBonusTemplate(input: $input) { success bonusTemplate { id } }
    }`,
    writeVariables: () => ({
      input: {
        code: `LOAD-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: 'Load Test Bonus',
        type: 'activity',
        domain: 'universal',
        currency: 'USD',
        valueType: 'fixed',
        value: 10,
        turnoverMultiplier: 1,
        durationDays: 30,
        isActive: false,
      },
    }),
    countQuery: '{ bonusTemplates { totalCount } }',
    countExtractor: (data: any) => data?.bonusTemplates?.totalCount || 0,
    description: 'Bonus service',
  },
  payment: {
    name: 'payment-gateway',
    url: process.env.PAYMENT_URL || 'http://localhost:3004/graphql',
    readQuery: `query { wallets(take: 10, skip: \${skip}) { nodes { id balance currency } totalCount } }`,
    writeQuery: `mutation CreateWallet($input: CreateWalletInput!) {
      createWallet(input: $input) { success wallet { id } }
    }`,
    writeVariables: () => ({
      input: {
        userId: `load-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        currency: 'USD',
      },
    }),
    countQuery: '{ wallets { totalCount } }',
    countExtractor: (data: any) => data?.wallets?.totalCount || 0,
    description: 'Payment gateway',
  },
  retail: {
    name: 'retail-app',
    url: process.env.RETAIL_URL || 'http://localhost:3000/graphql',
    readQuery: `query { terminals(take: 10, skip: \${skip}) { nodes { id name } totalCount } }`,
    writeQuery: `mutation CreateTerminal($input: CreateTerminalInput!) {
      createTerminal(input: $input) { success terminal { id } }
    }`,
    writeVariables: () => ({
      input: {
        name: `LOAD-${Date.now()}`,
        branchId: '999',
        securityCode: `LOAD-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    }),
    countQuery: '{ terminals { totalCount } }',
    countExtractor: (data: any) => data?.terminals?.totalCount || 0,
    description: 'Retail app',
  },
};

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const LOAD_TEST_CONFIG = {
  seedBatchSize: 100,
  progressReportInterval: 10,
  warmupUsers: 10,
  warmupDuration: 2,
  defaultReadWriteRatio: 0.8,
  progressReportMs: 500,
};

const DEFAULT_CONCURRENT_USERS = [100, 500, 1000];
const DEFAULT_TEST_DURATION = 10; // seconds

const AGENT_CONFIG = {
  keepAlive: true,
  maxSockets: 1000,
  maxFreeSockets: 100,
};

// ═══════════════════════════════════════════════════════════════════
// HTTP Client
// ═══════════════════════════════════════════════════════════════════

const agent = new http.Agent(AGENT_CONFIG);

async function graphql(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const parsedUrl = new URL(url);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(data)),
    };
    
    if (token) {
      headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    }
    
    const req = http.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
      method: 'POST',
      agent,
      headers,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ errors: [{ message: body }] });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sample = arr.length > 10000 
    ? arr.filter((_, i) => i % Math.ceil(arr.length / 10000) === 0)
    : arr;
  const sorted = [...sample].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ═══════════════════════════════════════════════════════════════════
// Service Discovery
// ═══════════════════════════════════════════════════════════════════

async function discoverServices(): Promise<Array<{ config: ServiceConfig; token: string }>> {
  const discovered: Array<{ config: ServiceConfig; token: string }> = [];
  
  console.log('🔍 Discovering available services...\n');
  
  for (const [key, config] of Object.entries(SERVICES)) {
    try {
      const result = await graphql(config.url, '{ health { status } }');
      if (result.data) {
        // Generate a token using the service's JWT secret
        const secret = SERVICE_SECRETS[key];
        let token = '';
        
        if (secret) {
          token = generateAdminToken(secret);
          console.log(`  ✅ ${config.name} at ${config.url} (auto-generated token)`);
        } else {
          console.log(`  ✅ ${config.name} at ${config.url} (no auth)`);
        }
        
        discovered.push({ config, token });
      }
    } catch (err) {
      console.log(`  ❌ ${config.name}: Not available`);
    }
  }
  
  return discovered;
}

// ═══════════════════════════════════════════════════════════════════
// Seed Database
// ═══════════════════════════════════════════════════════════════════

async function seedDatabase(
  config: ServiceConfig,
  count: number,
  token: string
): Promise<void> {
  console.log(`\n📦 Seeding ${formatNumber(count)} records to ${config.name}...`);
  
  const batchSize = LOAD_TEST_CONFIG.seedBatchSize;
  const batches = Math.ceil(count / batchSize);
  let created = 0;
  const startTime = Date.now();
  
  for (let b = 0; b < batches; b++) {
    const promises: Promise<any>[] = [];
    
    for (let i = 0; i < batchSize && created < count; i++) {
      const variables = config.writeVariables();
      promises.push(graphql(config.url, config.writeQuery, variables, token));
      created++;
    }
    
    await Promise.all(promises);
    
    if ((b + 1) % LOAD_TEST_CONFIG.progressReportInterval === 0 || b === batches - 1) {
      const progress = ((created / count) * 100).toFixed(1);
      const elapsed = Date.now() - startTime;
      const rate = Math.round(created / (elapsed / 1000));
      process.stdout.write(`\r  Progress: ${progress}% (${formatNumber(created)}/${formatNumber(count)}) - ${rate} rec/sec`);
    }
  }
  
  console.log(`\n  ✅ Seeded ${formatNumber(count)} records in ${formatMs(Date.now() - startTime)}`);
}

// ═══════════════════════════════════════════════════════════════════
// Load Test
// ═══════════════════════════════════════════════════════════════════

interface LoadTestResult {
  service: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTimeMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  rps: number;
  readLatencies: number[];
  writeLatencies: number[];
}

async function runLoadTest(
  config: ServiceConfig,
  token: string,
  concurrentUsers: number,
  durationSeconds: number,
  readWriteRatio: number = 0.8
): Promise<LoadTestResult> {
  console.log(`\n🔥 Load Test: ${config.name} - ${formatNumber(concurrentUsers)} users, ${durationSeconds}s`);
  
  const results: { latency: number; success: boolean; type: 'read' | 'write' }[] = [];
  const endTime = Date.now() + (durationSeconds * 1000);
  let activeWorkers = 0;
  
  // Read operation
  async function doRead(): Promise<{ latency: number; success: boolean }> {
    const start = Date.now();
    try {
      const skip = Math.floor(Math.random() * 100);
      const query = config.readQuery.replace('${skip}', String(skip));
      const result = await graphql(config.url, query, undefined, token);
      return { latency: Date.now() - start, success: !result.errors };
    } catch {
      return { latency: Date.now() - start, success: false };
    }
  }
  
  // Write operation
  async function doWrite(): Promise<{ latency: number; success: boolean }> {
    const start = Date.now();
    try {
      const variables = config.writeVariables();
      const result = await graphql(config.url, config.writeQuery, variables, token);
      return { latency: Date.now() - start, success: !result.errors };
    } catch {
      return { latency: Date.now() - start, success: false };
    }
  }
  
  // Worker function
  async function worker() {
    activeWorkers++;
    while (Date.now() < endTime) {
      const isRead = Math.random() < readWriteRatio;
      const { latency, success } = isRead ? await doRead() : await doWrite();
      results.push({ latency, success, type: isRead ? 'read' : 'write' });
    }
    activeWorkers--;
  }
  
  // Start all workers
  const startTime = Date.now();
  const workers = Array(concurrentUsers).fill(null).map(() => worker());
  
  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const rps = Math.round(results.length / elapsed);
    const successRate = results.length > 0 
      ? ((results.filter(r => r.success).length / results.length) * 100).toFixed(1)
      : '0';
    process.stdout.write(`\r  Running... ${results.length} requests, ${rps} rps, ${successRate}% success`);
  }, LOAD_TEST_CONFIG.progressReportMs);
  
  await Promise.all(workers);
  clearInterval(progressInterval);
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  
  // Calculate results
  if (results.length === 0) {
    return {
      service: config.name,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTimeMs: Date.now() - startTime,
      avgLatencyMs: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      rps: 0,
      readLatencies: [],
      writeLatencies: [],
    };
  }
  
  const totalTimeMs = Date.now() - startTime;
  const latencies = results.map(r => r.latency);
  const readLatencies = results.filter(r => r.type === 'read').map(r => r.latency);
  const writeLatencies = results.filter(r => r.type === 'write').map(r => r.latency);
  
  return {
    service: config.name,
    totalRequests: results.length,
    successfulRequests: results.filter(r => r.success).length,
    failedRequests: results.filter(r => !r.success).length,
    totalTimeMs,
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    rps: Math.round(results.length / (totalTimeMs / 1000)),
    readLatencies,
    writeLatencies,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Output Formatting
// ═══════════════════════════════════════════════════════════════════

function printResults(result: LoadTestResult, label: string) {
  const successRate = result.totalRequests > 0 
    ? ((result.successfulRequests / result.totalRequests) * 100).toFixed(2)
    : '0';
  const readAvg = result.readLatencies.length 
    ? Math.round(result.readLatencies.reduce((a, b) => a + b, 0) / result.readLatencies.length)
    : 0;
  const writeAvg = result.writeLatencies.length
    ? Math.round(result.writeLatencies.reduce((a, b) => a + b, 0) / result.writeLatencies.length)
    : 0;
  
  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│ ${label.padEnd(67)} │
├─────────────────────────────────────────────────────────────────────┤
│ Service:         ${result.service.padEnd(49)} │
│ Total Requests:  ${formatNumber(result.totalRequests).padStart(10)}                                    │
│ Successful:      ${formatNumber(result.successfulRequests).padStart(10)} (${successRate}%)                           │
│ Failed:          ${formatNumber(result.failedRequests).padStart(10)}                                    │
│ Duration:        ${formatMs(result.totalTimeMs).padStart(10)}                                    │
├─────────────────────────────────────────────────────────────────────┤
│ THROUGHPUT                                                          │
│ Requests/sec:    ${formatNumber(result.rps).padStart(10)} RPS                                 │
├─────────────────────────────────────────────────────────────────────┤
│ LATENCY                                                             │
│ Average:         ${formatMs(result.avgLatencyMs).padStart(10)}    P50: ${formatMs(result.p50LatencyMs).padStart(7)}                  │
│ Min:             ${formatMs(result.minLatencyMs).padStart(10)}    P95: ${formatMs(result.p95LatencyMs).padStart(7)}                  │
│ Max:             ${formatMs(result.maxLatencyMs).padStart(10)}    P99: ${formatMs(result.p99LatencyMs).padStart(7)}                  │
├─────────────────────────────────────────────────────────────────────┤
│ BY OPERATION                                                        │
│ Read Avg:        ${formatMs(readAvg).padStart(10)} (${result.readLatencies.length} ops)                      │
│ Write Avg:       ${formatMs(writeAvg).padStart(10)} (${result.writeLatencies.length} ops)                     │
└─────────────────────────────────────────────────────────────────────┘`);
}

function printSummary(allResults: LoadTestResult[]) {
  console.log('\n' + '═'.repeat(70));
  console.log('FINAL SUMMARY');
  console.log('═'.repeat(70));

  console.log('\n┌────────────────────────────────────────┬────────┬─────────┬─────────┬─────────┐');
  console.log('│ Service / Users                        │   RPS  │  P50    │  P95    │  P99    │');
  console.log('├────────────────────────────────────────┼────────┼─────────┼─────────┼─────────┤');
  
  for (const result of allResults) {
    const label = `${result.service}`.slice(0, 38);
    console.log(`│ ${label.padEnd(38)} │ ${formatNumber(result.rps).padStart(6)} │ ${formatMs(result.p50LatencyMs).padStart(7)} │ ${formatMs(result.p95LatencyMs).padStart(7)} │ ${formatMs(result.p99LatencyMs).padStart(7)} │`);
  }
  
  console.log('└────────────────────────────────────────┴────────┴─────────┴─────────┴─────────┘');

  // Capacity estimation
  const bestRps = Math.max(...allResults.map(r => r.rps));
  const avgRps = allResults.length > 0 
    ? Math.round(allResults.reduce((a, r) => a + r.rps, 0) / allResults.length)
    : 0;

  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                       CAPACITY ESTIMATION                              ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                        ║
║  Best RPS achieved:     ${formatNumber(bestRps).padStart(6)} req/sec                              ║
║  Average RPS:           ${formatNumber(avgRps).padStart(6)} req/sec                              ║
║                                                                        ║
║  Users supported (1 req/5s):  ${formatNumber(avgRps * 5).padStart(8)} users                      ║
║  Users supported (1 req/2s):  ${formatNumber(avgRps * 2).padStart(8)} users                      ║
║  Users supported (1 req/1s):  ${formatNumber(avgRps).padStart(8)} users                      ║
║                                                                        ║
║  To reach 10K users (1 req/5s): Need ${formatNumber(Math.ceil(10000 / (avgRps * 5 || 1)))} node(s)               ║
║  To reach 50K users (1 req/5s): Need ${formatNumber(Math.ceil(50000 / (avgRps * 5 || 1)))} node(s)               ║
╚═══════════════════════════════════════════════════════════════════════╝`);
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║              GENERIC MICROSERVICE LOAD TEST                                ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Simulates realistic load with:                                            ║
║  • Concurrent users: 100 → 500 → 1000                                     ║
║  • Read/Write ratio: 80% reads, 20% writes                                ║
║  • Multiple services tested simultaneously                                 ║
║                                                                            ║
║  Options:                                                                  ║
║    --service <name>    Test specific service (bonus, payment, retail)     ║
║    --users <n>         Number of concurrent users (default: 100,500,1000) ║
║    --duration <s>      Test duration in seconds (default: 10)             ║
║    --seed <n>          Seed database with N records before test           ║
║    --full              Extended test with more users and scaling          ║
╚═══════════════════════════════════════════════════════════════════════════╝`);

  // Parse command line args
  const args = process.argv.slice(2);
  
  const serviceArg = args.find(a => a.startsWith('--service='))?.split('=')[1]
    || (args.includes('--service') ? args[args.indexOf('--service') + 1] : null);
  
  const usersArg = args.find(a => a.startsWith('--users='))?.split('=')[1]
    || (args.includes('--users') ? args[args.indexOf('--users') + 1] : null);
  
  const durationArg = args.find(a => a.startsWith('--duration='))?.split('=')[1]
    || (args.includes('--duration') ? args[args.indexOf('--duration') + 1] : null);
  
  const seedArg = args.find(a => a.startsWith('--seed='))?.split('=')[1]
    || (args.includes('--seed') ? args[args.indexOf('--seed') + 1] : null);
  
  const fullTest = args.includes('--full');
  
  const userCounts = usersArg 
    ? usersArg.split(',').map(Number)
    : (fullTest ? [100, 500, 1000, 2000] : DEFAULT_CONCURRENT_USERS);
  
  const duration = durationArg ? parseInt(durationArg, 10) : DEFAULT_TEST_DURATION;

  // Discover or select services
  let servicesToTest: Array<{ config: ServiceConfig; token: string }> = [];
  
  if (serviceArg && SERVICES[serviceArg]) {
    const config = SERVICES[serviceArg];
    const secret = SERVICE_SECRETS[serviceArg];
    const token = secret ? generateAdminToken(secret) : '';
    servicesToTest = [{ config, token }];
    console.log(`\n📌 Testing specific service: ${serviceArg} (auto-generated token)`);
  } else {
    servicesToTest = await discoverServices();
  }
  
  if (servicesToTest.length === 0) {
    console.log('\n❌ No services available. Make sure services are running.');
    process.exit(1);
  }

  // Seed if requested
  if (seedArg) {
    const seedCount = parseInt(seedArg, 10);
    for (const { config, token } of servicesToTest) {
      await seedDatabase(config, seedCount, token);
    }
  }

  // Get current record counts
  console.log('\n📊 Current database sizes:');
  for (const { config, token } of servicesToTest) {
    try {
      const result = await graphql(config.url, config.countQuery, undefined, token);
      const count = config.countExtractor(result.data);
      console.log(`  ${config.name}: ${formatNumber(count)} records`);
    } catch {
      console.log(`  ${config.name}: Unable to get count`);
    }
  }

  // Run warmup
  console.log('\n🔄 Warming up...');
  for (const { config, token } of servicesToTest) {
    await runLoadTest(config, token, LOAD_TEST_CONFIG.warmupUsers, LOAD_TEST_CONFIG.warmupDuration);
  }

  // Run load tests
  const allResults: LoadTestResult[] = [];
  
  for (const users of userCounts) {
    console.log('\n' + '═'.repeat(70));
    console.log(`PHASE: ${formatNumber(users)} CONCURRENT USERS`);
    console.log('═'.repeat(70));
    
    for (const { config, token } of servicesToTest) {
      const result = await runLoadTest(config, token, users, duration, LOAD_TEST_CONFIG.defaultReadWriteRatio);
      allResults.push(result);
      printResults(result, `${users} USERS - ${config.name}`);
    }
  }

  // Print summary
  printSummary(allResults);

  process.exit(0);
}

main().catch(console.error);
