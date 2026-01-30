/**
 * Docker Orchestration Script
 * 
 * Manages Docker Compose operations:
 * - Build images (all or specific service)
 * - Start/stop containers
 * - View logs
 * 
 * Cross-platform (Windows, Linux, Mac)
 * 
 * Usage:
 *   npm run docker:build                           # Build all images
 *   npm run docker:build -- --service=auth         # Build only auth-service
 *   npm run docker:up                              # Start containers (dev config)
 *   npm run docker:up -- --service=auth            # Start only auth-service
 *   npm run docker:up -- --config=shared           # Start with shared config
 *   npm run docker:down                            # Stop containers
 *   npm run docker:logs                            # View logs
 *   npm run docker:logs -- --service=auth          # View logs for auth-service
 *   npm run docker:status                          # Check status
 */

import { spawn, execSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromArgs, logConfigSummary, type ServicesConfig, type ServiceConfig } from './config-loader.js';
import { runScript, runLongRunningScript, printHeader } from './script-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const GATEWAY_DIR = join(__dirname, '..');
const GENERATED_DIR = join(GATEWAY_DIR, 'generated');

type DockerCommand = 'build' | 'up' | 'down' | 'logs' | 'status' | 'ps';

interface ParsedArgs {
  command: DockerCommand;
  env: 'dev' | 'prod';
  service?: string;  // Optional: specific service to target
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command: DockerCommand = 'status';
  let env: 'dev' | 'prod' = 'dev';
  let service: string | undefined;

  for (const arg of args) {
    if (['build', 'up', 'down', 'logs', 'status', 'ps'].includes(arg)) {
      command = arg as DockerCommand;
    }
    if (arg === '--prod') {
      env = 'prod';
    }
    // Support --service=auth or --service=auth-service
    if (arg.startsWith('--service=')) {
      service = arg.split('=')[1].replace(/-service$/, '');
    }
  }

  return { command, env, service };
}

/**
 * Filter services by name if --service argument provided
 */
function filterServices(config: ServicesConfig, serviceName?: string): ServiceConfig[] {
  if (!serviceName) {
    return config.services;
  }
  
  const filtered = config.services.filter(s => 
    s.name === serviceName || 
    s.name === `${serviceName}-service` ||
    `${s.name}-service` === serviceName
  );
  
  if (filtered.length === 0) {
    throw new Error(`Service "${serviceName}" not found. Available: ${config.services.map(s => s.name).join(', ')}`);
  }
  
  return filtered;
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

async function dockerBuild(config: ServicesConfig, serviceName?: string): Promise<void> {
  const services = filterServices(config, serviceName);
  const targetMsg = serviceName ? ` (${serviceName})` : '';
  printHeader(`Building Docker Images${targetMsg}`);

  for (const service of services) {
    const svcName = `${service.name}-service`;
    const imageName = `${svcName}:latest`;
    const dockerfilePath = `${svcName}/Dockerfile`;
    
    console.log(`Building ${imageName}...`);
    
    try {
      // Build from project root with -f flag (as Dockerfile expects)
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

  console.log('');
  console.log(serviceName ? `${serviceName}-service built successfully!` : 'All images built successfully!');
}

async function dockerUp(env: 'dev' | 'prod', serviceName?: string): Promise<void> {
  const targetMsg = serviceName ? ` - ${serviceName}` : '';
  printHeader(`Starting Docker Compose (${env})${targetMsg}`);

  if (!(await checkComposeFileExists(env))) {
    await generateConfigs();
  }

  const composeFile = getComposeFile(env);
  
  // Build command args - optionally target specific service
  const composeArgs = ['-f', composeFile, 'up', '-d'];
  if (serviceName) {
    composeArgs.push(`${serviceName}-service`);
  }
  
  const proc = spawn('docker-compose', composeArgs, {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
    shell: true,
  });

  return new Promise((resolve, reject) => {
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('');
        const msg = serviceName 
          ? `${serviceName}-service started! Run "npm run docker:logs -- --service=${serviceName}" to view logs.`
          : 'Containers started! Run "npm run docker:logs" to view logs.';
        console.log(msg);
        resolve();
      } else {
        reject(new Error(`docker-compose up failed with code ${code}`));
      }
    });
  });
}

async function dockerDown(env: 'dev' | 'prod', serviceName?: string): Promise<void> {
  const targetMsg = serviceName ? ` (${serviceName})` : '';
  console.log(`Stopping Docker Compose${targetMsg}...`);

  const composeFile = getComposeFile(env);
  
  // Build command args - optionally target specific service
  const composeArgs = ['-f', composeFile, 'down'];
  if (serviceName) {
    // For down with specific service, use stop + rm
    composeArgs.splice(2, 1, 'stop');
    composeArgs.push(`${serviceName}-service`);
  }
  
  const proc = spawn('docker-compose', composeArgs, {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
    shell: true,
  });

  return new Promise((resolve, reject) => {
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(serviceName ? `${serviceName}-service stopped.` : 'Containers stopped.');
        resolve();
      } else {
        reject(new Error(`docker-compose down failed with code ${code}`));
      }
    });
  });
}

async function dockerLogs(env: 'dev' | 'prod', serviceName?: string): Promise<void> {
  const composeFile = getComposeFile(env);
  
  // Build command args - optionally target specific service
  const composeArgs = ['-f', composeFile, 'logs', '-f'];
  if (serviceName) {
    composeArgs.push(`${serviceName}-service`);
  }
  
  const proc = spawn('docker-compose', composeArgs, {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
    shell: true,
  });

  // Keep running until Ctrl+C
  await new Promise<void>((resolve) => {
    proc.on('exit', () => resolve());
  });
}

async function dockerStatus(env: 'dev' | 'prod', config: ServicesConfig): Promise<void> {
  printHeader('Docker Status');

  // Check Docker
  if (!checkDockerRunning()) {
    console.log('❌ Docker is not running. Please start Docker Desktop.');
    return;
  }
  console.log('✅ Docker is running');

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
  console.log('Available images:');
  for (const service of config.services) {
    try {
      execSync(`docker image inspect ${service.name}-service:latest`, { stdio: 'ignore' });
      console.log(`  ✅ ${service.name}-service:latest`);
    } catch {
      console.log(`  ❌ ${service.name}-service:latest (not built)`);
    }
  }
}

async function main(): Promise<void> {
  const { command, env, service } = parseArgs();
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
      await dockerUp(env, service);
      break;
    case 'down':
      await dockerDown(env, service);
      break;
    case 'logs':
      await dockerLogs(env, service);
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
