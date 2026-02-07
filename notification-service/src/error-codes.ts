/**
 * Notification Service Error Codes
 * 
 * Complete list of all error codes used by notification-service.
 * Used for GraphQL error discovery and i18n key generation.
 * 
 * Usage: Import constants and use directly with GraphQLError
 * ```typescript
 * import { GraphQLError } from 'core-service';
 * import { NOTIFICATION_ERRORS } from './error-codes.js';
 * 
 * throw new GraphQLError(NOTIFICATION_ERRORS.FailedToSendNotification, { error });
 * ```
 * 
 * Constants are the single source of truth - array is derived from them
 */
export const NOTIFICATION_ERRORS = {
  SystemAccessRequired: 'MSNotificationSystemAccessRequired',
  ChannelRequiresUserId: 'MSNotificationChannelRequiresUserId',
  FailedToSendNotification: 'MSNotificationFailedToSendNotification',
  RequiredProvidersFailedToInitialize: 'MSNotificationRequiredProvidersFailedToInitialize',
  ProviderNotConfigured: 'MSNotificationProviderNotConfigured',
  FailedToSendSocketNotification: 'MSNotificationFailedToSendSocketNotification',
  FailedToSendSSENotification: 'MSNotificationFailedToSendSSENotification',
  EmailProviderNotConfigured: 'MSNotificationEmailProviderNotConfigured',
  EmailProviderVerificationFailed: 'MSNotificationEmailProviderVerificationFailed',
  WhatsAppProviderNotConfigured: 'MSNotificationWhatsAppProviderNotConfigured',
  FailedToSendWhatsApp: 'MSNotificationFailedToSendWhatsApp',
  SMSProviderNotConfigured: 'MSNotificationSMSProviderNotConfigured',
  FailedToSendSMS: 'MSNotificationFailedToSendSMS',
  ChannelRequired: 'MSNotificationChannelRequired',
  ChannelRequiresTo: 'MSNotificationChannelRequiresTo',
} as const;

/**
 * Array derived from constants - no duplication, automatically synced
 * Used for GraphQL error discovery query registration
 */
export const NOTIFICATION_ERROR_CODES = Object.values(NOTIFICATION_ERRORS) as readonly string[];

export type NotificationErrorCode = typeof NOTIFICATION_ERRORS[keyof typeof NOTIFICATION_ERRORS];
