/**
 * KYC Provider Factory
 * 
 * Factory for creating and managing KYC providers
 */

import { getErrorMessage, getServiceConfigKey, logger, GraphQLError } from 'core-service';

import { SERVICE_NAME } from '../config.js';
import { KYC_ERRORS } from '../error-codes.js';
import type {
  KYCProvider,
  ProviderFactory,
  ProviderCapabilities,
  ProviderConfig,
} from '../types/provider-types.js';
import type { KYCTier } from '../types/kyc-types.js';

import { MockKYCProvider } from './mock-provider.js';

// ═══════════════════════════════════════════════════════════════════
// Provider Registry
// ═══════════════════════════════════════════════════════════════════

const providers = new Map<string, KYCProvider>();
let defaultProviderName: string = 'mock';

// ═══════════════════════════════════════════════════════════════════
// Provider Factory Implementation
// ═══════════════════════════════════════════════════════════════════

export const providerFactory: ProviderFactory = {
  /**
   * Get provider by name
   */
  getProvider(name: string): KYCProvider | null {
    return providers.get(name) ?? null;
  },
  
  /**
   * Get all registered providers
   */
  getProviders(): KYCProvider[] {
    return Array.from(providers.values());
  },
  
  /**
   * Get provider for specific capability
   */
  getProviderForCapability(capability: keyof ProviderCapabilities['checks']): KYCProvider | null {
    for (const provider of providers.values()) {
      if (provider.capabilities.checks[capability]) {
        return provider;
      }
    }
    return null;
  },
  
  /**
   * Get provider for country
   */
  getProviderForCountry(countryCode: string): KYCProvider | null {
    for (const provider of providers.values()) {
      const { supportedCountries, excludedCountries } = provider.capabilities;
      
      // Check if excluded
      if (excludedCountries?.includes(countryCode)) {
        continue;
      }
      
      // If supportedCountries is empty, all countries are supported
      if (supportedCountries.length === 0 || supportedCountries.includes(countryCode)) {
        return provider;
      }
    }
    return null;
  },
  
  /**
   * Get preferred provider for tier
   */
  getProviderForTier(tier: KYCTier, countryCode?: string): KYCProvider | null {
    // First try to find a provider for the country
    if (countryCode) {
      const countryProvider = this.getProviderForCountry(countryCode);
      if (countryProvider) {
        return countryProvider;
      }
    }
    
    // Fall back to default provider
    return this.getProvider(defaultProviderName);
  },
  
  /**
   * Register a provider
   */
  registerProvider(provider: KYCProvider): void {
    providers.set(provider.name, provider);
    logger.info('KYC provider registered', { 
      name: provider.name, 
      displayName: provider.displayName,
    });
  },
};

// ═══════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════

interface ProvidersConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
}

/**
 * Initialize KYC providers from configuration
 */
export async function initializeProviders(): Promise<void> {
  const config = await getServiceConfigKey<ProvidersConfig | null>(SERVICE_NAME, 'providers', null, {});
  
  if (!config) {
    logger.warn('No KYC provider configuration found, using mock provider');
    // Register mock provider as default
    const mockProvider = new MockKYCProvider({
      name: 'mock',
      enabled: true,
      apiUrl: '',
      apiKey: '',
    });
    providerFactory.registerProvider(mockProvider);
    return;
  }
  
  defaultProviderName = config.defaultProvider;
  
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    if (!providerConfig.enabled) {
      continue;
    }
    
    try {
      const provider = await createProvider(name, providerConfig);
      if (provider) {
        providerFactory.registerProvider(provider);
      }
    } catch (error) {
      logger.error('Failed to initialize KYC provider', {
        provider: name,
        error: getErrorMessage(error),
      });
    }
  }
  
  // Ensure we have at least one provider
  if (providers.size === 0) {
    logger.warn('No KYC providers initialized, using mock provider');
    const mockProvider = new MockKYCProvider({
      name: 'mock',
      enabled: true,
      apiUrl: '',
      apiKey: '',
    });
    providerFactory.registerProvider(mockProvider);
  }
  
  logger.info('KYC providers initialized', {
    count: providers.size,
    providers: Array.from(providers.keys()),
    default: defaultProviderName,
  });
}

/** Registry: add entries for onfido, sumsub, jumio when implemented. */
const providerConstructors: Record<string, (config: ProviderConfig) => KYCProvider | null> = {
  mock: (c) => new MockKYCProvider(c),
};

async function createProvider(name: string, config: ProviderConfig): Promise<KYCProvider | null> {
  const factory = providerConstructors[name];
  if (!factory) {
    logger.warn('Unknown KYC provider', { name });
    return null;
  }
  return factory(config);
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the default provider
 */
export function getDefaultProvider(): KYCProvider {
  const provider = providerFactory.getProvider(defaultProviderName);
  if (!provider) {
    throw new GraphQLError(KYC_ERRORS.ProviderNotFound, { providerName: defaultProviderName });
  }
  return provider;
}

/**
 * Get provider or default
 */
export function getProviderOrDefault(name?: string): KYCProvider {
  if (name) {
    const provider = providerFactory.getProvider(name);
    if (provider) {
      return provider;
    }
  }
  return getDefaultProvider();
}

/**
 * Check if provider is available
 */
export function isProviderAvailable(name: string): boolean {
  return providers.has(name);
}

/**
 * Get provider names
 */
export function getProviderNames(): string[] {
  return Array.from(providers.keys());
}
