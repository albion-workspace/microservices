/**
 * Kubernetes Orchestration Script
 * 
 * Manages Kubernetes deployment (local Docker Desktop or remote):
 * - Apply/delete manifests
 * - Check pod status
 * - Port forward for testing
 * - Create secrets
 * 
 * Cross-platform (Windows, Linux, Mac)
 * 
 * Usage:
 *   npm run k8s:apply                     # Apply all manifests
 *   npm run k8s:apply -- --config=shared  # Apply with shared config
 *   npm run k8s:delete                    # Delete all resources
 *   npm run k8s:status                    # Check pod status
 *   npm run k8s:forward                   # Port forward all services
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
const K8S_DIR = join(GENERATED_DIR, 'k8s');

const NAMESPACE = 'microservices';

type K8sCommand = 'apply' | 'delete' | 'status' | 'forward' | 'logs' | 'secrets';

function parseArgs(): { command: K8sCommand; env: 'dev' | 'docker' | 'prod' } {
  const args = process.argv.slice(2);
  let command: K8sCommand = 'status';
  let env: 'dev' | 'docker' | 'prod' = 'docker';

  for (const arg of args) {
    if (['apply', 'delete', 'status', 'forward', 'logs', 'secrets'].includes(arg)) {
      command = arg as K8sCommand;
    }
    if (arg === '--env=dev') env = 'dev';
    if (arg === '--env=docker') env = 'docker';
    if (arg === '--env=prod') env = 'prod';
  }

  return { command, env };
}

function checkKubectlAvailable(): boolean {
  try {
    execSync('kubectl version --client', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkK8sCluster(): boolean {
  try {
    execSync('kubectl cluster-info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function checkK8sManifestsExist(): Promise<boolean> {
  try {
    await access(K8S_DIR);
    return true;
  } catch {
    return false;
  }
}

async function generateManifests(): Promise<void> {
  console.log('K8s manifests not found. Generating...');
  
  const generateScript = join(__dirname, 'generate.ts');
  const tsxPath = join(ROOT_DIR, 'core-service', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [tsxPath, generateScript, '--k8s'], {
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

async function k8sApply(): Promise<void> {
  printHeader('Applying Kubernetes Manifests');

  if (!(await checkK8sManifestsExist())) {
    await generateManifests();
  }

  console.log('Applying manifests to cluster...');
  
  try {
    execSync(`kubectl apply -f "${K8S_DIR}"`, { stdio: 'inherit' });
    console.log('');
    console.log('✅ Manifests applied successfully');
    console.log('');
    console.log('Run "npm run k8s:status" to check pod status');
  } catch (err) {
    console.error('❌ Failed to apply manifests');
    throw err;
  }
}

async function k8sDelete(): Promise<void> {
  printHeader('Deleting Kubernetes Resources');

  try {
    execSync(`kubectl delete namespace ${NAMESPACE} --ignore-not-found`, { stdio: 'inherit' });
    console.log('');
    console.log('✅ Resources deleted');
  } catch (err) {
    console.error('Failed to delete resources (this may be expected if they don\'t exist)');
  }
}

async function k8sStatus(config: ServicesConfig): Promise<void> {
  printHeader('Kubernetes Status');

  // Check namespace exists
  try {
    execSync(`kubectl get namespace ${NAMESPACE}`, { stdio: 'ignore' });
    console.log(`✅ Namespace "${NAMESPACE}" exists`);
  } catch {
    console.log(`❌ Namespace "${NAMESPACE}" not found. Run "npm run k8s:apply" first.`);
    return;
  }

  console.log('');
  console.log('Pods:');
  try {
    execSync(`kubectl get pods -n ${NAMESPACE}`, { stdio: 'inherit' });
  } catch {
    console.log('  No pods found');
  }

  console.log('');
  console.log('Services:');
  try {
    execSync(`kubectl get services -n ${NAMESPACE}`, { stdio: 'inherit' });
  } catch {
    console.log('  No services found');
  }

  console.log('');
  console.log('Ingress:');
  try {
    execSync(`kubectl get ingress -n ${NAMESPACE}`, { stdio: 'inherit' });
  } catch {
    console.log('  No ingress found');
  }
}

async function k8sForward(config: ServicesConfig): Promise<void> {
  printHeader('Port Forwarding Services');
  console.log('Press Ctrl+C to stop all port forwards.');
  console.log('');

  const processes: ReturnType<typeof spawn>[] = [];

  for (const svc of config.services) {
    console.log(`Forwarding ${svc.name}-service: localhost:${svc.port} -> pod:${svc.port}`);
    
    const proc = spawn('kubectl', [
      'port-forward',
      `svc/${svc.name}-service`,
      `${svc.port}:${svc.port}`,
      '-n', NAMESPACE
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    proc.stdout?.on('data', (data) => {
      console.log(`[${svc.name}] ${data.toString().trim()}`);
    });

    proc.stderr?.on('data', (data) => {
      console.error(`[${svc.name}] ERROR: ${data.toString().trim()}`);
    });

    processes.push(proc);
  }

  console.log('');
  console.log('All services forwarded:');
  for (const svc of config.services) {
    console.log(`  ${svc.name.padEnd(15)} http://localhost:${svc.port}/graphql`);
  }
  console.log('');

  // Handle shutdown
  const shutdown = () => {
    console.log('\nStopping port forwards...');
    for (const proc of processes) {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep running
  await new Promise<void>(() => {});
}

async function k8sLogs(config: ServicesConfig): Promise<void> {
  printHeader('Streaming Logs from All Services');
  console.log('Press Ctrl+C to stop.');
  console.log('');

  // Use stern if available, otherwise fall back to kubectl
  try {
    execSync('stern --version', { stdio: 'ignore' });
    const proc = spawn('stern', ['.', '-n', NAMESPACE], {
      stdio: 'inherit',
      shell: true,
    });
    
    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
    });
  } catch {
    // Fall back to kubectl logs for first pod
    console.log('(Using kubectl logs - install stern for better multi-pod logging)');
    console.log('');
    
    const proc = spawn('kubectl', ['logs', '-f', '-l', 'app', '-n', NAMESPACE, '--all-containers'], {
      stdio: 'inherit',
      shell: true,
    });

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
    });
  }
}

async function k8sSecrets(config: ServicesConfig, env: string): Promise<void> {
  printHeader('Creating Kubernetes Secrets');

  const envConfig = config.environments[env];
  if (!envConfig) {
    console.error(`Environment "${env}" not found in services.json`);
    return;
  }

  console.log(`Creating secrets for environment: ${env}`);
  console.log('');

  // Ensure namespace exists
  try {
    execSync(`kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`, { stdio: 'ignore' });
  } catch {}

  // Create db-secrets
  try {
    const cmd = `kubectl create secret generic db-secrets ` +
      `--from-literal=mongodb-uri="${envConfig.mongoUri}" ` +
      `--from-literal=redis-url="${envConfig.redisUrl}" ` +
      `-n ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`;
    
    execSync(cmd, { stdio: 'inherit', shell: true });
    console.log('✅ Created db-secrets');
  } catch (err) {
    console.error('❌ Failed to create db-secrets');
    throw err;
  }
}

async function main(): Promise<void> {
  const { command, env } = parseArgs();
  const { config, mode } = await loadConfigFromArgs();

  console.log('');
  logConfigSummary(config, mode);

  // Check kubectl
  if (!checkKubectlAvailable()) {
    throw new Error('kubectl not found. Please install kubectl first: https://kubernetes.io/docs/tasks/tools/');
  }

  // Check cluster (except for status check)
  if (command !== 'status' && !checkK8sCluster()) {
    throw new Error('Cannot connect to Kubernetes cluster. Make sure Docker Desktop Kubernetes is enabled.');
  }

  switch (command) {
    case 'apply':
      await k8sApply();
      break;
    case 'delete':
      await k8sDelete();
      break;
    case 'status':
      await k8sStatus(config);
      break;
    case 'forward':
      await k8sForward(config);
      break;
    case 'logs':
      await k8sLogs(config);
      break;
    case 'secrets':
      await k8sSecrets(config, env);
      break;
  }
}

// forward and logs are long-running, others complete and exit
const args = process.argv.slice(2);
const isLongRunning = args.includes('forward') || args.includes('logs');
if (isLongRunning) {
  runLongRunningScript(main, { name: 'K8s' });
} else {
  runScript(main, { name: 'K8s' });
}
