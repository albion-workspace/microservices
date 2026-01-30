/**
 * Docker Orchestration Script
 * 
 * Manages Docker Compose operations:
 * - Build images (all or specific service) - always fresh
 * - Start/stop containers
 * - Fresh deployment workflow (clean + build + start + health check)
 * 
 * Cross-platform (Windows, Linux, Mac)
 * 
 * Usage:
 *   npm run docker:build                           # Build all images (fresh)
 *   npm run docker:build -- --service=auth         # Build only auth-service (fresh)
 *   npm run docker:up                              # Start containers (dev config)
 *   npm run docker:up -- --service=auth            # Start only auth-service
 *   npm run docker:down                            # Stop containers
 *   npm run docker:logs                            # View logs
 *   npm run docker:logs -- --service=auth          # View logs for auth-service
 *   npm run docker:status                          # Check status
 *   npm run docker:fresh                           # Full fresh deploy: clean + build + start + health
 *   npm run docker:fresh -- --service=auth         # Fresh deploy for single service
 *   npm run docker:clean                           # Remove containers/images/generated files
 */

import { spawn, execSync } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromArgs, logConfigSummary, type ServicesConfig, type ServiceConfig } from './config-loader.js';
import { runScript, runLongRunningScript, printHeader } from './script-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const GATEWAY_DIR = join(__dirname, '..');
const GENERATED_DIR = join(GATEWAY_DIR, 'generated');

// Network name used by all services - must match ms-mongo/ms-redis network
const DOCKER_NETWORK = 'ms_microservices-network';

type DockerCommand = 'build' | 'up' | 'down' | 'logs' | 'status' | 'ps' | 'fresh' | 'clean';

interface ParsedArgs {
  command: DockerCommand;
  env: 'dev' | 'prod';
  service?: string;  // Optional: specific service to target
  noHealthCheck?: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command: DockerCommand = 'status';
  let env: 'dev' | 'prod' = 'dev';
  let noHealthCheck = false;
  
  // Support SERVICE env var for PowerShell compatibility (npm doesn't pass -- args on Windows)
  // Usage: $env:SERVICE="auth"; npm run docker:fresh
  let service: string | undefined = process.env.SERVICE?.replace(/-service$/, '');

  for (const arg of args) {
    if (['build', 'up', 'down', 'logs', 'status', 'ps', 'fresh', 'clean'].includes(arg)) {
      command = arg as DockerCommand;
    }
    if (arg === '--prod') {
      env = 'prod';
    }
    if (arg === '--no-health') {
      noHealthCheck = true;
    }
    // Support --service=auth or --service=auth-service (command line overrides env var)
    if (arg.startsWith('--service=')) {
      service = arg.split('=')[1].replace(/-service$/, '');
    }
  }

  return { command, env, service, noHealthCheck };
}

/**
 * Get a single service by name
 */
function getService(config: ServicesConfig, serviceName: string): ServiceConfig {
  // Normalize: remove -service suffix if present
  const normalized = serviceName.replace(/-service$/, '');
  
  const service = config.services.find(s => s.name === normalized);
  
  if (!service) {
    throw new Error(`Service "${serviceName}" not found. Available: ${config.services.map(s => s.name).join(', ')}`);
  }
  
  return service;
}

/**
 * Get services to process - single service if specified, all otherwise
 */
function getTargetServices(config: ServicesConfig, serviceName?: string): ServiceConfig[] {
  if (!serviceName) {
    return config.services;
  }
  return [getService(config, serviceName)];
}

function checkDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function checkComposeFileExists(env: 'dev' | 'prod'): Promise<boolean> {
  const composeFile = join(GENERATED_DIR, 'docker', `docker-compose.${env}.yml`);
  try {
    await access(composeFile);
    return true;
  } catch {
    return false;
  }
}

function getComposeFile(env: 'dev' | 'prod'): string {
  return join(GENERATED_DIR, 'docker', `docker-compose.${env}.yml`);
}

