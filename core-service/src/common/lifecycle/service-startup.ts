/**
 * Service startup pipeline: register codes/defaults, resolve context, load config,
 * initialize DB, start gateway, optional ensureDefaults, optional Redis, optional afterGateway.
 * Use in service main() to reduce duplication and centralize error handling.
 */

import { logger } from '../logger.js';
import { getErrorMessage } from '../errors.js';
import { createGateway } from '../../gateway/index.js';
import type { GatewayConfig } from '../../gateway/server.js';
import { ensureServiceDefaultConfigsCreated } from '../config/store.js';
import { withRedis } from './redis-startup.js';
import type { ServiceRedisAccessor } from '../../databases/redis/service-accessor.js';

export interface ServiceStartupOptions<C = { port?: number }> {
  serviceName: string;
  /** Call to register error codes (e.g. () => registerServiceErrorCodes(KYC_ERROR_CODES)). */
  registerErrorCodes: () => void;
  /** Call to register config defaults (e.g. () => registerServiceConfigDefaults(SERVICE_NAME, DEFAULTS)). */
  registerConfigDefaults: () => void;
  resolveContext: () => Promise<{ brand: string; tenantId?: string }>;
  loadConfig: (brand?: string, tenantId?: string) => Promise<C>;
  validateConfig?: (config: C) => void;
  printConfigSummary?: (config: C) => void;
  /** Initialize DB, indexes, providers, etc. */
  afterDb: (context: { brand: string; tenantId?: string }) => Promise<void>;
  buildGatewayConfig: (config: C) => GatewayConfig;
  ensureDefaults?: boolean;
  /** If set, run withRedis(config.redisUrl, redis, context, { afterReady }) after gateway. Config must have redisUrl. */
  withRedis?: {
    redis: ServiceRedisAccessor;
    afterReady?: () => Promise<void>;
  };
  afterGateway?: () => Promise<void>;
}

/**
 * Run the standard service startup sequence. Logs and process.exit(1) on error.
 */
export async function runServiceStartup<C>(options: ServiceStartupOptions<C>): Promise<void> {
  const {
    serviceName,
    registerErrorCodes,
    registerConfigDefaults,
    resolveContext,
    loadConfig,
    validateConfig,
    printConfigSummary,
    afterDb,
    buildGatewayConfig,
    ensureDefaults = false,
    withRedis: withRedisOpt,
    afterGateway,
  } = options;

  try {
    logger.info(`Starting ${serviceName}`);
    registerErrorCodes();
    registerConfigDefaults();

    const context = await resolveContext();
    const config = await loadConfig(context.brand, context.tenantId);
    validateConfig?.(config);
    printConfigSummary?.(config);

    await afterDb(context);
    await createGateway(buildGatewayConfig(config));
    logger.info(`${serviceName} started`, { port: (config as { port?: number }).port });

    if (ensureDefaults) {
      await ensureServiceDefaultConfigsCreated(serviceName, context);
    }
    if (withRedisOpt) {
      const url = (config as { redisUrl?: string }).redisUrl;
      await withRedis(url, withRedisOpt.redis, context, {
        afterReady: withRedisOpt.afterReady,
      });
    }
    await afterGateway?.();
  } catch (error) {
    logger.error(`Failed to start ${serviceName}`, { error: getErrorMessage(error) });
    process.exit(1);
  }
}
