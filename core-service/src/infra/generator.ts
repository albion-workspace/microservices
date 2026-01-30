// ═══════════════════════════════════════════════════════════════════
// Infrastructure Generator
// ═══════════════════════════════════════════════════════════════════

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { FullInfraConfig, DockerConfig, DockerComposeConfig, NginxConfig, K8sConfig, GatewayRoutingConfig, MultiServiceNginxConfig } from './types.js';
import { generateDockerfile, generateDockerCompose, generateNginxConf, generateK8sManifests, generateMultiServiceNginxConf } from './templates/index.js';

export interface GeneratorOptions {
  /** Output directory for generated files */
  outputDir: string;
  
  /** Generate Dockerfile */
  dockerfile?: boolean;
  
  /** Generate docker-compose.yml */
  dockerCompose?: boolean;
  
  /** Generate nginx.conf */
  nginx?: boolean;
  
  /** Generate K8s manifests */
  k8s?: boolean;
  
  /** Generate all files */
  all?: boolean;
  
  /** Dry run - print to console instead of writing */
  dryRun?: boolean;
}

export interface GeneratedFiles {
  dockerfile?: string;
  dockerCompose?: string;
  nginx?: string;
  k8s?: string;
}

/**
 * Generate infrastructure files from configuration
 */
export async function generateInfra(
  config: FullInfraConfig,
  options: GeneratorOptions
): Promise<GeneratedFiles> {
  const { service, docker = {}, compose = {}, nginx = {}, k8s = {} } = config;
  const { outputDir, dockerfile, dockerCompose, nginx: genNginx, k8s: genK8s, all, dryRun } = options;
  
  const results: GeneratedFiles = {};
  
  // Merge service config with specific configs
  const dockerConfig: DockerConfig = { ...service, ...docker };
  const composeConfig: DockerComposeConfig = { ...service, ...compose };
  const nginxConfig: NginxConfig = { ...service, ...nginx };
  const k8sConfig: K8sConfig = { ...service, ...k8s };
  
  // Generate requested files
  if (all || dockerfile) {
    results.dockerfile = generateDockerfile(dockerConfig);
  }
  
  if (all || dockerCompose) {
    results.dockerCompose = generateDockerCompose(composeConfig);
  }
  
  if (all || genNginx) {
    results.nginx = generateNginxConf(nginxConfig);
  }
  
  if (all || genK8s) {
    results.k8s = generateK8sManifests(k8sConfig);
  }
  
  // Write files or print to console
  if (dryRun) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(' DRY RUN - Generated Files Preview');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    if (results.dockerfile) {
      console.log('📄 Dockerfile:\n');
      console.log(results.dockerfile);
    }
    if (results.dockerCompose) {
      console.log('📄 docker-compose.yml:\n');
      console.log(results.dockerCompose);
    }
    if (results.nginx) {
      console.log('📄 nginx.conf:\n');
      console.log(results.nginx);
    }
    if (results.k8s) {
      console.log('📄 k8s/deployment.yaml:\n');
      console.log(results.k8s);
    }
  } else {
    await mkdir(outputDir, { recursive: true });
    
    if (results.dockerfile) {
      await writeFile(join(outputDir, 'Dockerfile'), results.dockerfile);
      console.log('✅ Generated Dockerfile');
    }
    
    if (results.dockerCompose) {
      await writeFile(join(outputDir, 'docker-compose.yml'), results.dockerCompose);
      console.log('✅ Generated docker-compose.yml');
    }
    
    if (results.nginx) {
      await writeFile(join(outputDir, 'nginx.conf'), results.nginx);
      console.log('✅ Generated nginx.conf');
    }
    
    if (results.k8s) {
      const k8sDir = join(outputDir, 'k8s');
      await mkdir(k8sDir, { recursive: true });
      await writeFile(join(k8sDir, 'deployment.yaml'), results.k8s);
      console.log('✅ Generated k8s/deployment.yaml');
    }
  }
  
  return results;
}

/**
 * Load configuration from a JSON file
 */
