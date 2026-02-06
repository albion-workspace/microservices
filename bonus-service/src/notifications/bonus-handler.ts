/**
 * Bonus Service Notification Handler
 *
 * Handles bonus-related events and sends notifications.
 * Uses NotificationHandlerPlugin and HandlerContext from core-service.
 */

import { logger, on } from 'core-service';
import type { IntegrationEvent, NotificationHandlerPlugin, HandlerContext } from 'core-service';

// ═══════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════

interface BonusEventData {
  type: string;
  userId?: string;
  tenantId?: string;
  amount?: number;
  currency?: string;
  bonusId?: string;
  [key: string]: any;
}

export const bonusNotificationHandler: NotificationHandlerPlugin = {
  name: 'bonus',
  description: 'Handles bonus events (credited, expired, wagering completed)',
  channels: ['integration:bonus'],
  eventTypes: [
    'bonus.credited',
    'bonus.expired',
    'bonus.wagering_completed',
  ],

  isAvailable(): boolean {
    // Check if bonus service integration is available
    return true;
  },

  initialize(notificationService: any): void {
    logger.info('Initializing bonus notification handlers');

    on<BonusEventData>('integration:bonus', async (event) => {
      const { eventType, data, userId, tenantId } = event as IntegrationEvent<BonusEventData>;
      const type = eventType || (data as any).type;

      const context: HandlerContext = {
        notificationService,
        event,
        logger: logger as HandlerContext['logger'],
      };

      try {
        switch (type) {
          case 'bonus.credited':
            await handleBonusCredited(context);
            break;

          case 'bonus.expired':
            await handleBonusExpired(context);
            break;

          case 'bonus.wagering_completed':
            await handleWageringCompleted(context);
            break;

          default:
            logger.debug('Unhandled bonus event', { type });
        }
      } catch (error) {
        logger.error(`Error handling bonus event ${type}`, { error, eventId: event.eventId });
      }
    });
  },
};

// ═══════════════════════════════════════════════════════════════════
// Bonus Event Handlers
// ═══════════════════════════════════════════════════════════════════

async function handleBonusCredited(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, userId, tenantId } = event as IntegrationEvent<BonusEventData>;

  logger.info('Handling bonus.credited event', { userId, amount: data.amount });

  await notificationService.sendMultiChannel(
    {
      tenantId: tenantId!,
      priority: 'normal',
      to: userId!,
      subject: 'Bonus Credited!',
      body: `You've received a bonus of ${data.amount} ${data.currency}!`,
      html: `<p>🎉 You've received a bonus of <strong>${data.amount} ${data.currency}</strong>!</p>`,
    },
    ['email', 'socket']
  );
}

async function handleBonusExpired(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, userId, tenantId } = event as IntegrationEvent<BonusEventData>;

  logger.info('Handling bonus.expired event', { userId });

  await notificationService.send({
    tenantId: tenantId!,
    channel: 'socket',
    priority: 'low',
    to: userId!,
    body: JSON.stringify({
      type: 'bonus_expired',
      bonusId: data.bonusId,
    }),
  });
}

async function handleWageringCompleted(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, userId, tenantId } = event as IntegrationEvent<BonusEventData>;

  logger.info('Handling bonus.wagering_completed event', { userId });

  await notificationService.sendMultiChannel(
    {
      tenantId: tenantId!,
      priority: 'high',
      to: userId!,
      subject: 'Wagering Requirements Completed!',
      body: `Congratulations! You've completed the wagering requirements for your bonus.`,
      html: `<p>🎉 <strong>Congratulations!</strong> You've completed the wagering requirements.</p>`,
    },
    ['email', 'socket']
  );
}