async function generateConfigs(): Promise<void> {
  console.log('Generating Docker configs...');
  
  const generateScript = join(__dirname, 'generate.ts');
  const tsxPath = join(ROOT_DIR, 'core-service', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [tsxPath, generateScript, '--docker'], {
      cwd: GATEWAY_DIR,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Generate failed with code ${code}`));
    });
  });
}

/**
 * Ensure the Docker network exists
 */
async function ensureNetworkExists(): Promise<void> {
  try {
    execSync(`docker network inspect ${DOCKER_NETWORK}`, { stdio: 'ignore' });
  } catch {
    console.log(`Creating Docker network: ${DOCKER_NETWORK}`);
    execSync(`docker network create ${DOCKER_NETWORK}`, { stdio: 'inherit' });
  }
}

/**
 * Remove old container if exists (by name pattern)
 */
function removeOldContainer(serviceName: string): void {
  const containerPatterns = [
    `docker-${serviceName}-service-1`,
    `${serviceName}-service`,
  ];
  
  for (const pattern of containerPatterns) {
    try {
      // Check if container exists
      const exists = execSync(`docker ps -aq --filter "name=${pattern}"`, { encoding: 'utf8' }).trim();
      if (exists) {
        console.log(`  Removing old container: ${pattern}`);
        execSync(`docker rm -f ${pattern}`, { stdio: 'ignore' });
      }
    } catch {
      // Container doesn't exist, that's fine
    }
  }
}

/**
 * Remove old images if exist (both naming conventions)
 */
function removeOldImage(serviceName: string): void {
  const imageNames = [
    `${serviceName}-service:latest`,      // Our build naming
    `docker-${serviceName}-service:latest` // Docker compose naming
  ];
  
  for (const imageName of imageNames) {
    try {
      execSync(`docker image inspect ${imageName}`, { stdio: 'ignore' });
      console.log(`  Removing old image: ${imageName}`);
      execSync(`docker rmi -f ${imageName}`, { stdio: 'ignore' });
    } catch {
      // Image doesn't exist, that's fine
    }
  }
}

/**
 * Build a single Docker image - always fresh
 */
async function buildSingleImage(service: ServiceConfig): Promise<void> {
  const svcName = `${service.name}-service`;
  const imageName = `${svcName}:latest`;
  const dockerfilePath = `${svcName}/Dockerfile`;
  
  console.log(`\n🔧 Building ${imageName}...`);
  
  // Always clean before build for fresh images
  console.log(`  Removing old container/image for ${service.name}...`);
  removeOldContainer(service.name);
  removeOldImage(service.name);
  
  try {
    // Build from project root with -f flag (as Dockerfile expects)
    // Use --no-cache to ensure truly fresh build
    execSync(`docker build --no-cache -f ${dockerfilePath} -t ${imageName} .`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    console.log(`✅ Built ${imageName}`);
  } catch (err) {
    console.error(`❌ Failed to build ${imageName}`);
    throw err;
  }
}

/**
 * Build Docker images - always fresh (removes old container and image first)
 */
async function dockerBuild(config: ServicesConfig, serviceName?: string): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const count = services.length;
  printHeader(`Building ${count} Docker Image(s) - Fresh Build`);

  for (let i = 0; i < services.length; i++) {
    console.log(`\n[${i + 1}/${count}] Processing ${services[i].name}...`);
    await buildSingleImage(services[i]);
  }

  console.log('\n');
  console.log(`✅ ${count} image(s) built successfully!`);
}

/**
 * Start container - removes old container first for fresh start
 * For single service: use docker run directly for better isolation
 * For all services: use docker compose
 */
async function dockerUp(env: 'dev' | 'prod', config: ServicesConfig, serviceName?: string): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const targetMsg = serviceName ? ` - ${serviceName} only` : '';
  printHeader(`Starting Docker Containers (${env})${targetMsg}`);

  // Ensure network exists
  await ensureNetworkExists();

  if (serviceName) {
    // Single service: use docker run directly for full isolation
    const service = services[0];
    const svcName = `${service.name}-service`;
    const containerName = `docker-${svcName}-1`;
    
    console.log(`Starting single service: ${svcName}`);
    
    // Remove old container
    removeOldContainer(service.name);
    
    // Get MongoDB and Redis config from services config
    // Use service.database from config (respects shared strategy for auth -> core_service)
    const database = (service as any).database || `${service.name.replace(/-/g, '_')}_service`;
    const mongoUri = `mongodb://ms-mongo:27017/${database}`;
    const redisUrl = `redis://:${config.redis?.password || 'redis123'}@ms-redis:6379`;
    
    // Common environment variables needed for all services
    const envVars = [
      `MONGO_URI=${mongoUri}`,
      `REDIS_URL=${redisUrl}`,
      `PORT=${service.port}`,
      'NODE_ENV=development',  // Use development to avoid strict validation
      'JWT_SECRET=dev-secret-for-docker-testing',
      'SHARED_JWT_SECRET=dev-shared-secret-for-docker-testing',
    ];
    
    // Build docker run command
    const runArgs = [
      'run', '-d',
      '--name', containerName,
      '--network', DOCKER_NETWORK,
      ...envVars.flatMap(e => ['-e', e]),
      '-p', `${service.port}:${service.port}`,
      `${svcName}:latest`,
    ];
    
    try {
      execSync(`docker ${runArgs.join(' ')}`, { stdio: 'inherit' });
      console.log(`\n✅ ${svcName} started on port ${service.port}`);
    } catch (err) {
      throw new Error(`Failed to start ${svcName}`);
    }
    return;
  }

  // All services: use docker compose
  if (!(await checkComposeFileExists(env))) {
    await generateConfigs();
  }

  // Remove old containers for fresh start
  console.log('Cleaning old containers...');
  for (const service of services) {
    removeOldContainer(service.name);
  }

  const composeFile = getComposeFile(env);
  const composeArgs = ['-f', composeFile, 'up', '-d', '--force-recreate'];
  
  console.log(`\nStarting all containers on network: ${DOCKER_NETWORK}`);
  
  const proc = spawn('docker', ['compose', ...composeArgs], {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
    shell: true,
  });

  return new Promise((resolve, reject) => {
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('');
        console.log('Containers started! Run "npm run docker:logs" to view logs.');
        resolve();
      } else {
        reject(new Error(`docker compose up failed with code ${code}`));
      }
    });
  });
}