export async function loadConfig(configPath: string): Promise<FullInfraConfig> {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Create a default configuration template
 */
export function createDefaultConfig(serviceName: string, port: number = 3000): FullInfraConfig {
  const namespace = process.env.DOCKER_NAMESPACE || process.env.MS_NAMESPACE || 'ms';
  
  return {
    service: {
      name: serviceName,
      port,
      healthPath: '/health',
      imageName: `${serviceName}:latest`
    },
    docker: {
      nodeVersion: '20',
      entryPoint: 'dist/index.js'
    },
    compose: {
      replicas: 3,
      includeMongo: true,
      includeRedis: true,
      namespace
    },
    nginx: {
      rateLimit: 100,
      proxyEndpoints: ['/graphql', '/api']
    },
    k8s: {
      namespace,
      replicas: 3,
      minReplicas: 3,
      maxReplicas: 20,
      domain: `${serviceName}.your-domain.com`
    }
  };
}

/**
 * Generate a sample infra.config.json file
 */
export async function generateSampleConfig(outputPath: string, serviceName: string): Promise<void> {
  const config = createDefaultConfig(serviceName);
  const content = JSON.stringify(config, null, 2);
  
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
  console.log(`✅ Generated sample config at ${outputPath}`);
}

// ═══════════════════════════════════════════════════════════════════
// Multi-Service Gateway Generator
// ═══════════════════════════════════════════════════════════════════

export interface MultiServiceGeneratorOptions {
  /** Output directory for generated files */
  outputDir: string;
  /** Generate nginx config for multi-service routing */
  nginx?: boolean;
  /** Generate docker-compose for all services */
  dockerCompose?: boolean;
  /** Generate all files */
  all?: boolean;
  /** Dry run - print to console instead of writing */
  dryRun?: boolean;
}

export interface MultiServiceGeneratedFiles {
  nginx?: string;
  dockerCompose?: string;
}

/**
 * Generate multi-service gateway infrastructure
 * Creates nginx config with header-based routing for all services
 */
export async function generateMultiServiceInfra(
  gatewayConfig: GatewayRoutingConfig,
  options: MultiServiceGeneratorOptions
): Promise<MultiServiceGeneratedFiles> {
  const { outputDir, nginx, dockerCompose, all, dryRun } = options;
  const results: MultiServiceGeneratedFiles = {};

  // Generate nginx config for multi-service routing
  if (all || nginx) {
    const nginxConfig: MultiServiceNginxConfig = {
      gateway: gatewayConfig,
      rateLimit: gatewayConfig.rateLimit || 100,
      includeHttps: true,
    };
    results.nginx = generateMultiServiceNginxConf(nginxConfig);
  }

  // Generate docker-compose for all services (if requested)
  if (all || dockerCompose) {
    results.dockerCompose = generateMultiServiceDockerCompose(gatewayConfig);
  }

  // Write files or print to console
  if (dryRun) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(' DRY RUN - Multi-Service Gateway Files Preview');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    if (results.nginx) {
      console.log('📄 gateway-nginx.conf:\n');
      console.log(results.nginx);
    }
    if (results.dockerCompose) {
      console.log('📄 docker-compose.gateway.yml:\n');
      console.log(results.dockerCompose);
    }
  } else {
    await mkdir(outputDir, { recursive: true });
    
    if (results.nginx) {
      await writeFile(join(outputDir, 'gateway-nginx.conf'), results.nginx);
      console.log('✅ Generated gateway-nginx.conf');
    }
    
    if (results.dockerCompose) {
      await writeFile(join(outputDir, 'docker-compose.gateway.yml'), results.dockerCompose);
      console.log('✅ Generated docker-compose.gateway.yml');
    }
  }

  return results;
}

/**
 * Generate docker-compose for multi-service gateway setup
 */
function generateMultiServiceDockerCompose(gateway: GatewayRoutingConfig): string {
  const { services, port = 80 } = gateway;
  const namespace = process.env.DOCKER_NAMESPACE || process.env.MS_NAMESPACE || 'ms';

  const serviceBlocks = services.map(svc => `  ${svc.name}:
    image: ${svc.name}:latest
    ports:
      - "${svc.port}:${svc.port}"
    environment:
      - PORT=${svc.port}
      - NODE_ENV=production
      - MONGODB_URI=mongodb://${namespace}-mongo:27017/${svc.name.replace(/-/g, '_')}
      - REDIS_URL=redis://${namespace}-redis:6379
    depends_on:
      - ${namespace}-mongo
      - ${namespace}-redis
    networks:
      - ${namespace}-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${svc.port}${svc.healthPath || '/health'}"]
      interval: 30s
      timeout: 10s
      retries: 3`).join('\n\n');

  return `# ═══════════════════════════════════════════════════════════════════
# Multi-Service Gateway Docker Compose
# Generated by core-service infra generator
#
# Services: ${services.map(s => s.name).join(', ')}
# Gateway Port: ${port}
# ═══════════════════════════════════════════════════════════════════

version: '3.8'

services:
  # ─────────────────────────────────────────────────────────────────
  # Nginx Gateway (Routes by X-Target-Service header)
  # ─────────────────────────────────────────────────────────────────
  gateway:
    image: nginx:alpine
    ports:
      - "${port}:${port}"
    volumes:
      - ./gateway-nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
${services.map(s => `      - ${s.name}`).join('\n')}
    networks:
      - ${namespace}-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ─────────────────────────────────────────────────────────────────
  # Microservices
  # ─────────────────────────────────────────────────────────────────
${serviceBlocks}

  # ─────────────────────────────────────────────────────────────────
  # Infrastructure
  # ─────────────────────────────────────────────────────────────────
  ${namespace}-mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - ${namespace}-mongo-data:/data/db
    networks:
      - ${namespace}-network

  ${namespace}-redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - ${namespace}-network

networks:
  ${namespace}-network:
    driver: bridge

volumes:
  ${namespace}-mongo-data:
`;
}

/**
 * Create default gateway routing configuration for all services
 */
export function createDefaultGatewayRoutingConfig(): GatewayRoutingConfig {
  return {
    strategy: 'per-service',
    port: 9999,
    defaultService: 'auth',
    rateLimit: 100,
    services: [
      { name: 'auth', host: 'auth-service', port: 9001 },
      { name: 'payment', host: 'payment-service', port: 9002 },
      { name: 'bonus', host: 'bonus-service', port: 9003 },
      { name: 'notification', host: 'notification-service', port: 9004 },
      { name: 'kyc', host: 'kyc-service', port: 9005 },
    ],
  };
}

