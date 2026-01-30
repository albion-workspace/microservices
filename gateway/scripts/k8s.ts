/**
 * Kubernetes Orchestration Script
 * 
 * Manages Kubernetes deployment (local Docker Desktop or remote):
 * - Apply/delete manifests (all or specific service)
 * - Check pod status
 * - Port forward for testing
 * - Create secrets
 * 
 * Cross-platform (Windows, Linux, Mac)
 * 
 * Usage:
 *   npm run k8s:apply                         # Apply all manifests
 *   npm run k8s:apply:auth                    # Apply only auth-service
 *   npm run k8s:delete                        # Delete all resources
 *   npm run k8s:status                        # Check pod status
 *   npm run k8s:forward                       # Port forward all services
 *   npm run k8s:logs:auth                     # View auth-service logs
 * 
 * Single service can also be specified via SERVICE env var (PowerShell compatible):
 *   $env:SERVICE="auth"; npm run k8s:apply
 */

import { spawn, execSync } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromArgs, logConfigSummary, type ServicesConfig, type ServiceConfig } from './config-loader.js';
import { runScript, runLongRunningScript, printHeader } from './script-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const GATEWAY_DIR = join(__dirname, '..');
const GENERATED_DIR = join(GATEWAY_DIR, 'generated');
const K8S_DIR = join(GENERATED_DIR, 'k8s');

const NAMESPACE = 'microservices';

type K8sCommand = 'apply' | 'delete' | 'status' | 'forward' | 'logs' | 'secrets' | 'fresh' | 'load-images';

interface ParsedArgs {
  command: K8sCommand;
  env: 'dev' | 'docker' | 'prod';
  service?: string;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command: K8sCommand = 'status';
  let env: 'dev' | 'docker' | 'prod' = 'docker';
  
  // Support SERVICE env var for PowerShell compatibility
  let service: string | undefined = process.env.SERVICE?.replace(/-service$/, '');

  for (const arg of args) {
    if (['apply', 'delete', 'status', 'forward', 'logs', 'secrets', 'fresh', 'load-images'].includes(arg)) {
      command = arg as K8sCommand;
    }
    if (arg === '--env=dev') env = 'dev';
    if (arg === '--env=docker') env = 'docker';
    if (arg === '--env=prod') env = 'prod';
    // Support --service=auth or --service=auth-service
    if (arg.startsWith('--service=')) {
      service = arg.split('=')[1].replace(/-service$/, '');
    }
  }

  return { command, env, service };
}

/**
 * Get a single service by name
 */
