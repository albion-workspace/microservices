/**
 * Health Check Script
 * 
 * Checks health of all services defined in configs/services.json
 * Cross-platform (Windows, Linux, Mac)
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIGS_DIR = join(__dirname, '..', 'configs');

interface ServiceConfig {
  name: string;
  port: number;
  healthPath: string;
}

interface ServicesConfig {
  services: ServiceConfig[];
}

async function loadConfig(): Promise<ServicesConfig> {
  const configPath = join(CONFIGS_DIR, 'services.json');
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

async function checkHealth(service: ServiceConfig): Promise<{ ok: boolean; status?: string; error?: string }> {
  const url = `http://localhost:${service.port}${service.healthPath}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json();
      return { ok: true, status: data.status || 'healthy' };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, error: 'Not responding' };
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' Service Health Check');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  const config = await loadConfig();
  
  let healthy = 0;
  let unhealthy = 0;

  for (const service of config.services) {
    const result = await checkHealth(service);
    
    if (result.ok) {
      console.log(`[OK] ${service.name} (port ${service.port}): ${result.status}`);
      healthy++;
    } else {
      console.log(`[FAIL] ${service.name} (port ${service.port}): ${result.error}`);
      unhealthy++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(` Summary: ${healthy} healthy, ${unhealthy} unhealthy`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  // Set exit code without forcing exit (let Node.js exit naturally)
  process.exitCode = unhealthy > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Health check failed:', err);
  process.exitCode = 1;
});
