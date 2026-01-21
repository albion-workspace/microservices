/**
 * Currency Exchange Rate Service
 * 
 * Generic currency conversion functionality for multi-currency operations.
 * The service is agnostic to business logic - it only handles currency conversion.
 * 
 * Supports:
 * - Real-time exchange rates (via external API)
 * - Cached exchange rates (for performance)
 * - Manual rate overrides (for testing/admin)
 * - Historical rate tracking
 * 
 * Usage:
 * - Automatically used by ledger-service for cross-currency transactions
 * - Can be used directly for manual conversions
 * - Exchange rates are cached for 5 minutes to reduce API calls
 */

import { getDatabase, logger, CircuitBreaker } from 'core-service';
import { SYSTEM_CURRENCY } from '../constants.js';

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number; // 1 unit of fromCurrency = rate units of toCurrency
  source: 'api' | 'manual' | 'cached';
  timestamp: Date;
  expiresAt?: Date;
}

export interface ExchangeRateProvider {
  name: string;
  getRate(fromCurrency: string, toCurrency: string): Promise<number>;
  isAvailable(): Promise<boolean>;
}

/**
 * In-memory cache for exchange rates (5 minute TTL)
 */
const rateCache = new Map<string, { rate: number; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Circuit breaker for exchange rate API calls
 * Prevents cascading failures when external API is down
 */
const exchangeRateCircuitBreaker = new CircuitBreaker({
  name: 'ExchangeRateAPI',
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  monitoringWindow: 120000, // 2 minutes
});

/**
 * Get exchange rate between two currencies
 * 
 * Priority:
 * 1. Manual override (if exists)
 * 2. Cached rate (if not expired)
 * 3. External API (if available)
 * 4. Default rate (1:1 for same currency, throw error for different)
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  options: {
    useCache?: boolean;
    allowManualOverride?: boolean;
  } = {}
): Promise<number> {
  const { useCache = true, allowManualOverride = true } = options;
  
  // Same currency - no conversion needed
  if (fromCurrency === toCurrency) {
    return 1.0;
  }
  
  const cacheKey = `${fromCurrency}:${toCurrency}`;
  
  // Check manual override first
  if (allowManualOverride) {
    const manualRate = await getManualExchangeRate(fromCurrency, toCurrency);
    if (manualRate !== null) {
      logger.debug('Using manual exchange rate override', { fromCurrency, toCurrency, rate: manualRate });
      return manualRate;
    }
  }
  
  // Check cache
  if (useCache) {
    const cached = rateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('Using cached exchange rate', { fromCurrency, toCurrency, rate: cached.rate });
      return cached.rate;
    }
  }
  
  // Try to fetch from external API (placeholder - implement actual API integration)
  try {
    // Use circuit breaker to protect against API failures
    const rate = await exchangeRateCircuitBreaker.execute(() =>
      fetchExchangeRateFromAPI(fromCurrency, toCurrency)
    );
    
    // Cache the rate
    if (useCache) {
      rateCache.set(cacheKey, {
        rate,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }
    
    // Store in database for historical tracking
    await storeExchangeRate(fromCurrency, toCurrency, rate, 'api');
    
    return rate;
  } catch (error) {
    const circuitBreakerState = exchangeRateCircuitBreaker.getState();
    
    logger.warn('Failed to fetch exchange rate from API', {
      fromCurrency,
      toCurrency,
      error: error instanceof Error ? error.message : String(error),
      circuitBreakerState,
    });
    
    // Fallback: Try reverse rate if available
    const reverseKey = `${toCurrency}:${fromCurrency}`;
    const reverseCached = rateCache.get(reverseKey);
    if (reverseCached && reverseCached.expiresAt > Date.now()) {
      logger.info('Using reverse cached exchange rate as fallback', {
        fromCurrency,
        toCurrency,
        reverseRate: reverseCached.rate,
      });
      return 1 / reverseCached.rate;
    }
    
    // Last resort: throw error (don't guess exchange rates!)
    throw new Error(
      `Exchange rate not available for ${fromCurrency} to ${toCurrency}. ` +
      `Please configure manual rate or ensure exchange rate API is available. ` +
      `Circuit breaker state: ${circuitBreakerState}`
    );
  }
}

/**
 * Convert amount from one currency to another
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  options?: { useCache?: boolean; allowManualOverride?: boolean }
): Promise<number> {
  const rate = await getExchangeRate(fromCurrency, toCurrency, options);
  return amount * rate;
}

/**
 * Get manual exchange rate override (from database)
 */
async function getManualExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<number | null> {
  try {
    const db = getDatabase();
    const rate = await db.collection('exchange_rates').findOne(
      {
        fromCurrency,
        toCurrency,
        source: 'manual',
        isActive: true,
      },
      { sort: { createdAt: -1 } } // Get most recent manual rate
    );
    
    return rate ? rate.rate : null;
  } catch (error) {
    logger.debug('Failed to fetch manual exchange rate', { error });
    return null;
  }
}

/**
 * Store exchange rate in database
 */
async function storeExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  rate: number,
  source: 'api' | 'manual'
): Promise<void> {
  try {
    const db = getDatabase();
    await db.collection('exchange_rates').insertOne({
      fromCurrency,
      toCurrency,
      rate,
      source,
      timestamp: new Date(),
      createdAt: new Date(),
      isActive: source === 'manual', // Manual rates are active until overridden
    });
  } catch (error) {
    logger.debug('Failed to store exchange rate', { error });
    // Non-critical - continue even if storage fails
  }
}

