/**
 * Docker Orchestration Script
 * 
 * Manages Docker Compose and Docker Desktop k8s operations:
 * - Build images
 * - Start/stop containers
 * - View logs
 * - K8s deployment (Docker Desktop)
 * 
 * Cross-platform (Windows, Linux, Mac)
 * 
 * Usage:
 *   npm run docker:build                  # Build all images
 *   npm run docker:up                     # Start containers (dev config)
 *   npm run docker:up -- --config=shared  # Start with shared config
 *   npm run docker:down                   # Stop containers
 *   npm run docker:logs                   # View logs
 *   npm run docker:status                 # Check status
 */

import { spawn, execSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromArgs, logConfigSummary, type ServicesConfig } from './config-loader.js';
import { runScript, runLongRunningScript, printHeader } from './script-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const GATEWAY_DIR = join(__dirname, '..');
const GENERATED_DIR = join(GATEWAY_DIR, 'generated');

type DockerCommand = 'build' | 'up' | 'down' | 'logs' | 'status' | 'ps';

function parseArgs(): { command: DockerCommand; env: 'dev' | 'prod' } {
  const args = process.argv.slice(2);
  let command: DockerCommand = 'status';
  let env: 'dev' | 'prod' = 'dev';

  for (const arg of args) {
    if (['build', 'up', 'down', 'logs', 'status', 'ps'].includes(arg)) {
      command = arg as DockerCommand;
    }
    if (arg === '--prod') {
      env = 'prod';
    }
  }

  return { command, env };
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

async function dockerBuild(config: ServicesConfig): Promise<void> {
  printHeader('Building Docker Images');

  for (const service of config.services) {
    const serviceName = `${service.name}-service`;
    const imageName = `${serviceName}:latest`;
    const dockerfilePath = `${serviceName}/Dockerfile`;
    
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
  console.log('All images built successfully!');
}

async function dockerUp(env: 'dev' | 'prod'): Promise<void> {
  printHeader(`Starting Docker Compose (${env})`);

  if (!(await checkComposeFileExists(env))) {
    await generateConfigs();
  }

  const composeFile = getComposeFile(env);
  
  const proc = spawn('docker-compose', ['-f', composeFile, 'up', '-d'], {
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
        reject(new Error(`docker-compose up failed with code ${code}`));
      }
    });
  });
}

async function dockerDown(env: 'dev' | 'prod'): Promise<void> {
  console.log('Stopping Docker Compose...');

  const composeFile = getComposeFile(env);
  
  const proc = spawn('docker-compose', ['-f', composeFile, 'down'], {
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
        reject(new Error(`docker-compose down failed with code ${code}`));
      }
    });
  });
}

async function dockerLogs(env: 'dev' | 'prod'): Promise<void> {
  const composeFile = getComposeFile(env);
  
  const proc = spawn('docker-compose', ['-f', composeFile, 'logs', '-f'], {
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
  const { command, env } = parseArgs();
  const { config, mode } = await loadConfigFromArgs();

  console.log('');
  logConfigSummary(config, mode);

  if (!checkDockerRunning() && command !== 'status') {
    throw new Error('Docker is not running. Please start Docker Desktop.');
  }

  switch (command) {
    case 'build':
      await dockerBuild(config);
      break;
    case 'up':
      await dockerUp(env);
      break;
    case 'down':
      await dockerDown(env);
      break;
    case 'logs':
      await dockerLogs(env);
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
