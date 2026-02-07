/**
 * Payment Service Error Codes
 * 
 * Complete list of all error codes used by payment-service.
 * Used for GraphQL error discovery and i18n key generation.
 * 
 * Usage: Import constants and use directly with GraphQLError
 * ```typescript
 * import { GraphQLError } from 'core-service';
 * import { PAYMENT_ERRORS } from './error-codes.js';
 * 
 * throw new GraphQLError(PAYMENT_ERRORS.ExchangeRateNotAvailable, { fromCurrency, toCurrency });
 * ```
 * 
 * Constants are the single source of truth - array is derived from them
 */
export const PAYMENT_ERRORS = {
  FailedToGetSystemUserId: 'MSPaymentFailedToGetSystemUserId',
  FailedToCreateBonusTransfer: 'MSPaymentFailedToCreateBonusTransfer',
  FailedToCreditBonusToWallet: 'MSPaymentFailedToCreditBonusToWallet',
  FailedToCreateBonusConversionTransfer: 'MSPaymentFailedToCreateBonusConversionTransfer',
  FailedToConvertBonusToRealBalance: 'MSPaymentFailedToConvertBonusToRealBalance',
  FailedToForfeitBonusFromWallet: 'MSPaymentFailedToForfeitBonusFromWallet',
  ExchangeRateNotAvailable: 'MSPaymentExchangeRateNotAvailable',
  UserIdRequired: 'MSPaymentUserIdRequired',
  FailedToGetWalletBalance: 'MSPaymentFailedToGetWalletBalance',
  FailedToGetUserBalances: 'MSPaymentFailedToGetUserBalances',
  WalletAlreadyExists: 'MSPaymentWalletAlreadyExists',
  DuplicateTransfer: 'MSPaymentDuplicateTransfer',
  WalletNotFound: 'MSPaymentWalletNotFound',
  InsufficientBalance: 'MSPaymentInsufficientBalance',
  BulkBalancesFailed: 'MSPaymentBulkBalancesFailed',
  ReferenceNotFound: 'MSPaymentReferenceNotFound',
} as const;

/**
 * Array derived from constants - no duplication, automatically synced
 * Used for GraphQL error discovery query registration
 */
export const PAYMENT_ERROR_CODES = Object.values(PAYMENT_ERRORS) as readonly string[];

export type PaymentErrorCode = typeof PAYMENT_ERRORS[keyof typeof PAYMENT_ERRORS];
