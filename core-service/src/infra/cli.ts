#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Infrastructure CLI - Generate Docker, K8s, Nginx configs
// ═══════════════════════════════════════════════════════════════════

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { generateInfra, loadConfig, generateSampleConfig, createDefaultConfig } from './generator.js';
import { generateService } from './service-generator.js';
import type { FullInfraConfig } from './types.js';

const HELP = `
═══════════════════════════════════════════════════════════════════
  Service-Core Infrastructure Generator
═══════════════════════════════════════════════════════════════════

Usage:
  npx service-core infra [options]
  service-infra [options]

Commands:
  generate    Generate infrastructure files (default)
  init        Create a sample infra.config.json
  service     Generate a new microservice scaffold (follows CODING_STANDARDS)

Options (generate/init):
  -c, --config <path>     Path to infra.config.json (default: ./infra.config.json)
  -o, --output <dir>      Output directory (default: .)
  -n, --name <name>       Service name (for quick generation without config file)
  -p, --port <port>       Service port (default: 3000)
  --dockerfile            Generate Dockerfile
  --compose               Generate docker-compose.yml
  --nginx                 Generate nginx.conf
  --k8s                   Generate K8s manifests
  --all                   Generate all files (default if no specific flag)
  --dry-run               Print output without writing files

Options (service):
  -n, --name <name>       Service name (e.g. test -> test-service) (required)
  -p, --port <port>       HTTP port (default: 9006)
  -o, --output <dir>      Parent directory for new service folder (default: .)
  --redis                 Include Redis accessor and bootstrap (default: true)
  --no-redis              Omit Redis
  --webhooks              Include webhook manager and createWebhookService stub
  --core-db               Use core_service database (like auth-service)
  --dry-run               List files only, do not write

  -h, --help              Show this help

Examples:
  # Initialize a new config file
  service-infra init --name my-api

  # Generate a new microservice (test-service) at ../test-service
  service-infra service --name test --port 9006 --output ..

  # Generate service with webhooks and no Redis
  service-infra service --name myapi --port 9007 --webhooks --no-redis

  # Preview service files
  service-infra service --name test --dry-run

`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string', short: 'c' },
      output: { type: 'string', short: 'o', default: '.' },
      name: { type: 'string', short: 'n' },
      port: { type: 'string', short: 'p', default: '3000' },
      dockerfile: { type: 'boolean', default: false },
      compose: { type: 'boolean', default: false },
      nginx: { type: 'boolean', default: false },
      k8s: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      redis: { type: 'boolean', default: undefined },
      'no-redis': { type: 'boolean', default: false },
      webhooks: { type: 'boolean', default: false },
      'core-db': { type: 'boolean', default: false },
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const command = positionals[0] || 'generate';

  if (command === 'init') {
    const name = values.name || 'my-service';
    const outputPath = resolve(values.output!, 'infra.config.json');
    await generateSampleConfig(outputPath, name);
    return;
  }

  if (command === 'service') {
    const name = values.name;
    if (!name) {
      console.error('❌ --name <name> is required for service command (e.g. --name test)');
      process.exit(1);
    }
    const port = parseInt(values.port || '9006', 10);
    const outputDir = resolve(values.output || '.');
    const useRedis = values.redis !== false && !values['no-redis'];
    const useWebhooks = values.webhooks === true;
    const useCoreDatabase = values['core-db'] === true;
    const dryRun = values['dry-run'] === true;
    const files = await generateService({
      serviceName: name,
      port,
      outputDir,
      useRedis,
      useWebhooks,
      useCoreDatabase,
      dryRun,
    });
    if (values['dry-run']) {
      console.log('Would create:');
      files.forEach((f) => console.log('  ', f));
    } else {
      console.log('Created', files.length, 'files in', outputDir);
      console.log('Next: add the service to gateway/configs/services.dev.json and run npm run generate from gateway.');
    }
    return;
  }

  if (command === 'generate') {
    let config: FullInfraConfig;

    // Try to load config file first
    if (values.config) {
      config = await loadConfig(resolve(values.config));
    } else if (values.name) {
      // Quick generation from CLI args
      config = createDefaultConfig(values.name, parseInt(values.port!, 10));
    } else {
      // Try default config path
      try {
        config = await loadConfig(resolve('./infra.config.json'));
      } catch {
        console.error('❌ No config file found. Use --config <path> or --name <service-name>');
        console.log('\nRun with --help for usage information.');
        process.exit(1);
      }
    }

    // Determine what to generate
    const hasSpecificFlags = values.dockerfile || values.compose || values.nginx || values.k8s;
    const generateAll = values.all || !hasSpecificFlags;

    await generateInfra(config, {
      outputDir: resolve(values.output!),
      dockerfile: generateAll || values.dockerfile,
      dockerCompose: generateAll || values.compose,
      nginx: generateAll || values.nginx,
      k8s: generateAll || values.k8s,
      all: generateAll,
      dryRun: values['dry-run']
    });

    if (!values['dry-run']) {
      console.log('\n✨ Infrastructure files generated successfully!');
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exit(1);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