async function dockerDown(env: 'dev' | 'prod', config: ServicesConfig, serviceName?: string): Promise<void> {
  const targetMsg = serviceName ? ` (${serviceName})` : '';
  console.log(`Stopping Docker containers${targetMsg}...`);

  if (serviceName) {
    // Stop specific service by removing its container
    const services = getTargetServices(config, serviceName);
    for (const service of services) {
      removeOldContainer(service.name);
    }
    console.log(`${serviceName}-service stopped.`);
    return;
  }

  const composeFile = getComposeFile(env);
  
  const proc = spawn('docker', ['compose', '-f', composeFile, 'down'], {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
    shell: true,
  });

  return new Promise((resolve, reject) => {
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('Containers stopped.');
        resolve();
      } else {
        reject(new Error(`docker compose down failed with code ${code}`));
      }
    });
  });
}

async function dockerLogs(env: 'dev' | 'prod', serviceName?: string): Promise<void> {
  const composeFile = getComposeFile(env);
  
  // Build command args - optionally target specific service
  const composeArgs = ['compose', '-f', composeFile, 'logs', '-f'];
  if (serviceName) {
    composeArgs.push(`${serviceName}-service`);
  }
  
  const proc = spawn('docker', composeArgs, {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
    shell: true,
  });

  // Keep running until Ctrl+C
  await new Promise<void>((resolve) => {
    proc.on('exit', () => resolve());
  });
}

/**
 * Run health check and return success status
 * Polls service health with retries for startup time
 */
