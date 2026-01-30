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
 *   npm run dev                 # Per-service mode (default)
 *   npm run dev -- --mode=shared    # Shared mode
 *   npm run dev -- --mode=docker    # Docker mode
 */

import { spawn, ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const GATEWAY_DIR = join(__dirname, '..');
const CONFIGS_DIR = join(GATEWAY_DIR, 'configs');

interface ServiceConfig {
  name: string;
  host: string;
  port: number;
  database: string;
  healthPath: string;
}

interface ServicesConfig {
  gateway: {
    port: number;
    defaultService: string;
  };
  services: ServiceConfig[];
}

type DevMode = 'per-service' | 'shared' | 'docker';

const processes: ChildProcess[] = [];

async function loadConfig(): Promise<ServicesConfig> {
  const configPath = join(CONFIGS_DIR, 'services.json');
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

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
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' Development Mode: Per-Service');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Starting services:');
  
  for (const service of config.services) {
    const child = startService(service.name, config);
    processes.push(child);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' All services starting...');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
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
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' Development Mode: Shared (Single Gateway)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Gateway port: ${config.gateway.port}`);
  console.log('');
  console.log('⚠️  Shared mode not yet implemented.');
  console.log('    This will run all services in a single process.');
  console.log('    For now, use per-service mode: npm run dev');
  console.log('');
  
  // TODO: Implement shared mode
  // This would require:
  // 1. Each service to export its modules
  // 2. A unified entry point that loads all modules
  // 3. Single createGateway call with all services
}

async function runDockerMode(config: ServicesConfig): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' Development Mode: Docker Compose');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  // Check if docker-compose file exists
  const composeFile = join(GATEWAY_DIR, 'generated', 'docker', 'docker-compose.dev.yml');
  
  try {
    await readFile(composeFile);
  } catch {
    console.log('Docker Compose file not found. Generating...');
    console.log('');
    
    // Generate configs first
    const generateScript = join(__dirname, 'generate.ts');
    const generateProcess = spawn('node', [
      join(ROOT_DIR, 'core-service', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      generateScript,
      '--docker'
    ], {
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
  const config = await loadConfig();

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

main().catch((err) => {
  console.error('Development script failed:', err);
  process.exitCode = 1;
});
