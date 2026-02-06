/**
 * KYC Service shared types
 * Config extends DefaultServiceConfig (core-service); single config type, aligned with service generator.
 */

import type { DefaultServiceConfig } from 'core-service';

/** KYC service config: extends DefaultServiceConfig from core-service. */
export interface KYCConfig extends DefaultServiceConfig {}
