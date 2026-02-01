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

import { loadConfigFromArgs, logConfigSummary, getInfraConfig, getDockerContainerNames, getReusedServiceEntries, type ServicesConfig, type ServiceConfig, type InfraConfig, type ConfigMode } from './config-loader.js';
import { runScript, runLongRunningScript, printHeader } from './script-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const GATEWAY_DIR = join(__dirname, '..');
const GENERATED_DIR = join(GATEWAY_DIR, 'generated');

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

/** Compose filename suffix: none for default (ms), otherwise .{projectName} so configs don't overwrite each other. */
function getComposeFileSuffix(): string {
  const projectName = getInfraConfig().docker.projectName;
  return projectName === 'ms' ? '' : `.${projectName}`;
}

/** Image tag per project: ms uses :latest, test/combo use :test / :combo so images don't overwrite each other. */
function getImageTag(): string {
  const projectName = getInfraConfig().docker.projectName;
  return projectName === 'ms' ? 'latest' : projectName;
}

async function checkComposeFileExists(env: 'dev' | 'prod'): Promise<boolean> {
  try {
    await access(getComposeFile(env));
    return true;
  } catch {
    return false;
  }
}

function getComposeFile(env: 'dev' | 'prod'): string {
  const suffix = getComposeFileSuffix();
  return join(GENERATED_DIR, 'docker', `docker-compose.${env}${suffix}.yml`);
}

