// ═══════════════════════════════════════════════════════════════════
// Infrastructure Templates - Index
// ═══════════════════════════════════════════════════════════════════

export { generateDockerfile, generateCoreBaseDockerfile, generateServiceDockerfile } from './docker-image.js';
export { generateDockerCompose } from './docker-compose.js';
export { generateNginxConf, generateMultiServiceNginxConf } from './nginx.js';
export { generateK8sManifests } from './k8s.js';