/**
 * Fetch exchange rate from external API
 * TODO: Integrate with actual exchange rate API (e.g., Fixer.io, ExchangeRate-API, etc.)
 */
async function fetchExchangeRateFromAPI(
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  // Placeholder implementation
  // In production, integrate with:
  // - Fixer.io: https://fixer.io
  // - ExchangeRate-API: https://www.exchangerate-api.com
  // - Open Exchange Rates: https://openexchangerates.org
  // - Or your preferred provider
  
  // For now, return a mock rate (1 EUR = 1.1 USD, etc.)
  // This should be replaced with actual API call
  
  const mockRates: Record<string, Record<string, number>> = {
    EUR: { USD: 1.1, GBP: 0.85, BTC: 0.000015, ETH: 0.00025 },
    USD: { EUR: 0.91, GBP: 0.77, BTC: 0.000014, ETH: 0.00023 },
    GBP: { EUR: 1.18, USD: 1.3, BTC: 0.000018, ETH: 0.0003 },
  };
  
  if (mockRates[fromCurrency] && mockRates[fromCurrency][toCurrency]) {
    logger.info('Using mock exchange rate (replace with real API)', {
      fromCurrency,
      toCurrency,
      rate: mockRates[fromCurrency][toCurrency],
    });
    return mockRates[fromCurrency][toCurrency];
  }
  
  throw new Error(`Mock exchange rate not available for ${fromCurrency} to ${toCurrency}`);
}

/**
 * Set manual exchange rate override (admin function)
 */
export async function setManualExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  rate: number,
  expiresAt?: Date
): Promise<void> {
  const db = getDatabase();
  
  // Deactivate existing manual rates for this pair
  await db.collection('exchange_rates').updateMany(
    {
      fromCurrency,
      toCurrency,
      source: 'manual',
      isActive: true,
    },
    {
      $set: { isActive: false, deactivatedAt: new Date() },
    }
  );
  
  // Insert new manual rate
  await db.collection('exchange_rates').insertOne({
    fromCurrency,
    toCurrency,
    rate,
    source: 'manual',
    timestamp: new Date(),
    expiresAt,
    createdAt: new Date(),
    isActive: true,
  });
  
  // Clear cache
  rateCache.delete(`${fromCurrency}:${toCurrency}`);
  rateCache.delete(`${toCurrency}:${fromCurrency}`);
  
  logger.info('Manual exchange rate set', { fromCurrency, toCurrency, rate });
}

/**
 * Get all active exchange rates
 */
export async function getAllExchangeRates(): Promise<ExchangeRate[]> {
  const db = getDatabase();
  const rates = await db.collection('exchange_rates')
    .find({ isActive: true })
    .sort({ createdAt: -1 })
    .toArray();
  
  return rates.map(rate => ({
    fromCurrency: rate.fromCurrency,
    toCurrency: rate.toCurrency,
    rate: rate.rate,
    source: rate.source,
    timestamp: rate.timestamp,
    expiresAt: rate.expiresAt,
  }));
}
