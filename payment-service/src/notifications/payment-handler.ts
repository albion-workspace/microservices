/**
 * Payment Service Notification Handler
 *
 * Handles payment-related events and sends notifications.
 * Uses NotificationHandlerPlugin and HandlerContext from core-service.
 */

import { logger, on } from 'core-service';
import type { IntegrationEvent, NotificationHandlerPlugin, HandlerContext } from 'core-service';

// ═══════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════

interface PaymentEventData {
  type: string;
  userId?: string;
  tenantId?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  [key: string]: any;
}

export const paymentNotificationHandler: NotificationHandlerPlugin = {
  name: 'payment',
  description: 'Handles payment events (completed, failed, refunded)',
  channels: ['integration:payment'],
  eventTypes: [
    'payment.completed',
    'payment.failed',
    'payment.refunded',
  ],

  isAvailable(): boolean {
    // Check if payment service integration is available
    return true;
  },

  initialize(notificationService: any): void {
    logger.info('Initializing payment notification handlers');

    on<PaymentEventData>('integration:payment', async (event) => {
      const { eventType, data, userId, tenantId } = event as IntegrationEvent<PaymentEventData>;
      const type = eventType || (data as any).type;

      const context: HandlerContext = {
        notificationService,
        event,
        logger: logger as HandlerContext['logger'],
      };

      try {
        switch (type) {
          case 'payment.completed':
            await handlePaymentCompleted(context);
            break;

          case 'payment.failed':
            await handlePaymentFailed(context);
            break;

          case 'payment.refunded':
            await handlePaymentRefunded(context);
            break;

          default:
            logger.debug('Unhandled payment event', { type });
        }
      } catch (error) {
        logger.error(`Error handling payment event ${type}`, { error, eventId: event.eventId });
      }
    });
  },
};

// ═══════════════════════════════════════════════════════════════════
// Payment Event Handlers
// ═══════════════════════════════════════════════════════════════════

async function handlePaymentCompleted(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, userId, tenantId } = event as IntegrationEvent<PaymentEventData>;

  logger.info('Handling payment.completed event', { userId, amount: data.amount });

  await notificationService.sendMultiChannel(
    {
      tenantId: tenantId!,
      priority: 'high',
      to: userId!,
      subject: 'Payment Confirmed',
      body: `Your payment of ${data.amount} ${data.currency} has been completed.`,
      html: `<p>Your payment of <strong>${data.amount} ${data.currency}</strong> has been completed.</p>`,
    },
    ['email', 'socket']
  );
}

async function handlePaymentFailed(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, userId, tenantId } = event as IntegrationEvent<PaymentEventData>;

  logger.info('Handling payment.failed event', { userId });

  await notificationService.sendMultiChannel(
    {
      tenantId: tenantId!,
      priority: 'high',
      to: userId!,
      subject: 'Payment Failed',
      body: `Your payment failed: ${data.reason}`,
      html: `<p><strong>Payment Failed:</strong> ${data.reason}</p>`,
    },
    ['email', 'socket']
  );
}

async function handlePaymentRefunded(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, userId, tenantId } = event as IntegrationEvent<PaymentEventData>;

  logger.info('Handling payment.refunded event', { userId });

  await notificationService.send({
    tenantId: tenantId!,
    channel: 'email',
    priority: 'normal',
    to: userId!,
    subject: 'Payment Refunded',
    body: `Your payment of ${data.amount} ${data.currency} has been refunded.`,
    html: `<p>Your payment of <strong>${data.amount} ${data.currency}</strong> has been refunded.</p>`,
  });
}
