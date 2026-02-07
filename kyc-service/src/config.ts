/**
 * KYC Service Configuration
 *
 * Dynamic config only: MongoDB config store + registered defaults. No process.env (CODING_STANDARDS).
 * KYCConfig extends DefaultServiceConfig (core-service); single config type in types.ts.
 */

import type { KYCConfig } from './types.js';
import { loadBaseServiceConfig, getBaseServiceConfigDefaults } from 'core-service';

export type { KYCConfig } from './types.js';

export const SERVICE_NAME = 'kyc-service';

export async function loadConfig(brand?: string, tenantId?: string): Promise<KYCConfig> {
  return loadBaseServiceConfig(SERVICE_NAME, getBaseServiceConfigDefaults({ port: 9005, serviceName: SERVICE_NAME }), { brand, tenantId });
}

export function validateConfig(config: KYCConfig): void {
  if (!config.jwtSecret || config.jwtSecret === 'shared-jwt-secret-change-in-production') {
    console.warn('JWT secret should be set in config store for production');
  }
}

export function printConfigSummary(config: KYCConfig): void {
  console.log('Config:', { port: config.port, serviceName: config.serviceName });
}
