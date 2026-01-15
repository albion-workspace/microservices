/**
 * Notification Service Types
 */

export type NotificationChannel = 
  | 'email' 
  | 'sms' 
  | 'whatsapp' 
  | 'push'
  | 'sse'
  | 'socket';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationStatus = 
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced';

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: NotificationChannel;
  subject?: string; // For email
  body: string; // Template with {{variables}}
  variables: string[]; // List of required variables
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRequest {
  id?: string;
  userId?: string;
  tenantId: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  
  // Recipients
  to: string | string[]; // email/phone/userId
  cc?: string[];
  bcc?: string[];
  
  // Content
  subject?: string;
  body: string;
  html?: string;
  
  // Template
  templateId?: string;
  variables?: Record<string, any>;
  
  // Options
  sendAt?: Date; // Scheduled sending
  expiresAt?: Date;
  metadata?: Record<string, any>;
  
  // Tracking
  webhookUrl?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
}

export interface NotificationResponse {
  id: string;
  status: NotificationStatus;
  channel: NotificationChannel;
  sentAt?: Date;
  deliveredAt?: Date;
  error?: string;
  providerMessageId?: string;
  metadata?: Record<string, any>;
}

export interface EmailNotification {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content?: Buffer | string;
    path?: string;
    contentType?: string;
  }>;
}

export interface SmsNotification {
  to: string | string[]; // Phone numbers
  body: string;
  from?: string;
  mediaUrl?: string[]; // For MMS
}

export interface WhatsAppNotification {
  to: string | string[];
  body: string;
  mediaUrl?: string;
}

export interface PushNotification {
  to: string | string[]; // User IDs or device tokens
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: string;
  icon?: string;
  image?: string;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

export interface SseNotification {
  userId: string;
  event: string;
  data: any;
}

export interface SocketNotification {
  userId?: string | string[];
  room?: string;
  event: string;
  data: any;
}

export interface NotificationProvider {
  name: string;
  channel: NotificationChannel;
  send(notification: any): Promise<NotificationResponse>;
  isConfigured(): boolean;
}

export interface NotificationConfig {
  // Service
  port: number;
  nodeEnv: string;
  
  // Database
  mongoUri: string;
  redisUrl?: string;
  
  // SMTP (Email)
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom: string;
  smtpSecure?: boolean;
  
  // Twilio (SMS/WhatsApp)
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  twilioWhatsAppNumber?: string;
  
  // Push Notifications
  pushProviderApiKey?: string;
  pushProviderProjectId?: string;
  
  // Queue
  queueConcurrency: number;
  queueMaxRetries: number;
  queueRetryDelay: number;
  
  // Real-time
  sseHeartbeatInterval: number;
  socketNamespace: string;
}

export interface NotificationEvent {
  type: 'user' | 'payment' | 'bonus' | 'system';
  action: string;
  data: any;
  userId?: string;
  tenantId: string;
  metadata?: Record<string, any>;
}

// Event types from other services
export type UserEvent = 
  | 'user.registered'
  | 'user.login'
  | 'user.email_verified'
  | 'user.password_changed'
  | 'user.2fa_enabled';

export type PaymentEvent =
  | 'payment.created'
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.refunded';

export type BonusEvent =
  | 'bonus.credited'
  | 'bonus.expired'
  | 'bonus.wagering_completed';

export type SystemEvent =
  | 'system.maintenance'
  | 'system.alert';