function getService(config: ServicesConfig, serviceName: string): ServiceConfig {
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

async function k8sApply(serviceName?: string): Promise<void> {
  const targetMsg = serviceName ? ` (${serviceName} only)` : '';
  printHeader(`Applying Kubernetes Manifests${targetMsg}`);

  if (!(await checkK8sManifestsExist())) {
    await generateManifests();
  }

  console.log('Applying manifests to cluster...');
  
  try {
    if (serviceName) {
      // Single service deploy - ensure namespace and infrastructure exist first
      console.log('Ensuring namespace exists...');
      const namespaceFile = join(K8S_DIR, '00-namespace.yaml');
      try {
        await access(namespaceFile);
        execSync(`kubectl apply -f "${namespaceFile}"`, { stdio: 'inherit' });
      } catch {
        // Create namespace directly if file doesn't exist
        execSync(`kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`, { stdio: 'ignore' });
      }
      
      // Apply configmap and secrets if they exist
      const configFiles = ['01-configmap.yaml', '02-secrets.yaml'];
      for (const configFile of configFiles) {
        const filePath = join(K8S_DIR, configFile);
        try {
          await access(filePath);
          execSync(`kubectl apply -f "${filePath}"`, { stdio: 'ignore' });
        } catch {
          // Skip if doesn't exist
        }
      }
      
      // Apply service manifest
      const possibleFiles = [
        join(K8S_DIR, `10-${serviceName}-deployment.yaml`),
        join(K8S_DIR, `${serviceName}-deployment.yaml`),
        join(K8S_DIR, `${serviceName}-service.yaml`),
      ];
      
      let applied = false;
      for (const file of possibleFiles) {
        try {
          await access(file);
          console.log(`Applying ${serviceName} service...`);
          execSync(`kubectl apply -f "${file}"`, { stdio: 'inherit' });
          applied = true;
          break;
        } catch {
          // Try next file
        }
      }
      
      if (!applied) {
        throw new Error(`No manifest found for service "${serviceName}". Expected files like: 10-${serviceName}-deployment.yaml`);
      }
    } else {
      // Apply all manifests
      execSync(`kubectl apply -f "${K8S_DIR}"`, { stdio: 'inherit' });
    }
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

async function k8sForward(config: ServicesConfig, serviceName?: string): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const targetMsg = serviceName ? ` (${serviceName})` : '';
  printHeader(`Port Forwarding Services${targetMsg}`);
  console.log('Press Ctrl+C to stop all port forwards.');
  console.log('');

  const processes: ReturnType<typeof spawn>[] = [];

  for (const svc of services) {
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
  console.log('Services forwarded:');
  for (const svc of services) {
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

async function k8sLogs(config: ServicesConfig, serviceName?: string): Promise<void> {
  const targetMsg = serviceName ? ` (${serviceName})` : ' (all services)';
  printHeader(`Streaming Logs${targetMsg}`);
  console.log('Press Ctrl+C to stop.');
  console.log('');

  if (serviceName) {
    // Stream logs for specific service
    const proc = spawn('kubectl', [
      'logs', '-f',
      '-l', `app=${serviceName}-service`,
      '-n', NAMESPACE,
      '--all-containers'
    ], {
      stdio: 'inherit',
      shell: true,
    });

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
    });
    return;
  }

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
    // Fall back to kubectl logs for all pods
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

/**
 * Load Docker images into Kind cluster
 */
async function k8sLoadImages(config: ServicesConfig, serviceName?: string): Promise<void> {
  const services = getTargetServices(config, serviceName);
  const targetMsg = serviceName ? ` (${serviceName} only)` : '';
  printHeader(`Loading Docker Images into Kind${targetMsg}`);
  
  // Check if using Kind
  try {
    const context = execSync('kubectl config current-context', { encoding: 'utf8' }).trim();
    if (!context.startsWith('kind-')) {
      console.log('Not using Kind cluster. Skipping image load.');
      console.log(`Current context: ${context}`);
      return;
    }
    
    // Extract cluster name from context (kind-<cluster-name>)
    const clusterName = context.replace('kind-', '');
    console.log(`Kind cluster detected: ${clusterName}`);
    console.log('');
    
    for (const svc of services) {
      const imageName = `${svc.name}-service:latest`;
      console.log(`Loading ${imageName}...`);
      try {
        execSync(`kind load docker-image ${imageName} --name ${clusterName}`, { stdio: 'inherit' });
        console.log(`✅ Loaded ${imageName}`);
      } catch (err) {
        console.error(`❌ Failed to load ${imageName}. Make sure the image is built first.`);
      }
    }
    
    console.log('');
    console.log('Images loaded. Now you can deploy with "npm run k8s:apply"');
  } catch (err) {
    console.error('Failed to detect cluster type');
    throw err;
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
  const { command, env, service } = parseArgs();
  const { config, mode } = await loadConfigFromArgs();

  console.log('');
  logConfigSummary(config, mode);
  
  if (service) {
    console.log(`   Target service: ${service}`);
  }

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
      await k8sApply(service);
      break;
    case 'delete':
      await k8sDelete();
      break;
    case 'status':
      await k8sStatus(config);
      break;
    case 'forward':
      await k8sForward(config, service);
      break;
    case 'logs':
      await k8sLogs(config, service);
      break;
    case 'secrets':
      await k8sSecrets(config, env);
      break;
    case 'load-images':
      await k8sLoadImages(config, service);
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
