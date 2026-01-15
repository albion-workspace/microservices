/**
 * Currency Types & Registry
 * 
 * Currencies are configurable - add your own via registerCurrency()
 */

// ═══════════════════════════════════════════════════════════════════
// Currency Registry (Configurable)
// ═══════════════════════════════════════════════════════════════════

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  type: 'fiat' | 'crypto';
  decimals: number;           // 2 for most fiat, 8 for BTC, 18 for ETH
  minorUnit?: string;         // 'cents', 'satoshi', 'wei'
  country?: string;           // For fiat: ISO country code
  network?: string;           // For crypto: 'ethereum', 'bitcoin', etc.
}

// Currency registry - extensible at runtime
const currencyRegistry = new Map<string, CurrencyConfig>();

// ═══════════════════════════════════════════════════════════════════
// Default Currencies (can be overridden)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_FIAT: CurrencyConfig[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', type: 'fiat', decimals: 2, minorUnit: 'cents', country: 'US' },
  { code: 'EUR', name: 'Euro', symbol: '€', type: 'fiat', decimals: 2, minorUnit: 'cents', country: 'EU' },
  { code: 'GBP', name: 'British Pound', symbol: '£', type: 'fiat', decimals: 2, minorUnit: 'pence', country: 'GB' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', type: 'fiat', decimals: 2, minorUnit: 'centavos', country: 'BR' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', type: 'fiat', decimals: 2, minorUnit: 'cents', country: 'CA' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', type: 'fiat', decimals: 2, minorUnit: 'cents', country: 'AU' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', type: 'fiat', decimals: 0, country: 'JP' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', type: 'fiat', decimals: 2, minorUnit: 'paise', country: 'IN' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', type: 'fiat', decimals: 2, minorUnit: 'centavos', country: 'MX' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', type: 'fiat', decimals: 2, minorUnit: 'rappen', country: 'CH' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', type: 'fiat', decimals: 2, minorUnit: 'öre', country: 'SE' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', type: 'fiat', decimals: 2, minorUnit: 'øre', country: 'NO' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', type: 'fiat', decimals: 2, minorUnit: 'grosz', country: 'PL' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', type: 'fiat', decimals: 2, minorUnit: 'haléř', country: 'CZ' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', type: 'fiat', decimals: 0, country: 'HU' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', type: 'fiat', decimals: 2, minorUnit: 'bani', country: 'RO' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', type: 'fiat', decimals: 2, minorUnit: 'kuruş', country: 'TR' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', type: 'fiat', decimals: 2, minorUnit: 'cents', country: 'ZA' },
];

const DEFAULT_CRYPTO: CurrencyConfig[] = [
  { code: 'BTC', name: 'Bitcoin', symbol: '₿', type: 'crypto', decimals: 8, minorUnit: 'satoshi', network: 'bitcoin' },
  { code: 'ETH', name: 'Ethereum', symbol: 'Ξ', type: 'crypto', decimals: 18, minorUnit: 'wei', network: 'ethereum' },
  { code: 'USDT', name: 'Tether', symbol: '₮', type: 'crypto', decimals: 6, network: 'ethereum' },
  { code: 'USDC', name: 'USD Coin', symbol: '$', type: 'crypto', decimals: 6, network: 'ethereum' },
  { code: 'BNB', name: 'Binance Coin', symbol: 'BNB', type: 'crypto', decimals: 18, network: 'binance' },
  { code: 'SOL', name: 'Solana', symbol: 'SOL', type: 'crypto', decimals: 9, network: 'solana' },
  { code: 'MATIC', name: 'Polygon', symbol: 'MATIC', type: 'crypto', decimals: 18, network: 'polygon' },
  { code: 'DOGE', name: 'Dogecoin', symbol: 'Ð', type: 'crypto', decimals: 8, network: 'dogecoin' },
  { code: 'LTC', name: 'Litecoin', symbol: 'Ł', type: 'crypto', decimals: 8, network: 'litecoin' },
  { code: 'XRP', name: 'Ripple', symbol: 'XRP', type: 'crypto', decimals: 6, network: 'ripple' },
];

// ═══════════════════════════════════════════════════════════════════
// Registry Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize currency registry with defaults
 * Call at application startup if you want built-in currencies
 */
export function initializeDefaultCurrencies(): void {
  [...DEFAULT_FIAT, ...DEFAULT_CRYPTO].forEach(c => currencyRegistry.set(c.code, c));
}

