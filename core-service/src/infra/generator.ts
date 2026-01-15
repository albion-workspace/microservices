// ═══════════════════════════════════════════════════════════════════
// Infrastructure Generator
// ═══════════════════════════════════════════════════════════════════

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { FullInfraConfig, DockerConfig, DockerComposeConfig, NginxConfig, K8sConfig } from './types.js';
import { generateDockerfile, generateDockerCompose, generateNginxConf, generateK8sManifests } from './templates/index.js';

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

