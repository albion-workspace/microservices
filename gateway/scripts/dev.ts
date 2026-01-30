/**
 * Unified Development Script
 * 
 * Single entry point for all development modes:
 * - per-service: Each service on its own port (default)
 * - shared: All services in one process (port 9999)
 * - docker: Docker Compose development mode
 * 
 * Cross-platform (Windows, Linux, Mac)
 * 
 * Usage:
 *   npm run dev                          # Per-service mode (default, dev config)
 *   npm run dev -- --config=shared       # Per-service with shared config
 *   npm run dev -- --mode=docker         # Docker mode
 *   npm run dev:shared                   # Alias for --config=shared
 */

import { spawn, ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromArgs, logConfigSummary, type ServicesConfig } from './config-loader.js';
import { runLongRunningScript, printHeader, printFooter } from './script-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const GATEWAY_DIR = join(__dirname, '..');

type DevMode = 'per-service' | 'shared' | 'docker';

const processes: ChildProcess[] = [];

function parseArgs(): { mode: DevMode } {
  const args = process.argv.slice(2);
  let mode: DevMode = 'per-service';

  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      const value = arg.split('=')[1];
      if (value === 'shared' || value === 'docker' || value === 'per-service') {
        mode = value;
      }
    }
  }

  return { mode };
}

function startService(serviceName: string, config: ServicesConfig): ChildProcess {
  const serviceDir = join(ROOT_DIR, `${serviceName}-service`);
  const serviceConfig = config.services.find(s => s.name === serviceName);
  
  console.log(`  Starting ${serviceName}-service on port ${serviceConfig?.port || 'unknown'}...`);
  
  const child = spawn('npm', ['run', 'dev'], {
    cwd: serviceDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: false,
  });

  // Prefix output with service name
  child.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => {
      // Parse JSON logs for cleaner output
      try {
        const log = JSON.parse(line);
        console.log(`[${serviceName}] ${log.level}: ${log.message}`);
      } catch {
        console.log(`[${serviceName}] ${line}`);
      }
    });
  });

  child.stderr?.on('data', (data) => {
    console.error(`[${serviceName}] ERROR: ${data.toString().trim()}`);
  });

  child.on('error', (err) => {
    console.error(`[${serviceName}] Failed to start: ${err.message}`);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${serviceName}] Exited with code ${code}`);
    }
  });

  return child;
}

async function runPerServiceMode(config: ServicesConfig): Promise<void> {
  printHeader('Development Mode: Per-Service');
  console.log('Starting services:');
  
  for (const service of config.services) {
    const child = startService(service.name, config);
    processes.push(child);
  }

  printFooter('All services starting...');
  console.log('Endpoints:');
  for (const service of config.services) {
    console.log(`  ${service.name.padEnd(15)} http://localhost:${service.port}/graphql`);
  }
  console.log('');
  console.log('Press Ctrl+C to stop all services.');
  console.log('Run "npm run health" to check service status.');
  console.log('');
}

async function runSharedMode(config: ServicesConfig): Promise<void> {
  printHeader('Development Mode: Shared (Single Gateway)');
  console.log(`Gateway port: ${config.gateway.port}`);
  console.log('');
  console.log('Shared mode not yet implemented.');
  console.log('This will run all services in a single process.');
  console.log('For now, use per-service mode: npm run dev');
  console.log('');
}

async function runDockerMode(config: ServicesConfig): Promise<void> {
  printHeader('Development Mode: Docker Compose');

  // Check if docker-compose file exists
  const composeFile = join(GATEWAY_DIR, 'generated', 'docker', 'docker-compose.dev.yml');
  
  let fileExists = false;
  try {
    await access(composeFile);
    fileExists = true;
  } catch {
    fileExists = false;
  }
  
  if (!fileExists) {
    console.log('Docker Compose file not found. Generating...');
    console.log('');
    
    // Generate configs first
    const generateScript = join(__dirname, 'generate.ts');
    const tsxPath = join(ROOT_DIR, 'core-service', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const generateProcess = spawn('node', [tsxPath, generateScript, '--docker'], {
      cwd: GATEWAY_DIR,
      stdio: 'inherit',
      shell: true,
    });

    await new Promise<void>((resolve, reject) => {
      generateProcess.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Generate failed with code ${code}`));
      });
    });
  }

  console.log('Starting Docker Compose...');
  console.log('');

  const dockerCompose = spawn('docker-compose', [
    '-f', composeFile,
    'up',
    '--build'
  ], {
    cwd: GATEWAY_DIR,
    stdio: 'inherit',
    shell: true,
  });

  processes.push(dockerCompose);

  dockerCompose.on('error', (err) => {
    console.error('Docker Compose failed:', err.message);
    console.log('');
    console.log('Make sure Docker Desktop is running.');
  });
}

function setupShutdown(): void {
  const shutdown = () => {
    console.log('');
    console.log('Shutting down services...');
    
    for (const proc of processes) {
      if (proc && !proc.killed) {
        // On Windows, we need to kill the process tree
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', proc.pid!.toString(), '/f', '/t'], { shell: true });
        } else {
          proc.kill('SIGTERM');
        }
      }
    }

    // Give processes time to shutdown gracefully
    setTimeout(() => {
      console.log('All services stopped.');
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const { mode } = parseArgs();
  const { config, mode: configMode } = await loadConfigFromArgs();

  console.log('');
  logConfigSummary(config, configMode);

  setupShutdown();

  switch (mode) {
    case 'per-service':
      await runPerServiceMode(config);
      break;
    case 'shared':
      await runSharedMode(config);
      break;
    case 'docker':
      await runDockerMode(config);
      break;
  }
}

// Dev scripts are always long-running (services keep running)
runLongRunningScript(main, { name: 'Dev' });