async function runHealthCheck(config: ServicesConfig, serviceName?: string): Promise<boolean> {
  printHeader('Running Health Check');
  
  const services = getTargetServices(config, serviceName);
  const targetMsg = serviceName ? ` (${serviceName} only)` : '';
  console.log(`Checking ${services.length} service(s)${targetMsg}...`);
  
  // Poll with retries - services may need time to start
  const maxRetries = 6;
  const retryDelay = 5000; // 5 seconds between retries
  let allHealthy = true;
  
  for (const service of services) {
    let healthy = false;
    const url = `http://localhost:${service.port}/health`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          console.log(`[OK] ${service.name} (port ${service.port}): healthy`);
          healthy = true;
          break;
        } else {
          if (attempt < maxRetries) {
            console.log(`  ${service.name}: status ${response.status}, retrying (${attempt}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      } catch (err) {
        if (attempt < maxRetries) {
          console.log(`  ${service.name}: waiting to start (${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    if (!healthy) {
      console.log(`[FAIL] ${service.name} (port ${service.port}): not responding after ${maxRetries} attempts`);
      allHealthy = false;
    }
  }
  
  console.log('');
  if (allHealthy) {
    console.log(`✅ All ${services.length} service(s) healthy!`);
  } else {
    console.log(`❌ Some services unhealthy`);
  }
  
  return allHealthy;
}

/**
 * Clean up generated Docker files (docker-compose and service Dockerfiles)
 */
async function cleanGeneratedFiles(config?: ServicesConfig, serviceName?: string): Promise<void> {
  const dockerGenDir = join(GENERATED_DIR, 'docker');
  
  // Clean generated docker-compose files
  try {
    await rm(dockerGenDir, { recursive: true, force: true });
    console.log('  ✅ Cleaned generated docker-compose files');
  } catch {
    // Directory might not exist
  }
  
  // Clean generated Dockerfiles in service directories
  const services = config ? getTargetServices(config, serviceName) : [];
  for (const service of services) {
    const dockerfilePath = join(ROOT_DIR, `${service.name}-service`, 'Dockerfile');
    try {
      await rm(dockerfilePath, { force: true });
      console.log(`  ✅ Cleaned ${service.name}-service/Dockerfile`);
    } catch {
      // File might not exist
    }
  }
  
  // If no config provided, clean all known service Dockerfiles
  if (!config) {
    const knownServices = ['auth', 'payment', 'bonus', 'notification', 'kyc'];
    for (const svc of knownServices) {
      const dockerfilePath = join(ROOT_DIR, `${svc}-service`, 'Dockerfile');
      try {
        await rm(dockerfilePath, { force: true });
      } catch {
        // File might not exist
      }
    }
    console.log('  ✅ Cleaned service Dockerfiles');
  }
}

/**
 * Full clean: remove containers, images, and generated files
 */
async function dockerClean(config: ServicesConfig, serviceName?: string): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const targetMsg = serviceName ? ` (${serviceName} only)` : '';
  printHeader(`Docker Cleanup${targetMsg}`);

  console.log('Removing containers and images...');
  for (const service of services) {
    console.log(`  Cleaning ${service.name}...`);
    removeOldContainer(service.name);
    removeOldImage(service.name);
  }

  // Clean generated files
  console.log('\nCleaning generated files...');
  await cleanGeneratedFiles(config, serviceName);

  console.log('');
  console.log('✅ Cleanup complete');
}

/**
 * Fresh deployment workflow:
 * 1. Generate configs (only if building all)
 * 2. Build fresh images
 * 3. Start containers
 * 4. Run health check
 * 5. Clean generated files on success
 */
async function dockerFresh(env: 'dev' | 'prod', config: ServicesConfig, serviceName?: string, skipHealthCheck = false): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const count = services.length;
  const targetMsg = serviceName ? ` (${serviceName} only)` : ` (all ${count} services)`;
  printHeader(`Fresh Docker Deployment${targetMsg}`);

  // Step 1: Generate configs only when deploying all services
  if (!serviceName) {
    console.log('Step 1/5: Generating configurations...');
    await generateConfigs();
  } else {
    console.log('Step 1/5: Skipping config generation (single service mode)');
  }

  // Step 2: Build fresh images (this also cleans old artifacts)
  console.log('\nStep 2/5: Building fresh images...');
  await dockerBuild(config, serviceName);

  // Step 3: Start containers
  console.log('\nStep 3/5: Starting containers...');
  await dockerUp(env, config, serviceName);

  // Step 4 & 5: Health check and cleanup
  if (!skipHealthCheck) {
    console.log('\nStep 4/5: Running health check...');
    const healthy = await runHealthCheck(config, serviceName);

    if (healthy) {
      console.log('\n🎉 Fresh deployment successful!');
      console.log('\nStep 5/5: Cleaning up generated files...');
      await cleanGeneratedFiles(config, serviceName);
    } else {
      console.log('\n⚠️  Deployment completed but some services are unhealthy');
      console.log('Generated files preserved for debugging.');
      console.log(`Run "npm run docker:logs${serviceName ? ` -- --service=${serviceName}` : ''}" to view logs.`);
    }
  } else {
    console.log('\nStep 4/5: Health check skipped (--no-health)');
    console.log('\n🎉 Fresh deployment completed!');
  }
}

async function dockerStatus(env: 'dev' | 'prod', config: ServicesConfig): Promise<void> {
  printHeader('Docker Status');

  // Check Docker
  if (!checkDockerRunning()) {
    console.log('❌ Docker is not running. Please start Docker Desktop.');
    return;
  }
  console.log('✅ Docker is running');

  // Check network
  try {
    execSync(`docker network inspect ${DOCKER_NETWORK}`, { stdio: 'ignore' });
    console.log(`✅ Network ${DOCKER_NETWORK} exists`);
  } catch {
    console.log(`⚠️  Network ${DOCKER_NETWORK} not found`);
  }

  // Check compose file
  if (await checkComposeFileExists(env)) {
    console.log(`✅ docker-compose.${env}.yml exists`);
  } else {
    console.log(`⚠️  docker-compose.${env}.yml not found. Run "npm run generate:docker"`);
  }

  // List running containers
  console.log('');
  console.log('Running containers:');
  try {
    execSync('docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"', {
      stdio: 'inherit',
    });
  } catch {
    console.log('  No containers running');
  }

  // List images
  console.log('');
  console.log('Service images:');
  for (const service of config.services) {
    try {
      const imageId = execSync(`docker images -q ${service.name}-service:latest`, { encoding: 'utf8' }).trim();
      if (imageId) {
        // Get image creation time
        const created = execSync(`docker inspect --format='{{.Created}}' ${service.name}-service:latest`, { encoding: 'utf8' }).trim();
        const createdDate = new Date(created);
        const ago = getTimeAgo(createdDate);
        console.log(`  ✅ ${service.name}-service:latest (built ${ago})`);
      } else {
        console.log(`  ❌ ${service.name}-service:latest (not built)`);
      }
    } catch {
      console.log(`  ❌ ${service.name}-service:latest (not built)`);
    }
  }
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function main(): Promise<void> {
  const { command, env, service, noHealthCheck } = parseArgs();
  const { config, mode } = await loadConfigFromArgs();

  console.log('');
  logConfigSummary(config, mode);
  
  if (service) {
    console.log(`   Target service: ${service}`);
  }

  if (!checkDockerRunning() && command !== 'status') {
    throw new Error('Docker is not running. Please start Docker Desktop.');
  }

  switch (command) {
    case 'build':
      await dockerBuild(config, service);
      break;
    case 'up':
      await dockerUp(env, config, service);
      break;
    case 'down':
      await dockerDown(env, config, service);
      break;
    case 'logs':
      await dockerLogs(env, service);
      break;
    case 'fresh':
      await dockerFresh(env, config, service, noHealthCheck);
      break;
    case 'clean':
      await dockerClean(config, service);
      break;
    case 'status':
    case 'ps':
      await dockerStatus(env, config);
      break;
  }
}

// Logs command is long-running, others complete and exit
const isLogsCommand = process.argv.includes('logs');
if (isLogsCommand) {
  runLongRunningScript(main, { name: 'Docker' });
} else {
  runScript(main, { name: 'Docker' });
}