/**
 * Register a custom currency
 */
export function registerCurrency(config: CurrencyConfig): void {
  currencyRegistry.set(config.code, config);
}

/**
 * Register multiple currencies at once
 */
export function registerCurrencies(configs: CurrencyConfig[]): void {
  configs.forEach(c => currencyRegistry.set(c.code, c));
}

/**
 * Remove a currency from registry
 */
export function unregisterCurrency(code: string): boolean {
  return currencyRegistry.delete(code);
}

/**
 * Clear all currencies (for testing or custom setup)
 */
export function clearCurrencies(): void {
  currencyRegistry.clear();
}

/**
 * Get currency config by code
 */
export function getCurrency(code: string): CurrencyConfig | undefined {
  return currencyRegistry.get(code);
}

/**
 * Get all registered currencies
 */
export function getAllCurrencies(): CurrencyConfig[] {
  return Array.from(currencyRegistry.values());
}

/**
 * Get all currency codes
 */
export function getCurrencyCodes(): string[] {
  return Array.from(currencyRegistry.keys());
}

/**
 * Get fiat currencies only
 */
export function getFiatCurrencies(): CurrencyConfig[] {
  return getAllCurrencies().filter(c => c.type === 'fiat');
}

/**
 * Get crypto currencies only
 */
export function getCryptoCurrencies(): CurrencyConfig[] {
  return getAllCurrencies().filter(c => c.type === 'crypto');
}

/**
 * Check if currency is registered
 */
export function isCurrencyRegistered(code: string): boolean {
  return currencyRegistry.has(code);
}

/**
 * Check if currency is crypto
 */
export function isCrypto(code: string): boolean {
  return currencyRegistry.get(code)?.type === 'crypto';
}

/**
 * Check if currency is fiat
 */
export function isFiat(code: string): boolean {
  return currencyRegistry.get(code)?.type === 'fiat';
}

/**
 * Validate currency code
 */
export function isValidCurrency(code: string): boolean {
  return currencyRegistry.has(code);
}

// ═══════════════════════════════════════════════════════════════════
// Currency Type (for TypeScript)
// ═══════════════════════════════════════════════════════════════════

/**
 * Currency type - string-based for flexibility
 * Use isValidCurrency() at runtime to validate
 */
export type Currency = string;

/**
 * Strict currency type for when you need compile-time safety
 * Only includes built-in currencies
 */
export type BuiltInCurrency = 
  // Fiat
  | 'USD' | 'EUR' | 'GBP' | 'BRL' | 'CAD' | 'AUD' 
  | 'JPY' | 'INR' | 'MXN' | 'CHF' | 'SEK' | 'NOK'
  | 'PLN' | 'CZK' | 'HUF' | 'RON' | 'TRY' | 'ZAR'
  // Crypto
  | 'BTC' | 'ETH' | 'USDT' | 'USDC' | 'BNB' | 'SOL'
  | 'MATIC' | 'DOGE' | 'LTC' | 'XRP';

// ═══════════════════════════════════════════════════════════════════
// Amount Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert amount to smallest unit (e.g., dollars to cents)
 */
export function toSmallestUnit(amount: number, currencyCode: string): number {
  const currency = getCurrency(currencyCode);
  if (!currency) throw new Error(`Unknown currency: ${currencyCode}`);
  return Math.round(amount * Math.pow(10, currency.decimals));
}

/**
 * Convert from smallest unit to display amount
 */
export function fromSmallestUnit(amount: number, currencyCode: string): number {
  const currency = getCurrency(currencyCode);
  if (!currency) throw new Error(`Unknown currency: ${currencyCode}`);
  return amount / Math.pow(10, currency.decimals);
}

/**
 * Format currency amount for display
 */
export function formatCurrency(amount: number, currencyCode: string, locale = 'en-US'): string {
  const currency = getCurrency(currencyCode);
  if (!currency) return `${amount} ${currencyCode}`;
  
  const displayAmount = fromSmallestUnit(amount, currencyCode);
  
  if (currency.type === 'crypto') {
    return `${displayAmount.toFixed(Math.min(currency.decimals, 8))} ${currency.symbol}`;
  }
  
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(displayAmount);
  } catch {
    return `${currency.symbol}${displayAmount.toFixed(currency.decimals)}`;
  }
}

// Initialize with defaults on import (can be cleared if needed)
initializeDefaultCurrencies();

