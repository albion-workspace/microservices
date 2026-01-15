/**
 * Event Handlers - Listen to Redis events from other services
 * 
 * Handles events from:
 * - Auth Service (user.*, session.*)
 * - Payment Service (payment.*, transaction.*)
 * - Bonus Service (bonus.*, wagering.*)
 * - System events
 */

import { logger, on } from 'core-service';
import type { IntegrationEvent } from 'core-service';
import type { NotificationService } from './notification-service.js';
import type { NotificationChannel } from './types.js';

interface AuthEventData {
  type: string;
  userId?: string;
  tenantId?: string;
  email?: string;
  username?: string;
  phone?: string;
  [key: string]: any;
}

export function setupEventHandlers(notificationService: NotificationService) {
  logger.info('Setting up notification event handlers');
  
  // ═══════════════════════════════════════════════════════════════════
  // Auth Service Events
  // ═══════════════════════════════════════════════════════════════════
  
  on<AuthEventData>('integration:auth', async (event) => {
    const { eventType, data, userId, tenantId } = event as IntegrationEvent<AuthEventData>;
    const type = eventType || (data as any).type;
    
    switch (type) {
      case 'user.registered':
        await handleUserRegistered(notificationService, data, userId!, tenantId);
        break;
        
      case 'user.email_verified':
        await handleEmailVerified(notificationService, data, userId!, tenantId);
        break;
        
      case 'user.password_changed':
        await handlePasswordChanged(notificationService, data, userId!, tenantId);
        break;
        
      case 'user.password_reset':
        await handlePasswordReset(notificationService, data, userId!, tenantId);
        break;
        
      case 'user.2fa_enabled':
        await handle2FAEnabled(notificationService, data, userId!, tenantId);
        break;
        
      case 'user.locked':
        await handleAccountLocked(notificationService, data, userId!, tenantId);
        break;
        
      default:
        logger.debug('Unhandled auth event', { type });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Payment Service Events
  // ═══════════════════════════════════════════════════════════════════
  
  on<AuthEventData>('integration:payment', async (event) => {
    const { eventType, data, userId, tenantId } = event as IntegrationEvent<AuthEventData>;
    const type = eventType || (data as any).type;
    
    switch (type) {
      case 'payment.completed':
        await handlePaymentCompleted(notificationService, data, userId!, tenantId);
        break;
        
      case 'payment.failed':
        await handlePaymentFailed(notificationService, data, userId!, tenantId);
        break;
        
      case 'payment.refunded':
        await handlePaymentRefunded(notificationService, data, userId!, tenantId);
        break;
        
      default:
        logger.debug('Unhandled payment event', { type });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════
  // Bonus Service Events
  // ═══════════════════════════════════════════════════════════════════
  
  on<AuthEventData>('integration:bonus', async (event) => {
    const { eventType, data, userId, tenantId } = event as IntegrationEvent<AuthEventData>;
    const type = eventType || (data as any).type;
    
    switch (type) {
      case 'bonus.credited':
        await handleBonusCredited(notificationService, data, userId!, tenantId);
        break;
        
      case 'bonus.expired':
        await handleBonusExpired(notificationService, data, userId!, tenantId);
        break;
        
      case 'bonus.wagering_completed':
        await handleWageringCompleted(notificationService, data, userId!, tenantId);
        break;
        
      default:
        logger.debug('Unhandled bonus event', { type });
    }
  });
  
  logger.info('Event handlers registered', {
    channels: ['integration:auth', 'integration:payment', 'integration:bonus'],
  });
}

// ═══════════════════════════════════════════════════════════════════
// Auth Event Handlers
// ═══════════════════════════════════════════════════════════════════

async function handleUserRegistered(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling user.registered event', { userId });
  
  // Send welcome email
  if (data.email) {
    await service.send({
      tenantId,
      channel: 'email',
      priority: 'normal',
      to: data.email,
      subject: 'Welcome! Your account has been created',
      body: `Welcome ${data.username || data.email}!\n\nYour account has been successfully created.`,
      html: `<h2>Welcome!</h2><p>Your account has been successfully created.</p>`,
    });
  }
  
  // Send real-time notification
  await service.send({
    tenantId,
    channel: 'socket',
    priority: 'normal',
    to: userId,
    body: JSON.stringify({
      userId,
      event: 'user_registered',
      data,
    }),
  });
}

async function handleEmailVerified(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling user.email_verified event', { userId });
  
  await service.send({
    tenantId,
    channel: 'email',
    priority: 'normal',
    to: data.email,
    subject: 'Email verified successfully',
    body: 'Your email has been verified!',
    html: '<p>Your email has been verified successfully!</p>',
  });
}

async function handlePasswordChanged(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling user.password_changed event', { userId });
  
  if (data.email) {
    await service.sendMultiChannel(
      {
        tenantId,
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

async function handlePasswordReset(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling user.password_reset event', { userId });
  
  if (data.email) {
    await service.send({
      tenantId,
      channel: 'email',
      priority: 'high',
      to: data.email,
      subject: 'Password Reset Request',
      body: `Click the link to reset your password: ${data.resetLink}`,
      html: `<p>Click <a href="${data.resetLink}">here</a> to reset your password.</p>`,
    });
  }
}

async function handle2FAEnabled(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling user.2fa_enabled event', { userId });
  
  if (data.email) {
    await service.send({
      tenantId,
      channel: 'email',
      priority: 'high',
      to: data.email,
      subject: 'Two-Factor Authentication Enabled',
      body: 'Two-factor authentication has been enabled on your account.',
      html: '<p><strong>Security Update:</strong> Two-factor authentication enabled.</p>',
    });
  }
}

async function handleAccountLocked(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling user.locked event', { userId });
  
  if (data.email) {
    await service.sendMultiChannel(
      {
        tenantId,
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

// ═══════════════════════════════════════════════════════════════════
// Payment Event Handlers
// ═══════════════════════════════════════════════════════════════════

async function handlePaymentCompleted(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling payment.completed event', { userId, amount: data.amount });
  
  await service.sendMultiChannel(
    {
      tenantId,
      priority: 'high',
      to: userId,
      subject: 'Payment Confirmed',
      body: `Your payment of ${data.amount} ${data.currency} has been completed.`,
      html: `<p>Your payment of <strong>${data.amount} ${data.currency}</strong> has been completed.</p>`,
    },
    ['email', 'socket']
  );
}

async function handlePaymentFailed(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling payment.failed event', { userId });
  
  await service.sendMultiChannel(
    {
      tenantId,
      priority: 'high',
      to: userId,
      subject: 'Payment Failed',
      body: `Your payment failed: ${data.reason}`,
      html: `<p><strong>Payment Failed:</strong> ${data.reason}</p>`,
    },
    ['email', 'socket']
  );
}

async function handlePaymentRefunded(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling payment.refunded event', { userId });
  
  await service.send({
    tenantId,
    channel: 'email',
    priority: 'normal',
    to: userId,
    subject: 'Payment Refunded',
    body: `Your payment of ${data.amount} ${data.currency} has been refunded.`,
    html: `<p>Your payment of <strong>${data.amount} ${data.currency}</strong> has been refunded.</p>`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// Bonus Event Handlers
// ═══════════════════════════════════════════════════════════════════

async function handleBonusCredited(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling bonus.credited event', { userId, amount: data.amount });
  
  await service.sendMultiChannel(
    {
      tenantId,
      priority: 'normal',
      to: userId,
      subject: 'Bonus Credited!',
      body: `You've received a bonus of ${data.amount} ${data.currency}!`,
      html: `<p>🎉 You've received a bonus of <strong>${data.amount} ${data.currency}</strong>!</p>`,
    },
    ['email', 'socket']
  );
}

async function handleBonusExpired(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling bonus.expired event', { userId });
  
  await service.send({
    tenantId,
    channel: 'socket',
    priority: 'low',
    to: userId,
    body: JSON.stringify({
      type: 'bonus_expired',
      bonusId: data.bonusId,
    }),
  });
}

async function handleWageringCompleted(
  service: NotificationService,
  data: any,
  userId: string,
  tenantId: string
) {
  logger.info('Handling bonus.wagering_completed event', { userId });
  
  await service.sendMultiChannel(
    {
      tenantId,
      priority: 'high',
      to: userId,
      subject: 'Wagering Requirements Completed!',
      body: `Congratulations! You've completed the wagering requirements for your bonus.`,
      html: `<p>🎉 <strong>Congratulations!</strong> You've completed the wagering requirements.</p>`,
    },
    ['email', 'socket']
  );
}