async function generateConfigs(mode: ConfigMode): Promise<void> {
  console.log(`Generating Docker configs (--config=${mode})...`);
  
  const generateScript = join(__dirname, 'generate.ts');
  const tsxPath = join(ROOT_DIR, 'core-service', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  
  // Generate both Dockerfiles and docker-compose using same config mode (infra + services)
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [tsxPath, generateScript, '--dockerfile', '--docker', `--config=${mode}`], {
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

async function generateDockerfile(serviceName: string, mode: ConfigMode): Promise<void> {
  console.log(`Generating Dockerfile for ${serviceName} (--config=${mode})...`);
  
  const generateScript = join(__dirname, 'generate.ts');
  const tsxPath = join(ROOT_DIR, 'core-service', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [tsxPath, generateScript, '--dockerfile', `--config=${mode}`], {
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
  const { docker } = getInfraConfig();
  try {
    execSync(`docker network inspect ${docker.network}`, { stdio: 'ignore' });
  } catch {
    console.log(`Creating Docker network: ${docker.network}`);
    execSync(`docker network create ${docker.network}`, { stdio: 'inherit' });
  }
}

/**
 * Check if a container is running. Name from infra: projectName-mongo, projectName-redis.
 */
function isContainerRunning(containerName: string): boolean {
  try {
    const result = execSync(`docker ps --filter "name=^${containerName}$" --filter "status=running" -q`, { encoding: 'utf8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Ensure MongoDB and Redis infrastructure containers are running
 * Creates them if they don't exist (fresh install scenario)
 */
async function ensureInfrastructure(config: ServicesConfig): Promise<void> {
  const { docker, versions } = getInfraConfig();
  const { mongo: mongoContainer, redis: redisContainer } = getDockerContainerNames(getInfraConfig());
  const mongo = config.infrastructure.mongodb;
  const redis = config.infrastructure.redis;
  
  const mongoRunning = isContainerRunning(mongoContainer);
  const redisRunning = isContainerRunning(redisContainer);
  
  if (mongoRunning && redisRunning) {
    console.log(`✅ Infrastructure running (${mongoContainer}, ${redisContainer})`);
    return;
  }
  
  console.log('🔧 Starting infrastructure containers...');
  
  // Start MongoDB if not running
  if (!mongoRunning) {
    console.log(`  Starting ${mongoContainer}...`);
    try {
      execSync(`docker rm -f ${mongoContainer}`, { stdio: 'pipe', shell: true });
    } catch {
      // No existing container
    }
    try {
      execSync(`docker run -d --name ${mongoContainer} --network ${docker.network} -p ${mongo.port}:27017 mongo:${versions.mongodb}`, {
        stdio: 'inherit',
        shell: true,
      });
      console.log(`  ✅ ${mongoContainer} started`);
    } catch (err) {
      console.error(`  ❌ Failed to start ${mongoContainer}`);
      throw err;
    }
  }

  // Start Redis if not running
  if (!redisRunning) {
    console.log(`  Starting ${redisContainer}...`);
    try {
      execSync(`docker rm -f ${redisContainer}`, { stdio: 'pipe', shell: true });
    } catch {
      // No existing container
    }
    try {
      const redisPassword = redis.password;
      const redisCmd = redisPassword
        ? `docker run -d --name ${redisContainer} --network ${docker.network} -p ${redis.port}:6379 redis:${versions.redis} redis-server --appendonly yes --requirepass ${redisPassword}`
        : `docker run -d --name ${redisContainer} --network ${docker.network} -p ${redis.port}:6379 redis:${versions.redis} redis-server --appendonly yes`;
      execSync(redisCmd, { stdio: 'inherit', shell: true });
      console.log(`  ✅ ${redisContainer} started`);
    } catch (err) {
      console.error(`  ❌ Failed to start ${redisContainer}`);
      throw err;
    }
  }
  
  // Wait a moment for containers to be ready
  console.log('  Waiting for infrastructure to be ready...');
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * Remove old container if exists. Name from infra: projectName-{service}-service.
 */
function removeOldContainer(serviceName: string): void {
  const { projectName } = getInfraConfig().docker;
  const containerName = `${projectName}-${serviceName}-service`;

  try {
    const exists = execSync(`docker ps -aq --filter "name=^${containerName}$"`, { encoding: 'utf8' }).trim();
    if (exists) {
      console.log(`  Removing old container: ${containerName}`);
      execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
    }
  } catch {
    // Container doesn't exist
  }
}

/**
 * Remove old image if it exists. Image name: {service}-service:{tag}.
 */
function removeOldImage(serviceName: string, tag?: string): void {
  const imageTag = tag ?? getImageTag();
  const imageName = `${serviceName}-service:${imageTag}`;
  try {
    execSync(`docker image inspect ${imageName}`, { stdio: 'ignore' });
    console.log(`  Removing old image: ${imageName}`);
    execSync(`docker rmi -f ${imageName}`, { stdio: 'ignore' });
  } catch {
    // Image doesn't exist
  }
}

/**
 * Check if core-base image exists
 */
function coreBaseExists(): boolean {
  try {
    execSync('docker image inspect core-base:latest', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the core-base image (access-engine + core-service)
 * This is built once and reused by all service builds
 */
async function buildCoreBase(forceRebuild = false): Promise<void> {
  if (!forceRebuild && coreBaseExists()) {
    console.log('✅ core-base:latest exists (use --rebuild-base to force rebuild)');
    return;
  }
  
  console.log('🔧 Building core-base:latest (shared dependencies)...');
  console.log('   This includes: access-engine, core-service');
  
  const coreBaseDockerfile = join(ROOT_DIR, 'Dockerfile.core-base');
  
  // Generate core-base Dockerfile with version from infra config
  const { generateCoreBaseDockerfile } = await import('core-service/infra');
  const { writeFile } = await import('node:fs/promises');
  const { versions } = getInfraConfig();
  await writeFile(coreBaseDockerfile, generateCoreBaseDockerfile(versions.node));
  
  try {
    execSync('docker build -f Dockerfile.core-base -t core-base:latest .', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    console.log('✅ Built core-base:latest');
  } catch (err) {
    console.error('❌ Failed to build core-base:latest');
    throw err;
  } finally {
    // Clean up generated Dockerfile
    try {
      const { rm } = await import('node:fs/promises');
      await rm(coreBaseDockerfile, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Build a single Docker image - uses core-base for fast builds. Tags with project (ms=latest, test=test, combo=combo).
 */
async function buildSingleImage(service: ServiceConfig): Promise<void> {
  const svcName = `${service.name}-service`;
  const imageTag = getImageTag();
  const imageName = `${svcName}:${imageTag}`;
  const dockerfilePath = `${svcName}/Dockerfile`;
  
  console.log(`\n🔧 Building ${imageName}...`);
  
  // Always clean before build for fresh images
  console.log(`  Removing old container/image for ${service.name}...`);
  removeOldContainer(service.name);
  removeOldImage(service.name, imageTag);
  
  try {
    // Build from project root with -f flag
    // Uses core-base:latest for fast builds (core deps are pre-built)
    execSync(`docker build -f ${dockerfilePath} -t ${imageName} .`, {
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
 * Build Docker images - builds core-base once, then services fast
 */
async function dockerBuild(config: ServicesConfig, serviceName?: string, rebuildBase = false): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const count = services.length;
  printHeader(`Building ${count} Docker Image(s) - Fast Build`);

  // Step 1: Ensure core-base exists (build once, reuse for all services)
  console.log('\n[Base] Checking core-base image...');
  await buildCoreBase(rebuildBase);

  // Step 2: Build service images (fast - uses pre-built core-base)
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
async function dockerUp(env: 'dev' | 'prod', config: ServicesConfig, mode: ConfigMode, serviceName?: string): Promise<void> {
  const { docker } = getInfraConfig();
  const services = getTargetServices(config, serviceName);
  const targetMsg = serviceName ? ` - ${serviceName} only` : '';
  printHeader(`Starting Docker Containers (${env})${targetMsg}`);

  if (serviceName) {
    await ensureNetworkExists();
    await ensureInfrastructure(config);
    const service = services[0];
    const svcName = `${service.name}-service`;
    const containerName = `${getInfraConfig().docker.projectName}-${service.name}-service`;
    
    console.log(`Starting single service: ${svcName}`);
    
    // Remove old container
    removeOldContainer(service.name);
    
    const { mongo: mongoContainer, redis: redisContainer } = getDockerContainerNames(getInfraConfig());
    const database = (service as { database?: string }).database ?? `${service.name.replace(/-/g, '_')}_service`;
    const redisPassword = config.infrastructure.redis.password ?? 'redis123';
    const mongoUri = `mongodb://${mongoContainer}:27017/${database}`;
    const redisUrl = `redis://:${redisPassword}@${redisContainer}:6379`;
    
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
      '--network', docker.network,
      ...envVars.flatMap(e => ['-e', e]),
      '-p', `${service.port}:${service.port}`,
      `${svcName}:${getImageTag()}`,
    ];
    
    try {
      execSync(`docker ${runArgs.join(' ')}`, { stdio: 'inherit' });
      console.log(`\n✅ ${svcName} started on port ${service.port}`);
    } catch (err) {
      throw new Error(`Failed to start ${svcName}`);
    }
    return;
  }

  // All services: use docker compose - always regenerate so file matches current --config (infra + services)
  await generateConfigs(mode);

  // Remove any infra containers started outside compose so compose can create them (same group). Skip when reusing provider infra.
  const reuseInfra = config.reuseInfra && config.reuseFrom;
  if (!reuseInfra) {
    const { mongo: mongoContainer, redis: redisContainer } = getDockerContainerNames(getInfraConfig());
    try {
      execSync(`docker rm -f ${mongoContainer} ${redisContainer}`, { stdio: 'pipe', shell: true });
    } catch {
      // None or one may not exist
    }
  }

  // Only remove old containers for services we deploy (reused services have no container in this project)
  const reusedSet = new Set(getReusedServiceEntries(config).map(e => e.serviceName));
  console.log('Cleaning old containers...');
  for (const service of services) {
    if (!reusedSet.has(service.name)) removeOldContainer(service.name);
  }

  const composeFile = getComposeFile(env);
  const projectName = docker.projectName;
  const composeArgs = ['-f', composeFile, '-p', projectName, 'up', '-d', '--force-recreate'];
  
  console.log(`\nStarting all containers on network: ${docker.network} (Docker Desktop group: ${projectName})`);
  
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
  const projectName = getInfraConfig().docker.projectName;
  
  const proc = spawn('docker', ['compose', '-f', composeFile, '-p', projectName, 'down'], {
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
  const projectName = getInfraConfig().docker.projectName;
  
  // Build command args - optionally target specific service (-p so we follow the right project)
  const composeArgs = ['compose', '-f', composeFile, '-p', projectName, 'logs', '-f'];
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
 * Clean up generated Docker files (service Dockerfiles only).
 * Compose files are kept so both brands (ms, test) can coexist and be run without regenerating.
 */
async function cleanGeneratedFiles(config?: ServicesConfig, serviceName?: string): Promise<void> {
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
async function dockerFresh(env: 'dev' | 'prod', config: ServicesConfig, mode: ConfigMode, serviceName?: string, skipHealthCheck = false): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const count = services.length;
  const targetMsg = serviceName ? ` (${serviceName} only)` : ` (all ${count} services)`;
  printHeader(`Fresh Docker Deployment${targetMsg}`);

  // Step 1: Generate configs (Dockerfile is always needed)
  console.log('Step 1/5: Generating configurations...');
  if (!serviceName) {
    await generateConfigs(mode);
  } else {
    // For single service, only generate Dockerfile
    await generateDockerfile(serviceName, mode);
  }

  // Step 2: Build fresh images (this also cleans old artifacts)
  console.log('\nStep 2/5: Building fresh images...');
  await dockerBuild(config, serviceName);

  // Step 3: Start containers
  console.log('\nStep 3/5: Starting containers...');
  await dockerUp(env, config, mode, serviceName);

  // Step 4 & 5: Health check and cleanup
  if (!skipHealthCheck) {
    console.log('\nStep 4/5: Running health check...');
    const healthy = await runHealthCheck(config, serviceName);

    if (healthy) {
      console.log('\n🎉 Fresh deployment successful!');
      console.log('\nStep 5/5: Cleaning up generated files...');
      await cleanGeneratedFiles(config, serviceName);
      // Let Windows/libuv finish closing file handles before process exit (avoids UV_HANDLE_CLOSING assertion)
      await new Promise<void>((r) => setTimeout(r, 150));
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
  const { docker } = getInfraConfig();
  printHeader('Docker Status');

  // Check Docker
  if (!checkDockerRunning()) {
    console.log('❌ Docker is not running. Please start Docker Desktop.');
    return;
  }
  console.log('✅ Docker is running');

  // Check network (Docker Compose creates as {project}_{network}, e.g. combo_combo_network)
  const networkFull = `${docker.projectName}_${docker.network}`;
  try {
    execSync(`docker network inspect ${networkFull}`, { stdio: 'ignore' });
    console.log(`✅ Network ${networkFull} exists`);
  } catch {
    console.log(`⚠️  Network ${networkFull} not found`);
  }

  // Check compose file (filename includes project, e.g. docker-compose.dev.test.yml for test)
  const composeFile = getComposeFile(env);
  if (await checkComposeFileExists(env)) {
    console.log(`✅ ${composeFile.split(/[/\\]/).pop()} exists`);
  } else {
    console.log(`⚠️  ${composeFile.split(/[/\\]/).pop()} not found. Run "npm run generate:docker" or "npm run generate:test"`);
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

  // List images (use project-specific tag so test/combo show their own images)
  const imageTag = getImageTag();
  console.log('');
  console.log('Service images:');
  for (const service of config.services) {
    const imageRef = `${service.name}-service:${imageTag}`;
    try {
      const imageId = execSync(`docker images -q ${imageRef}`, { encoding: 'utf8' }).trim();
      if (imageId) {
        // Get image creation time
        const created = execSync(`docker inspect --format='{{.Created}}' ${imageRef}`, { encoding: 'utf8' }).trim();
        const createdDate = new Date(created);
        const ago = getTimeAgo(createdDate);
        console.log(`  ✅ ${imageRef} (built ${ago})`);
      } else {
        console.log(`  ❌ ${imageRef} (not built)`);
      }
    } catch {
      console.log(`  ❌ ${imageRef} (not built)`);
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
      await dockerUp(env, config, mode, service);
      break;
    case 'down':
      await dockerDown(env, config, service);
      break;
    case 'logs':
      await dockerLogs(env, service);
      break;
    case 'fresh':
      await dockerFresh(env, config, mode, service, noHealthCheck);
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
