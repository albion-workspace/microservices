/**
 * With-Redis startup helper: configure strategy, initialize service accessor, then optional afterReady.
 * Use in services that need Redis + event handlers or webhooks after gateway starts.
 */

import { logger } from '../logger.js';
import { getErrorMessage } from '../errors.js';
import { configureRedisStrategy } from '../../databases/redis/service-accessor.js';
import type { ServiceRedisAccessor } from '../../databases/redis/service-accessor.js';

export interface WithRedisOptions {
  /** Called after Redis is configured and accessor initialized (e.g. initializeEventHandlers). */
  afterReady?: () => Promise<void>;
}

/**
 * If redisUrl is set: configure shared strategy, initialize the service's Redis accessor, then call afterReady.
 * Services pass their redis accessor from createServiceAccessors so the helper stays stateless.
 */
export async function withRedis(
  redisUrl: string | undefined,
  redis: ServiceRedisAccessor,
  context: { brand: string },
  options?: WithRedisOptions
): Promise<void> {
  if (!redisUrl) return;
  try {
    await configureRedisStrategy({ strategy: 'shared', defaultUrl: redisUrl });
    await redis.initialize({ brand: context.brand });
    logger.info('Redis accessor initialized', { brand: context.brand });
    await options?.afterReady?.();
  } catch (err) {
    logger.warn('Could not initialize Redis/event handlers', {
      error: getErrorMessage(err),
    });
  }
}
