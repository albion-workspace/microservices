/**
 * Health Check Script
 * 
 * Checks health of all services based on environment:
 * - local: Uses localhost (default for dev)
 * - docker: Uses Docker container hostnames
 * - k8s: Uses Kubernetes service DNS names
 * 
 * Usage:
 *   npm run health                         # Local (localhost)
 *   npm run health -- --env=docker         # Docker hostnames
 *   npm run health -- --env=k8s            # K8s DNS names
 *   npm run health:local                   # Local K8s config
 *   npm run health:shared                  # Shared config
 */

import { execSync } from 'node:child_process';

import { loadConfigFromArgs, logConfigSummary, getInfraConfig, getDockerContainerNames, type ServiceConfig, type ServicesConfig } from './config-loader.js';
import { runScript, checkHttpHealth, printHeader, printFooter, type HealthResult } from './script-runner.js';

type HealthEnv = 'local' | 'docker' | 'k8s';

function parseEnv(): HealthEnv {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--env=docker') return 'docker';
    if (arg === '--env=k8s') return 'k8s';
    if (arg === '--env=local') return 'local';
  }
  return 'local';
}

function getServiceUrl(service: ServiceConfig, env: HealthEnv): string {
  const healthPath = service.healthPath || '/health';
  
  switch (env) {
    case 'docker':
    case 'k8s':
      return `http://${service.host}:${service.port}${healthPath}`;
    case 'local':
    default:
      return `http://localhost:${service.port}${healthPath}`;
  }
}

function checkDockerContainer(containerName: string): HealthResult {
  try {
    const result = execSync(`docker inspect --format="{{.State.Status}}" ${containerName} 2>nul || echo not_found`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().replace(/"/g, '');

    if (result === 'running') {
      return { ok: true, status: 'running (docker)' };
    } else if (result === 'not_found' || result === '') {
      return { ok: false, error: 'Container not found' };
    } else {
      return { ok: false, error: `Container ${result}` };
    }
  } catch {
    return { ok: false, error: 'Docker check failed' };
  }
}

function checkK8sPod(namespace: string, appLabel: string): HealthResult {
  try {
    const result = execSync(`kubectl get pods -n ${namespace} -l app=${appLabel} -o jsonpath="{.items[0].status.phase}" 2>nul || echo not_found`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().replace(/"/g, '');

    if (result === 'Running') {
      return { ok: true, status: 'running (k8s)' };
    } else if (result === 'not_found' || result === '') {
      return { ok: false, error: 'Pod not found' };
    } else {
      return { ok: false, error: `Pod ${result}` };
    }
  } catch {
    return { ok: false, error: 'K8s check failed' };
  }
}

async function checkService(
  service: ServiceConfig,
  env: HealthEnv,
  namespace: string
): Promise<HealthResult> {
  if (env === 'docker') {
    const containerName = `${getInfraConfig().docker.projectName}-${service.name}-service`;
    const dockerResult = checkDockerContainer(containerName);
    if (dockerResult.ok) {
      return dockerResult;
    }
    const url = getServiceUrl(service, env);
    return checkHttpHealth(url);
  }
  
  if (env === 'k8s') {
    // Try K8s pod status first
    const k8sResult = checkK8sPod(namespace, `${service.name}-service`);
    if (k8sResult.ok) {
      return k8sResult;
    }
    // Fallback to localhost (port-forward)
    const url = `http://localhost:${service.port}${service.healthPath || '/health'}`;
    const httpResult = await checkHttpHealth(url);
    if (httpResult.ok) {
      httpResult.status = `${httpResult.status} (port-forward)`;
    }
    return httpResult;
  }
  
  // Local - HTTP check
  const url = getServiceUrl(service, env);
  return checkHttpHealth(url);
}

async function checkInfrastructure(
  config: ServicesConfig,
  env: HealthEnv,
  namespace: string
): Promise<void> {
  if (env !== 'docker' && env !== 'k8s') return;

  console.log('');
  console.log('Infrastructure:');
  
  const { mongodb: mongo, redis } = config.infrastructure;
  
  if (env === 'docker') {
    const { mongo: mongoContainer, redis: redisContainer } = getDockerContainerNames(getInfraConfig());

    const mongoResult = checkDockerContainer(mongoContainer);
    console.log(`[${mongoResult.ok ? 'OK' : 'FAIL'}] MongoDB (${mongo.mode}): ${mongoResult.status || mongoResult.error}`);
    
    const redisResult = checkDockerContainer(redisContainer);
    console.log(`[${redisResult.ok ? 'OK' : 'FAIL'}] Redis (${redis.mode}): ${redisResult.status || redisResult.error}`);
  } else if (env === 'k8s') {
    const mongoResult = checkK8sPod(namespace, 'mongodb');
    console.log(`[${mongoResult.ok ? 'OK' : 'FAIL'}] MongoDB (${mongo.mode}): ${mongoResult.status || mongoResult.error}`);
    
    const redisResult = checkK8sPod(namespace, 'redis');
    console.log(`[${redisResult.ok ? 'OK' : 'FAIL'}] Redis (${redis.mode}): ${redisResult.status || redisResult.error}`);
  }
}

async function main(): Promise<void> {
  const env = parseEnv();
  const { config, mode } = await loadConfigFromArgs();
  const namespace = (config as any).kubernetes?.namespace || 'microservices';

  printHeader('Service Health Check');
  
  logConfigSummary(config, mode);
  console.log(`   Environment: ${env}`);
  console.log('');
  
  let healthy = 0;
  let unhealthy = 0;

  for (const service of config.services) {
    const result = await checkService(service, env, namespace);
    
    if (result.ok) {
      console.log(`[OK] ${service.name} (port ${service.port}): ${result.status}`);
      healthy++;
    } else {
      const urlInfo = result.url ? ` -> ${result.url}` : '';
      console.log(`[FAIL] ${service.name} (port ${service.port}): ${result.error}${urlInfo}`);
      unhealthy++;
    }
  }

  await checkInfrastructure(config, env, namespace);

  printFooter(`Summary: ${healthy} healthy, ${unhealthy} unhealthy`);

  if (unhealthy > 0) {
    throw new Error(`${unhealthy} service(s) unhealthy`);
  }
}

runScript(main, { name: 'Health check' });
