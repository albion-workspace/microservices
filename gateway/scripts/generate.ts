/**
 * Infrastructure Generator Script
 * 
 * Generates infrastructure configurations from services.{mode}.json.
 * All values come from config - no hardcoded defaults or process.env.
 * 
 * Usage:
 *   npm run generate                        # Generate all (dev config)
 *   npm run generate -- --config=shared     # Generate with shared config
 *   npm run generate -- --config=local-k8s  # Generate for local K8s
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateMultiServiceNginxConf,
  generateDockerfile,
  type GatewayRoutingConfig,
  type ServiceEndpoint,
  type MultiServiceNginxConfig,
  type DockerConfig,
} from 'core-service';

import { loadConfigFromArgs, logConfigSummary, type ServicesConfig, type ConfigMode, getMongoUri, getRedisUrl } from './config-loader.js';
import { runScript, printHeader, printFooter } from './script-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT_DIR, 'generated');

// ═══════════════════════════════════════════════════════════════════
// Nginx Generation
// ═══════════════════════════════════════════════════════════════════

function buildGatewayRoutingConfig(config: ServicesConfig): GatewayRoutingConfig {
  const services: ServiceEndpoint[] = config.services.map(svc => ({
    name: svc.name,
    host: svc.host,
    port: svc.port,
    healthPath: svc.healthPath,
    graphqlPath: svc.graphqlPath,
  }));

  return {
    strategy: config.mode === 'shared' ? 'shared' : 'per-service',
    port: config.gateway.port,
    defaultService: config.gateway.defaultService,
    services,
    rateLimit: config.gateway.rateLimit,
  };
}

async function generateNginx(config: ServicesConfig, mode: ConfigMode): Promise<void> {
  console.log('🔧 Generating nginx configuration...');
  
  const gatewayConfig = buildGatewayRoutingConfig(config);
  const nginxConfig: MultiServiceNginxConfig = {
    gateway: gatewayConfig,
    rateLimit: config.gateway.rateLimit,
    includeHttps: true,
  };

  const nginxContent = generateMultiServiceNginxConf(nginxConfig);
  
  const nginxDir = join(OUTPUT_DIR, 'nginx');
  await mkdir(nginxDir, { recursive: true });
  await writeFile(join(nginxDir, 'nginx.conf'), nginxContent);
  
  console.log('✅ Generated: generated/nginx/nginx.conf');
}

// ═══════════════════════════════════════════════════════════════════
// Docker Compose Generation
// ═══════════════════════════════════════════════════════════════════

async function generateDockerCompose(config: ServicesConfig, mode: ConfigMode): Promise<void> {
  console.log('🔧 Generating docker-compose configurations...');
  
  const dockerDir = join(OUTPUT_DIR, 'docker');
  await mkdir(dockerDir, { recursive: true });

  // Generate dev compose
  const devCompose = generateDevCompose(config, mode);
  await writeFile(join(dockerDir, 'docker-compose.dev.yml'), devCompose);
  console.log('✅ Generated: generated/docker/docker-compose.dev.yml');

  // Generate prod compose (with nginx gateway)
  const prodCompose = generateProdCompose(config, mode);
  await writeFile(join(dockerDir, 'docker-compose.prod.yml'), prodCompose);
  console.log('✅ Generated: generated/docker/docker-compose.prod.yml');
}

function generateDevCompose(config: ServicesConfig, mode: ConfigMode): string {
  const mongo = config.infrastructure.mongodb;
  const redis = config.infrastructure.redis;
  // Use dockerContainer name for Docker, fallback to host
  const mongoContainer = (mongo as any).dockerContainer || mongo.host;
  const redisContainer = (redis as any).dockerContainer || redis.host;

  const serviceBlocks = config.services.map(svc => {
    const replicas = (svc as any).replicas || 1;
    // Context is relative to docker-compose file at gateway/generated/docker/
    // Need ../../.. to reach project root
    return `  ${svc.name}-service:
    build:
      context: ../../..
      dockerfile: ${svc.name}-service/Dockerfile
    ports:
      - "${svc.port}:${svc.port}"
    environment:
      - PORT=${svc.port}
      - NODE_ENV=development
      - MONGODB_URI=mongodb://${mongoContainer}:${mongo.port}/${svc.database}
      - REDIS_URL=redis://${redisContainer}:${redis.port}
    depends_on:
      - ${mongoContainer}
      - ${redisContainer}
    networks:
      - ms-network
    volumes:
      - ../../../${svc.name}-service/src:/app/src:ro`;
  }).join('\n\n');

  // Check if using existing infrastructure
  const dockerConfig = (config as any).docker || {};
  const useExistingInfra = dockerConfig.useExistingInfra || false;
  const existingNetwork = dockerConfig.existingNetwork || 'ms-network';

  // Generate MongoDB service based on mode (skip if using existing infra)
  const mongoService = useExistingInfra ? '' : generateMongoDockerService(config);
  
  // Generate Redis service based on mode (skip if using existing infra)
  const redisService = useExistingInfra ? '' : generateRedisDockerService(config);

  // Network configuration
  const networkConfig = useExistingInfra 
    ? `networks:
  ${existingNetwork}:
    external: true`
    : `networks:
  ms-network:
    driver: bridge`;

  // Volume configuration (only needed if creating infra)
  const volumeConfig = useExistingInfra ? '' : `
volumes:
  mongo-data:
  redis-data:`;

  // Update depends_on for services when using existing infra
  const serviceBlocksUpdated = useExistingInfra
    ? serviceBlocks.replace(/    depends_on:\n      - ms-mongo\n      - ms-redis\n/g, '')
        .replace(/ms-network/g, existingNetwork)
    : serviceBlocks;

  return `# Docker Compose - Development Mode (${mode})
# Generated by gateway/scripts/generate.ts
# MongoDB: ${mongo.mode}, Redis: ${redis.mode}
# Using existing infrastructure: ${useExistingInfra}

services:
${serviceBlocksUpdated}
${mongoService}
${redisService}
${networkConfig}
${volumeConfig}
`;
}

function generateMongoDockerService(config: ServicesConfig): string {
  const mongo = config.infrastructure.mongodb;
  // Use dockerContainer name for Docker, fallback to a default
  const mongoContainer = (mongo as any).dockerContainer || 'ms-mongo';

  if (mongo.mode === 'replicaSet' && mongo.members) {
    // Replica Set mode
    const members = mongo.members;
    const primaryHost = members[0]?.host.split('.')[0] || 'mongo-primary';
    
    let services = `  # MongoDB Replica Set
  ${primaryHost}:
    image: mongo:7
    command: ["--replSet", "${mongo.replicaSet}", "--bind_ip_all"]
    ports:
      - "${mongo.port}:27017"
    volumes:
      - mongo-data:/data/db
    networks:
      - ms-network
    healthcheck:
      test: |
        mongosh --quiet --eval "
          try { rs.status().ok } catch (e) {
            rs.initiate({_id: '${mongo.replicaSet}', members: [${members.map((m, i) => `{_id: ${i}, host: '${m.host.split('.')[0]}:27017'${m.priority ? `, priority: ${m.priority}` : ''}}`).join(', ')}]});
            1
          }
        " | grep -q 1
      interval: 10s
      timeout: 10s
      retries: 10
      start_period: 30s`;

    // Add secondary nodes
    for (let i = 1; i < members.length; i++) {
      const secondaryHost = members[i].host.split('.')[0];
      services += `

  ${secondaryHost}:
    image: mongo:7
    command: ["--replSet", "${mongo.replicaSet}", "--bind_ip_all"]
    volumes:
      - mongo-data-${i}:/data/db
    networks:
      - ms-network
    depends_on:
      - ${primaryHost}`;
    }

    return services;
  }

  // Single mode
  return `  # MongoDB (Single)
  ${mongoContainer}:
    image: mongo:7
    ports:
      - "${mongo.port}:27017"
    volumes:
      - mongo-data:/data/db
    networks:
      - ms-network`;
}

function generateRedisDockerService(config: ServicesConfig): string {
  const redis = config.infrastructure.redis;
  // Use dockerContainer name for Docker, fallback to a default
  const redisContainer = (redis as any).dockerContainer || 'ms-redis';

  if (redis.mode === 'sentinel' && redis.sentinel) {
    // Sentinel mode
    const sentinel = redis.sentinel;
    
    return `  # Redis Master
  ${redisContainer}:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "${redis.port}:6379"
    volumes:
      - redis-data:/data
    networks:
      - ms-network

  # Redis Sentinels
${sentinel.hosts.map((h, i) => {
  const sentinelHost = h.host.split('.')[0];
  return `  ${sentinelHost}:
    image: redis:7-alpine
    command: >
      sh -c "echo 'sentinel monitor ${sentinel.name} ${redisHost} 6379 2' > /tmp/sentinel.conf &&
             echo 'sentinel down-after-milliseconds ${sentinel.name} 5000' >> /tmp/sentinel.conf &&
             echo 'sentinel failover-timeout ${sentinel.name} 60000' >> /tmp/sentinel.conf &&
             redis-sentinel /tmp/sentinel.conf"
    ports:
      - "${h.port}:26379"
    networks:
      - ms-network
    depends_on:
      - ${redisHost}`;
}).join('\n\n')}`;
  }

  // Single mode
  return `  # Redis (Single)
  ${redisContainer}:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "${redis.port}:6379"
    volumes:
      - redis-data:/data
    networks:
      - ms-network`;
}

function generateProdCompose(config: ServicesConfig, mode: ConfigMode): string {
  const gatewayPort = config.gateway.port;
  const mongo = config.infrastructure.mongodb;
  const redis = config.infrastructure.redis;
  // Use dockerContainer name for Docker, fallback to defaults
  const mongoContainer = (mongo as any).dockerContainer || 'ms-mongo';
  const redisContainer = (redis as any).dockerContainer || 'ms-redis';

  const serviceBlocks = config.services.map(svc => {
    const replicas = (svc as any).replicas || 2;
    return `  ${svc.name}-service:
    image: ${svc.name}-service:latest
    environment:
      - PORT=${svc.port}
      - NODE_ENV=production
      - MONGODB_URI=mongodb://${mongoContainer}:${mongo.port}/${svc.database}
      - REDIS_URL=redis://${redisContainer}:${redis.port}
    depends_on:
      - ${mongoContainer}
      - ${redisContainer}
    networks:
      - ms-network
    deploy:
      replicas: ${replicas}
      resources:
        limits:
          cpus: '0.5'
          memory: 512M`;
  }).join('\n\n');

  const mongoService = generateMongoDockerService(config);
  const redisService = generateRedisDockerService(config);

  return `# Docker Compose - Production Mode (${mode})
# Generated by gateway/scripts/generate.ts
# Gateway port: ${gatewayPort}, MongoDB: ${mongo.mode}, Redis: ${redis.mode}

version: '3.8'

services:
  # Nginx Gateway
  gateway:
    image: nginx:alpine
    ports:
      - "${gatewayPort}:${gatewayPort}"
    volumes:
      - ../nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
${config.services.map(s => `      - ${s.name}-service`).join('\n')}
    networks:
      - ms-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${gatewayPort}/health"]
      interval: 30s
      timeout: 10s
      retries: 3

${serviceBlocks}

${mongoService}

${redisService}

networks:
  ms-network:
    driver: bridge

volumes:
  mongo-data:
  redis-data:
`;
}

// ═══════════════════════════════════════════════════════════════════
// Kubernetes Generation
// ═══════════════════════════════════════════════════════════════════

async function generateK8s(config: ServicesConfig, mode: ConfigMode): Promise<void> {
  console.log('🔧 Generating Kubernetes manifests...');
  
  const k8sDir = join(OUTPUT_DIR, 'k8s');
  await mkdir(k8sDir, { recursive: true });

  const namespace = (config as any).kubernetes?.namespace || 'microservices';

  // Namespace
  await writeFile(join(k8sDir, '00-namespace.yaml'), generateK8sNamespace(namespace));

  // ConfigMap
  await writeFile(join(k8sDir, '01-configmap.yaml'), generateK8sConfigMap(config, namespace));

  // Secrets template
  await writeFile(join(k8sDir, '02-secrets.yaml'), generateK8sSecrets(config, namespace, mode));

  // MongoDB
  await writeFile(join(k8sDir, '05-mongodb.yaml'), generateK8sMongoDB(config, namespace));

  // Redis
  await writeFile(join(k8sDir, '06-redis.yaml'), generateK8sRedis(config, namespace));

  // Service deployments
  for (const svc of config.services) {
    const deployment = generateK8sDeployment(svc, config, namespace);
    await writeFile(join(k8sDir, `10-${svc.name}-deployment.yaml`), deployment);
  }

  // Ingress
  await writeFile(join(k8sDir, '20-ingress.yaml'), generateK8sIngress(config, namespace));

  console.log('✅ Generated: generated/k8s/*.yaml');
}

function generateK8sNamespace(namespace: string): string {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespace}
`;
}

function generateK8sConfigMap(config: ServicesConfig, namespace: string): string {
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: services-config
  namespace: ${namespace}
data:
  GATEWAY_PORT: "${config.gateway.port}"
  DEFAULT_SERVICE: "${config.gateway.defaultService}"
  MONGODB_MODE: "${config.infrastructure.mongodb.mode}"
  REDIS_MODE: "${config.infrastructure.redis.mode}"
${config.services.map(s => `  ${s.name.toUpperCase().replace(/-/g, '_')}_PORT: "${s.port}"`).join('\n')}
`;
}

function generateK8sSecrets(config: ServicesConfig, namespace: string, mode: ConfigMode): string {
  const mongoUri = getMongoUri(config, 'local');
  const redisUrl = getRedisUrl(config, 'local');

  return `# Secrets - Update these for your environment
apiVersion: v1
kind: Secret
metadata:
  name: db-secrets
  namespace: ${namespace}
type: Opaque
stringData:
  mongodb-uri: "${mongoUri}"
  redis-url: "${redisUrl}"
  jwt-secret: "change-me-in-production"
`;
}

function generateK8sMongoDB(config: ServicesConfig, namespace: string): string {
  const mongo = config.infrastructure.mongodb;

  if (mongo.mode === 'replicaSet') {
    return `# MongoDB StatefulSet (Replica Set)
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
  namespace: ${namespace}
spec:
  serviceName: mongodb
  replicas: 3
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
      - name: mongodb
        image: mongo:7
        command: ["mongod", "--replSet", "${mongo.replicaSet}", "--bind_ip_all"]
        ports:
        - containerPort: 27017
        volumeMounts:
        - name: mongo-data
          mountPath: /data/db
  volumeClaimTemplates:
  - metadata:
      name: mongo-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: mongodb
  namespace: ${namespace}
spec:
  clusterIP: None
  selector:
    app: mongodb
  ports:
  - port: 27017
    targetPort: 27017
`;
  }

  // Single mode
  return `# MongoDB Deployment (Single)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
      - name: mongodb
        image: mongo:7
        ports:
        - containerPort: 27017
        volumeMounts:
        - name: mongo-data
          mountPath: /data/db
      volumes:
      - name: mongo-data
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: mongodb
  namespace: ${namespace}
spec:
  selector:
    app: mongodb
  ports:
  - port: 27017
    targetPort: 27017
`;
}

function generateK8sRedis(config: ServicesConfig, namespace: string): string {
  const redis = config.infrastructure.redis;

  if (redis.mode === 'sentinel' && redis.sentinel) {
    return `# Redis with Sentinel
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: ${namespace}
spec:
  serviceName: redis
  replicas: 3
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        command: ["redis-server", "--appendonly", "yes"]
        ports:
        - containerPort: 6379
        volumeMounts:
        - name: redis-data
          mountPath: /data
  volumeClaimTemplates:
  - metadata:
      name: redis-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: ${namespace}
spec:
  clusterIP: None
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
`;
  }

  // Single mode
  return `# Redis Deployment (Single)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        command: ["redis-server", "--appendonly", "yes"]
        ports:
        - containerPort: 6379
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: ${namespace}
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
`;
}

function generateK8sDeployment(svc: ServicesConfig['services'][0], config: ServicesConfig, namespace: string): string {
  const replicas = (svc as any).replicas || 1;
  const k8sConfig = (config as any).kubernetes || {};
  const resources = k8sConfig.resources || {
    requests: { cpu: '100m', memory: '128Mi' },
    limits: { cpu: '500m', memory: '512Mi' }
  };

  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${svc.name}-service
  namespace: ${namespace}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${svc.name}-service
  template:
    metadata:
      labels:
        app: ${svc.name}-service
    spec:
      containers:
      - name: ${svc.name}-service
        image: ${svc.name}-service:latest
        imagePullPolicy: ${k8sConfig.imagePullPolicy || 'IfNotPresent'}
        ports:
        - containerPort: ${svc.port}
        env:
        - name: PORT
          value: "${svc.port}"
        - name: NODE_ENV
          value: "production"
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: mongodb-uri
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: redis-url
        livenessProbe:
          httpGet:
            path: ${svc.healthPath}
            port: ${svc.port}
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: ${svc.healthPath}
            port: ${svc.port}
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            cpu: "${resources.requests.cpu}"
            memory: "${resources.requests.memory}"
          limits:
            cpu: "${resources.limits.cpu}"
            memory: "${resources.limits.memory}"
---
apiVersion: v1
kind: Service
metadata:
  name: ${svc.name}-service
  namespace: ${namespace}
spec:
  selector:
    app: ${svc.name}-service
  ports:
  - port: ${svc.port}
    targetPort: ${svc.port}
`;
}

function generateK8sIngress(config: ServicesConfig, namespace: string): string {
  const defaultSvc = config.services.find(s => s.name === config.gateway.defaultService);
  const defaultPort = defaultSvc?.port || 9001;

  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-gateway
  namespace: ${namespace}
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /graphql
    nginx.ingress.kubernetes.io/configuration-snippet: |
      # Route based on X-Target-Service header
      set $target_service $http_x_target_service;
      if ($target_service = "") {
        set $target_service "${config.gateway.defaultService}";
      }
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /graphql
        pathType: Prefix
        backend:
          service:
            name: ${config.gateway.defaultService}-service
            port:
              number: ${defaultPort}
`;
}

// ═══════════════════════════════════════════════════════════════════
// Dockerfile Generation (using core-service template)
// ═══════════════════════════════════════════════════════════════════

async function generateDockerfiles(config: ServicesConfig): Promise<void> {
  console.log('🔧 Generating Dockerfiles for services...');
  
  const PROJECT_ROOT = join(__dirname, '..', '..');
  
  for (const service of config.services) {
    const dockerConfig: DockerConfig = {
      name: `${service.name}-service`,
      port: service.port,
      healthPath: service.healthPath,
      nodeVersion: '20',
      entryPoint: 'dist/index.js',
      serviceCorePackageName: 'core-service',
    };
    
    const dockerfile = generateDockerfile(dockerConfig);
    const outputPath = join(PROJECT_ROOT, `${service.name}-service`, 'Dockerfile');
    
    await writeFile(outputPath, dockerfile);
    console.log(`✅ Generated: ${service.name}-service/Dockerfile`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  printHeader('Gateway Infrastructure Generator');

  const { config, mode } = await loadConfigFromArgs();
  logConfigSummary(config, mode);
  console.log('');

  const generateAll = args.includes('--all') || !args.some(a => a.startsWith('--') && !a.startsWith('--config'));
  
  if (generateAll || args.includes('--dockerfile')) {
    await generateDockerfiles(config);
  }
  
  if (generateAll || args.includes('--nginx')) {
    await generateNginx(config, mode);
  }
  
  if (generateAll || args.includes('--docker')) {
    await generateDockerCompose(config, mode);
  }
  
  if (generateAll || args.includes('--k8s')) {
    await generateK8s(config, mode);
  }

  printFooter(`Generation Complete! (${mode} config)`);
  console.log('Output directory: gateway/generated/');
  console.log('');
}

runScript(main, { name: 'Generate' });
