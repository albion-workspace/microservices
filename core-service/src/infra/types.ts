// ═══════════════════════════════════════════════════════════════════
// Infrastructure Configuration Types
// ═══════════════════════════════════════════════════════════════════

export interface ServiceConfig {
  /** Service name (e.g., 'retail-api', 'payment-service') */
  name: string;
  
  /** Service description */
  description?: string;
  
  /** Port the service runs on */
  port: number;
  
  /** Health check endpoint path */
  healthPath?: string;
  
  /** Docker image registry/prefix (e.g., 'mycompany', 'ghcr.io/myorg') */
  imageRegistry?: string;
  
  /** Full Docker image name (overrides imageRegistry + name) */
  imageName?: string;
  
  /** Node.js version for Docker */
  nodeVersion?: string;
}

export interface DockerConfig extends ServiceConfig {
  /** Entry point file (default: dist/index.js) */
  entryPoint?: string;
  
  /** Service-core package name as it appears in node_modules (e.g., '@myorg/service-core') */
  serviceCorePackageName?: string;
}

export interface DockerComposeConfig extends ServiceConfig {
  /** Number of replicas */
  replicas?: number;
  
  /** CPU limit (e.g., '0.5') */
  cpuLimit?: string;
  
  /** Memory limit (e.g., '512M') */
  memoryLimit?: string;
  
  /** Include MongoDB service */
  includeMongo?: boolean;
  
  /** Include Redis service */
  includeRedis?: boolean;
  
  /** Namespace/project name for grouping containers in Docker Desktop (default: ms) */
  namespace?: string;
  
  /** MongoDB container name (default: {namespace}-mongo) */
  mongoContainerName?: string;
  
  /** Redis container name (default: {namespace}-redis) */
  redisContainerName?: string;
  
  /** MongoDB image version (default: latest) */
  mongoImageVersion?: string;
  
  /** Redis image version (default: latest) */
  redisImageVersion?: string;
  
  /** MongoDB port (default: 27017) */
  mongoPort?: number;
  
  /** Redis port (default: 6379) */
  redisPort?: number;
  
  /** Additional environment variables */
  envVars?: Record<string, string>;
}

export interface NginxConfig extends ServiceConfig {
  /** Upstream name */
  upstreamName?: string;
  
  /** Rate limit per second */
  rateLimit?: number;
  
  /** Endpoints to proxy (default: ['/graphql', '/api']) */
  proxyEndpoints?: string[];
  
  /** Enable HTTPS config block (commented) */
  includeHttps?: boolean;
}

export interface K8sConfig extends ServiceConfig {
  /** Kubernetes namespace */
  namespace?: string;
  
  /** Number of replicas */
  replicas?: number;
  
  /** Min replicas for HPA */
  minReplicas?: number;
  
  /** Max replicas for HPA */
  maxReplicas?: number;
  
  /** CPU request (e.g., '250m') */
  cpuRequest?: string;
  
  /** CPU limit (e.g., '500m') */
  cpuLimit?: string;
  
  /** Memory request (e.g., '256Mi') */
  memoryRequest?: string;
  
  /** Memory limit (e.g., '512Mi') */
  memoryLimit?: string;
  
  /** Domain for Ingress */
  domain?: string;
  
  /** Secret name for sensitive configs */
  secretName?: string;
}

export interface FullInfraConfig {
  service: ServiceConfig;
  docker?: Partial<DockerConfig>;
  compose?: Partial<DockerComposeConfig>;
  nginx?: Partial<NginxConfig>;
  k8s?: Partial<K8sConfig>;
}

