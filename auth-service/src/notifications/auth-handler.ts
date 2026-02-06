/**
 * Auth Service Notification Handler
 *
 * Handles authentication-related events and sends notifications.
 * Uses NotificationHandlerPlugin and HandlerContext from core-service.
 */

import { logger, on } from 'core-service';
import type { IntegrationEvent, NotificationHandlerPlugin, HandlerContext } from 'core-service';

// ═══════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════

interface AuthEventData {
  type: string;
  userId?: string;
  tenantId?: string;
  email?: string;
  username?: string;
  phone?: string;
  [key: string]: any;
}

export const authNotificationHandler: NotificationHandlerPlugin = {
  name: 'auth',
  description: 'Handles authentication events (user registration, password changes, 2FA, etc.)',
  channels: ['integration:auth'],
  eventTypes: [
    'user.registered',
    'user.email_verified',
    'user.password_changed',
    'user.password_reset',
    'user.2fa_enabled',
    'user.locked',
  ],

  isAvailable(): boolean {
    // Auth handler is always available (core functionality)
    return true;
  },

  initialize(notificationService: any): void {
    logger.info('Initializing auth notification handlers');

    on<AuthEventData>('integration:auth', async (event) => {
      const { eventType, data, userId, tenantId } = event as IntegrationEvent<AuthEventData>;
      const type = eventType || (data as any).type;

      const context: HandlerContext = {
        notificationService,
        event,
        logger: logger as HandlerContext['logger'],
      };

      try {
        switch (type) {
          case 'user.registered':
            await handleUserRegistered(context);
            break;

          case 'user.email_verified':
            await handleEmailVerified(context);
            break;

          case 'user.password_changed':
            await handlePasswordChanged(context);
            break;

          case 'user.password_reset':
            await handlePasswordReset(context);
            break;

          case 'user.2fa_enabled':
            await handle2FAEnabled(context);
            break;

          case 'user.locked':
            await handleAccountLocked(context);
            break;

          default:
            logger.debug('Unhandled auth event', { type });
        }
      } catch (error) {
        logger.error(`Error handling auth event ${type}`, { error, eventId: event.eventId });
      }
    });
  },
};

// ═══════════════════════════════════════════════════════════════════
// Auth Event Handlers
// ═══════════════════════════════════════════════════════════════════

async function handleUserRegistered(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, userId, tenantId } = event as IntegrationEvent<AuthEventData>;

  logger.info('Handling user.registered event', { userId });

  // Send welcome email
  if (data.email) {
    await notificationService.send({
      tenantId: tenantId!,
      channel: 'email',
      priority: 'normal',
      to: data.email,
      subject: 'Welcome! Your account has been created',
      body: `Welcome ${data.username || data.email}!\n\nYour account has been successfully created.`,
      html: `<h2>Welcome!</h2><p>Your account has been successfully created.</p>`,
    });
  }

  // Send real-time notification
  await notificationService.send({
    tenantId: tenantId!,
    channel: 'socket',
    priority: 'normal',
    to: userId!,
    body: JSON.stringify({
      userId,
      event: 'user_registered',
      data,
    }),
  });
}

async function handleEmailVerified(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, tenantId } = event as IntegrationEvent<AuthEventData>;

  logger.info('Handling user.email_verified event', { userId: event.userId });

  if (data.email) {
    await notificationService.send({
      tenantId: tenantId!,
      channel: 'email',
      priority: 'normal',
      to: data.email,
      subject: 'Email verified successfully',
      body: 'Your email has been verified!',
      html: '<p>Your email has been verified successfully!</p>',
    });
  }
}

async function handlePasswordChanged(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, tenantId } = event as IntegrationEvent<AuthEventData>;

  logger.info('Handling user.password_changed event', { userId: event.userId });

  if (data.email) {
    await notificationService.sendMultiChannel(
      {
        tenantId: tenantId!,
        priority: 'high',
        to: data.email,
        subject: 'Security Alert: Password Changed',
        body: 'Your password was recently changed. If this wasn\'t you, contact support immediately.',
        html: '<p><strong>Security Alert:</strong> Your password was changed.</p>',
      },
      ['email', 'socket']
    );
  }
}

async function handlePasswordReset(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, tenantId } = event as IntegrationEvent<AuthEventData>;

  logger.info('Handling user.password_reset event', { userId: event.userId });

  if (data.email) {
    await notificationService.send({
      tenantId: tenantId!,
      channel: 'email',
      priority: 'high',
      to: data.email,
      subject: 'Password Reset Request',
      body: `Click the link to reset your password: ${data.resetLink}`,
      html: `<p>Click <a href="${data.resetLink}">here</a> to reset your password.</p>`,
    });
  }
}

async function handle2FAEnabled(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, tenantId } = event as IntegrationEvent<AuthEventData>;

  logger.info('Handling user.2fa_enabled event', { userId: event.userId });

  if (data.email) {
    await notificationService.send({
      tenantId: tenantId!,
      channel: 'email',
      priority: 'high',
      to: data.email,
      subject: 'Two-Factor Authentication Enabled',
      body: 'Two-factor authentication has been enabled on your account.',
      html: '<p><strong>Security Update:</strong> Two-factor authentication enabled.</p>',
    });
  }
}

async function handleAccountLocked(context: HandlerContext) {
  const { notificationService, event } = context;
  const { data, tenantId } = event as IntegrationEvent<AuthEventData>;

  logger.info('Handling user.locked event', { userId: event.userId });

  if (data.email) {
    await notificationService.sendMultiChannel(
      {
        tenantId: tenantId!,
        priority: 'urgent',
        to: data.email,
        subject: 'Security Alert: Account Locked',
        body: `Your account has been locked due to ${data.reason || 'multiple failed login attempts'}.`,
        html: `<p><strong>Security Alert:</strong> Your account has been locked.</p>`,
      },
      ['email', 'sms', 'socket']
    );
  }
}
