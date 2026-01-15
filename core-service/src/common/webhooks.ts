/**
 * Webhook Engine
 * 
 * Generic webhook infrastructure for outbound HTTP webhooks.
 * This module is service-agnostic - services define their own event types.
 * 
 * Best Practices Implemented:
 * - HMAC-SHA256 signature verification
 * - Exponential backoff retry (max 5 attempts)
 * - Idempotency via event IDs
 * - Delivery logging for debugging
 * - Auto-disable after consecutive failures
 * - Timeout handling
 * 
 * Usage in your service:
 * 
 *   // 1. Define your service's event types
 *   type BonusEvents = 'bonus.awarded' | 'bonus.converted' | 'bonus.*';
 * 
 *   // 2. Create a typed webhook manager
 *   const webhooks = createWebhookManager<BonusEvents>({
 *     serviceName: 'bonus',  // Uses bonus_webhooks collection
 *   });
 * 
 *   // 3. Register webhooks via your API
 *   await webhooks.register({
 *     tenantId: 'tenant-1',
 *     name: 'Bonus notifications',
 *     url: 'https://api.example.com/webhook',
 *     secret: 'my-secret-key',
 *     events: ['bonus.awarded'],
 *   });
 * 
 *   // 4. Dispatch webhooks when events occur
 *   await webhooks.dispatch({
 *     eventType: 'bonus.awarded',
 *     tenantId,
 *     userId,
 *     data: { bonusId, amount },
 *   });
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface WebhookConfig {
  id: string;
  /** Tenant this webhook belongs to */
  tenantId: string;
  /** Display name for the webhook */
  name: string;
  /** Target URL to send webhooks to */
  url: string;
  /** Secret key for HMAC signing (stored hashed or encrypted in production) */
  secret: string;
  /** Event types this webhook subscribes to (supports wildcards like 'bonus.*') */
  events: string[];
  /** Is this webhook active? */
  isActive: boolean;
  /** Custom HTTP headers to include */
  headers?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Max retry attempts (default: 5) */
  maxRetries?: number;
  /** Metadata */
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  /** Last successful delivery */
  lastDeliveryAt?: Date;
  /** Last delivery status */
  lastDeliveryStatus?: 'success' | 'failed';
  /** Failure count (resets on success) */
  consecutiveFailures: number;
  /** Disabled if too many failures */
  disabledReason?: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  /** HTTP status code received */
  statusCode?: number;
  /** Response body (truncated) */
  responseBody?: string;
  /** Delivery status */
  status: 'pending' | 'success' | 'failed' | 'retrying';
  /** Number of attempts made */
  attempts: number;
  /** Error message if failed */
  error?: string;
  /** Time taken for delivery (ms) */
  duration?: number;
  /** Timestamps */
  createdAt: Date;
  deliveredAt?: Date;
  nextRetryAt?: Date;
}

export interface WebhookPayload<T = unknown> {
  /** Unique event ID (for idempotency) */
  id: string;
  /** Event type */
  type: string;
  /** ISO timestamp */
  timestamp: string;
  /** Tenant ID */
  tenantId: string;
  /** User who triggered the event */
  userId?: string;
  /** Event-specific data */
  data: T;
  /** API version */
  apiVersion: string;
}

export interface RegisterWebhookInput {
  tenantId: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  headers?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  description?: string;
}

export interface WebhookStats {
  total: number;
  active: number;
  disabled: number;
  deliveriesLast24h: number;
  successRate: number;
}

export interface WebhookDispatchInput<T = unknown> {
  eventType: string;
  tenantId: string;
  userId?: string;
  data: T;
  correlationId?: string;
}

export interface WebhookManagerConfig {
  /** Service name - used to namespace collections (e.g., 'bonus' -> 'bonus_webhooks') */
  serviceName: string;
  /** API version to include in payloads (default: '2024-01-01') */
  apiVersion?: string;
  /** Default timeout in milliseconds (default: 30000) */
  defaultTimeout?: number;
  /** Default max retries (default: 5) */
  defaultMaxRetries?: number;
  /** Max consecutive failures before auto-disable (default: 10) */
  maxConsecutiveFailures?: number;
  /** Retry delays in milliseconds (default: [1s, 5s, 30s, 2m, 10m]) */
  retryDelays?: number[];
  /** Signature verification tolerance in milliseconds (default: 300000 = 5min) */
  signatureToleranceMs?: number;
  /** HTTP signature header name (default: 'X-Webhook-Signature') */
  signatureHeader?: string;
  /** HTTP timestamp header name (default: 'X-Webhook-Timestamp') */
  timestampHeader?: string;
  /** HTTP event ID header name (default: 'X-Webhook-ID') */
  idHeader?: string;
  /** Max response body length to store (default: 1000) */
  maxResponseBodyLength?: number;
  /** User-Agent header (default: 'Webhooks/1.0') */
  userAgent?: string;
}

export interface WebhookTestResult {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Default Configuration
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG = {
  apiVersion: '2024-01-01',
  defaultTimeout: 30000,
  defaultMaxRetries: 5,
  maxConsecutiveFailures: 10,
  retryDelays: [1000, 5000, 30000, 120000, 600000], // 1s, 5s, 30s, 2m, 10m
  signatureToleranceMs: 300000, // 5 minutes
  signatureHeader: 'X-Webhook-Signature',
  timestampHeader: 'X-Webhook-Timestamp',
  idHeader: 'X-Webhook-ID',
  maxResponseBodyLength: 1000,
  userAgent: 'Webhooks/1.0',
};

// ═══════════════════════════════════════════════════════════════════
// Signature Generation & Verification (exported for use by receivers)
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 * Format: t={timestamp},v1={signature}
 */
export function generateSignature(
  payload: string,
  secret: string,
  timestamp: number = Date.now()
): string {
  if (!secret || typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Webhook secret is required for HMAC signature generation');
  }
  try {
    const signedPayload = `${timestamp}.${payload}`;
    const signature = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  } catch (error) {
    logger.error('HMAC signature generation failed', { 
      error: error instanceof Error ? error.message : String(error),
      secretLength: secret.length,
      payloadLength: payload.length 
    });
    throw new Error(`Failed to generate HMAC signature: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify webhook signature (for receivers).
 * Use this in your webhook endpoint to verify authenticity.
 * 
 * @example
 * app.post('/webhook', (req, res) => {
 *   const signature = req.headers['x-webhook-signature'];
 *   const isValid = verifySignature(req.body, signature, webhookSecret);
 *   if (!isValid) return res.status(401).send('Invalid signature');
 *   // Process webhook...
 * });
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string,
  toleranceMs: number = 300000 // 5 minutes
): boolean {
  try {
    const parts = signature.split(',');
    const timestampPart = parts.find(p => p.startsWith('t='));
    const signaturePart = parts.find(p => p.startsWith('v1='));
    
    if (!timestampPart || !signaturePart) return false;
    
    const timestamp = parseInt(timestampPart.substring(2), 10);
    const receivedSig = signaturePart.substring(3);
    
    // Check timestamp tolerance (prevent replay attacks)
    const now = Date.now();
    if (Math.abs(now - timestamp) > toleranceMs) {
      return false;
    }
    
    // Verify signature
    const expectedSig = createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    
    // Use timing-safe comparison
    const receivedBuffer = Buffer.from(receivedSig, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');
    
    if (receivedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Webhook Manager Class
// ═══════════════════════════════════════════════════════════════════

/**
 * WebhookManager - Service-specific webhook management
 * 
 * Each service creates its own instance with typed events.
 * Uses separate MongoDB collections per service.
 */
export class WebhookManager<TEvents extends string = string> {
  private config: Required<WebhookManagerConfig>;
  private enabled = false;

  constructor(config: WebhookManagerConfig) {
    this.config = {
      serviceName: config.serviceName,
      apiVersion: config.apiVersion ?? DEFAULT_CONFIG.apiVersion,
      defaultTimeout: config.defaultTimeout ?? DEFAULT_CONFIG.defaultTimeout,
      defaultMaxRetries: config.defaultMaxRetries ?? DEFAULT_CONFIG.defaultMaxRetries,
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? DEFAULT_CONFIG.maxConsecutiveFailures,
      retryDelays: config.retryDelays ?? DEFAULT_CONFIG.retryDelays,
      signatureToleranceMs: config.signatureToleranceMs ?? DEFAULT_CONFIG.signatureToleranceMs,
      signatureHeader: config.signatureHeader ?? DEFAULT_CONFIG.signatureHeader,
      timestampHeader: config.timestampHeader ?? DEFAULT_CONFIG.timestampHeader,
      idHeader: config.idHeader ?? DEFAULT_CONFIG.idHeader,
      maxResponseBodyLength: config.maxResponseBodyLength ?? DEFAULT_CONFIG.maxResponseBodyLength,
      userAgent: config.userAgent ?? DEFAULT_CONFIG.userAgent,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Collection Access (service-namespaced)
  // ─────────────────────────────────────────────────────────────────

  private getWebhooksCollection() {
    return getDatabase().collection<WebhookConfig>(`${this.config.serviceName}_webhooks`);
  }

  private getDeliveriesCollection() {
    return getDatabase().collection<WebhookDelivery>(`${this.config.serviceName}_webhook_deliveries`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────

  /**
   * Initialize webhook system (call at service startup).
   * Creates indexes and enables webhook dispatching.
   */
  async initialize(): Promise<void> {
    await this.createIndexes();
    this.enabled = true;
    logger.info(`Webhook manager initialized for ${this.config.serviceName}`);
  }

  /**
   * Enable webhook dispatching.
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable webhook dispatching.
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if webhooks are enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ─────────────────────────────────────────────────────────────────
  // Registration
  // ─────────────────────────────────────────────────────────────────

  /**
   * Register a new webhook endpoint.
   */
  async register(input: Omit<RegisterWebhookInput, 'events'> & { events: TEvents[] }): Promise<WebhookConfig> {
    const webhook: WebhookConfig = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      name: input.name,
      url: input.url,
      secret: input.secret,
      events: input.events,
      isActive: true,
      headers: input.headers,
      timeout: input.timeout ?? this.config.defaultTimeout,
      maxRetries: input.maxRetries ?? this.config.defaultMaxRetries,
      description: input.description,
      createdAt: new Date(),
      updatedAt: new Date(),
      consecutiveFailures: 0,
    };
    
    await this.getWebhooksCollection().insertOne(webhook as any);
    
    logger.info('Webhook registered', { 
      service: this.config.serviceName,
      webhookId: webhook.id, 
      tenantId: webhook.tenantId,
      url: webhook.url,
      events: webhook.events,
    });
    
    return webhook;
  }

  /**
   * Update a webhook configuration.
   */
  async update(
    id: string,
    tenantId: string,
    updates: Partial<Pick<WebhookConfig, 'name' | 'url' | 'secret' | 'events' | 'headers' | 'timeout' | 'maxRetries' | 'description' | 'isActive'>>
  ): Promise<WebhookConfig | null> {
    const result = await this.getWebhooksCollection().findOneAndUpdate(
      { id, tenantId },
      { 
        $set: { 
          ...updates, 
          updatedAt: new Date(),
          ...(updates.isActive === true && { consecutiveFailures: 0, disabledReason: undefined }),
        } 
      },
      { returnDocument: 'after' }
    );
    
    return result as WebhookConfig | null;
  }

  /**
   * Delete a webhook.
   */
  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await this.getWebhooksCollection().deleteOne({ id, tenantId });
    return result.deletedCount > 0;
  }

  /**
   * Get a webhook by ID.
   */
  async get(id: string, tenantId: string): Promise<WebhookConfig | null> {
    const result = await this.getWebhooksCollection().findOne({ id, tenantId }) as WebhookConfig | null;
    if (!result) {
      logger.debug(`Webhook not found: id=${id}, tenantId=${tenantId}, service=${this.config.serviceName}, collection=${this.config.serviceName}_webhooks`);
    }
    return result;
  }

  /**
   * List webhooks for a tenant.
   */
  async list(
    tenantId: string,
    options: { includeInactive?: boolean } = {}
  ): Promise<WebhookConfig[]> {
    const filter: any = { tenantId };
    if (!options.includeInactive) {
      filter.isActive = true;
    }
    return await this.getWebhooksCollection().find(filter).toArray() as WebhookConfig[];
  }

  // ─────────────────────────────────────────────────────────────────
  // Dispatch
  // ─────────────────────────────────────────────────────────────────

  /**
   * Dispatch webhooks for an event.
   * Finds all matching webhooks and delivers to each.
   */
  async dispatch<T>(input: WebhookDispatchInput<T>): Promise<WebhookDelivery[]> {
    if (!this.enabled) return [];

    const webhooks = await this.findMatching(input.tenantId, input.eventType);
    
    if (webhooks.length === 0) return [];

    const eventId = crypto.randomUUID();
    const deliveries: WebhookDelivery[] = [];

    for (const webhook of webhooks) {
      const delivery = await this.deliver(webhook, {
        eventId,
        eventType: input.eventType,
        tenantId: input.tenantId,
        userId: input.userId,
        data: input.data,
      });
      deliveries.push(delivery);
    }

    return deliveries;
  }

  /**
   * Find webhooks that match an event type.
   */
  private async findMatching(tenantId: string, eventType: string): Promise<WebhookConfig[]> {
    const webhooks = await this.list(tenantId);
    
    return webhooks.filter(webhook => {
      if (!webhook.isActive) return false;
      if (webhook.consecutiveFailures >= this.config.maxConsecutiveFailures) return false;
      
      return webhook.events.some(pattern => this.matchPattern(pattern, eventType));
    });
  }

  private matchPattern(pattern: string, eventType: string): boolean {
    if (pattern === eventType) return true;
    
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(eventType);
    }
    
    return false;
  }

  /**
   * Deliver to a specific webhook with retries.
   */
  private async deliver<T>(
    webhook: WebhookConfig,
    event: { eventId: string; eventType: string; tenantId: string; userId?: string; data: T }
  ): Promise<WebhookDelivery> {
    const delivery: WebhookDelivery = {
      id: crypto.randomUUID(),
      webhookId: webhook.id,
      tenantId: webhook.tenantId,
      eventId: event.eventId,
      eventType: event.eventType,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
    };

    const payload: WebhookPayload<T> = {
      id: event.eventId,
      type: event.eventType,
      timestamp: new Date().toISOString(),
      tenantId: event.tenantId,
      userId: event.userId,
      data: event.data,
      apiVersion: this.config.apiVersion,
    };

    const payloadJson = JSON.stringify(payload);
    const timestamp = Date.now();
    
    // Validate secret before HMAC generation
    if (!webhook.secret || typeof webhook.secret !== 'string' || webhook.secret.length === 0) {
      logger.error('Webhook secret is missing or invalid', {
        service: this.config.serviceName,
        webhookId: webhook.id,
        tenantId: webhook.tenantId,
        secretType: typeof webhook.secret,
        secretLength: webhook.secret?.length ?? 0,
      });
      throw new Error('Webhook secret is required for delivery');
    }
    
    let signature: string;
    try {
      signature = generateSignature(payloadJson, webhook.secret, timestamp);
    } catch (error) {
      logger.error('Failed to generate HMAC signature for webhook delivery', {
        service: this.config.serviceName,
        webhookId: webhook.id,
        tenantId: webhook.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const maxAttempts = webhook.maxRetries ?? this.config.defaultMaxRetries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      delivery.attempts = attempt;

      try {
        const startTime = Date.now();

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': DEFAULT_CONFIG.userAgent,
            [DEFAULT_CONFIG.signatureHeader]: signature,
            [DEFAULT_CONFIG.timestampHeader]: String(timestamp),
            [DEFAULT_CONFIG.idHeader]: event.eventId,
            ...webhook.headers,
          },
          body: payloadJson,
          signal: AbortSignal.timeout(webhook.timeout ?? this.config.defaultTimeout),
        });

        delivery.duration = Date.now() - startTime;
        delivery.statusCode = response.status;

        try {
          const responseText = await response.text();
          delivery.responseBody = responseText.substring(0, DEFAULT_CONFIG.maxResponseBodyLength);
        } catch {
          // Ignore response body errors
        }

        if (response.ok) {
          delivery.status = 'success';
          delivery.deliveredAt = new Date();

          await this.getWebhooksCollection().updateOne(
            { id: webhook.id },
            { 
              $set: { 
                lastDeliveryAt: new Date(),
                lastDeliveryStatus: 'success',
                consecutiveFailures: 0,
              } 
            }
          );

          logger.debug('Webhook delivered', {
            service: this.config.serviceName,
            webhookId: webhook.id,
            eventType: event.eventType,
            statusCode: response.status,
            duration: delivery.duration,
          });

          break;
        } else {
          delivery.status = 'retrying';
          delivery.error = `HTTP ${response.status}`;

          logger.warn('Webhook delivery failed, will retry', {
            service: this.config.serviceName,
            webhookId: webhook.id,
            eventType: event.eventType,
            statusCode: response.status,
            attempt,
            maxAttempts,
          });
        }
      } catch (error) {
        delivery.status = 'retrying';
        delivery.error = error instanceof Error ? error.message : 'Unknown error';

        logger.warn('Webhook delivery error, will retry', {
          service: this.config.serviceName,
          webhookId: webhook.id,
          eventType: event.eventType,
          error: delivery.error,
          attempt,
          maxAttempts,
        });
      }

      if (attempt < maxAttempts) {
        const delay = this.config.retryDelays[attempt - 1] ?? this.config.retryDelays[this.config.retryDelays.length - 1];
        delivery.nextRetryAt = new Date(Date.now() + delay);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Final status
    if (delivery.status !== 'success') {
      delivery.status = 'failed';

      await this.getWebhooksCollection().updateOne(
        { id: webhook.id },
        { 
          $set: { 
            lastDeliveryAt: new Date(),
            lastDeliveryStatus: 'failed',
          },
          $inc: { consecutiveFailures: 1 },
        }
      );

      // Auto-disable if too many failures
      const updatedWebhook = await this.get(webhook.id, webhook.tenantId);
      if (updatedWebhook && updatedWebhook.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        await this.update(webhook.id, webhook.tenantId, { isActive: false });
        await this.getWebhooksCollection().updateOne(
          { id: webhook.id },
          { $set: { disabledReason: `Auto-disabled after ${this.config.maxConsecutiveFailures} consecutive failures` } }
        );

        logger.error('Webhook auto-disabled due to failures', {
          service: this.config.serviceName,
          webhookId: webhook.id,
          consecutiveFailures: updatedWebhook.consecutiveFailures,
        });
      }
    }

    // Save delivery record
    await this.getDeliveriesCollection().insertOne(delivery as any);

    return delivery;
  }

  // ─────────────────────────────────────────────────────────────────
  // Testing
  // ─────────────────────────────────────────────────────────────────

  /**
   * Send a test webhook to verify endpoint is working.
   */
  async test(id: string, tenantId: string): Promise<WebhookTestResult> {
    logger.debug(`Testing webhook: id=${id}, tenantId=${tenantId}, service=${this.config.serviceName}`);
    const webhook = await this.get(id, tenantId);
    if (!webhook) {
      logger.warn(`Webhook not found in test(): id=${id}, tenantId=${tenantId}, service=${this.config.serviceName}`);
      // Try to find any webhooks with this ID to debug
      const allWithId = await this.getWebhooksCollection().find({ id }).toArray();
      if (allWithId.length > 0) {
        logger.warn(`Found ${allWithId.length} webhook(s) with id=${id} but different tenantIds: ${allWithId.map(w => w.tenantId).join(', ')}`);
      }
      return { success: false, error: 'Webhook not found' };
    }

    const delivery = await this.deliver(webhook, {
      eventId: crypto.randomUUID(),
      eventType: 'webhook.test',
      tenantId,
      data: {
        message: 'This is a test webhook delivery',
        service: this.config.serviceName,
        webhookId: id,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: delivery.status === 'success',
      statusCode: delivery.statusCode,
      responseTime: delivery.duration,
      error: delivery.error,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // History & Stats
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get delivery history for a webhook.
   */
  async getDeliveryHistory(
    webhookId: string,
    tenantId: string,
    options: { limit?: number; status?: WebhookDelivery['status'] } = {}
  ): Promise<WebhookDelivery[]> {
    const filter: any = { webhookId, tenantId };
    if (options.status) {
      filter.status = options.status;
    }

    return await this.getDeliveriesCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(options.limit ?? 100)
      .toArray() as WebhookDelivery[];
  }

  /**
   * Get webhook statistics for a tenant.
   */
  async getStats(tenantId: string): Promise<WebhookStats> {
    const webhooks = await this.getWebhooksCollection().find({ tenantId }).toArray();

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentDeliveries = await this.getDeliveriesCollection()
      .find({ tenantId, createdAt: { $gte: last24h } })
      .toArray();

    const successCount = recentDeliveries.filter(d => d.status === 'success').length;

    return {
      total: webhooks.length,
      active: webhooks.filter(w => w.isActive).length,
      disabled: webhooks.filter(w => !w.isActive).length,
      deliveriesLast24h: recentDeliveries.length,
      successRate: recentDeliveries.length > 0 
        ? Math.round((successCount / recentDeliveries.length) * 100) 
        : 100,
    };
  }

  /**
   * Clean up old delivery records.
   */
  async cleanupDeliveries(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await this.getDeliveriesCollection().deleteMany({
      createdAt: { $lt: cutoff },
      status: 'success',
    });

    if (result.deletedCount > 0) {
      logger.info(`Cleaned up ${result.deletedCount} old webhook deliveries`, {
        service: this.config.serviceName,
      });
    }

    return result.deletedCount;
  }

  // ─────────────────────────────────────────────────────────────────
  // Indexes
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create database indexes.
   */
  private async createIndexes(): Promise<void> {
    const webhooksCol = this.getWebhooksCollection();
    const deliveriesCol = this.getDeliveriesCollection();

    await webhooksCol.createIndex({ tenantId: 1 });
    await webhooksCol.createIndex({ tenantId: 1, isActive: 1 });
    await webhooksCol.createIndex({ id: 1, tenantId: 1 }, { unique: true });

    await deliveriesCol.createIndex({ webhookId: 1, tenantId: 1 });
    await deliveriesCol.createIndex({ tenantId: 1, createdAt: -1 });
    await deliveriesCol.createIndex({ eventId: 1 });
    await deliveriesCol.createIndex({ status: 1, createdAt: -1 });

    logger.debug(`Webhook indexes created for ${this.config.serviceName}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a typed webhook manager for your service.
 * 
 * @example
 * // Define your event types
 * type BonusEvents = 
 *   | 'bonus.awarded' 
 *   | 'bonus.converted' 
 *   | 'bonus.forfeited' 
 *   | 'bonus.*';
 * 
 * // Create manager
 * const webhooks = createWebhookManager<BonusEvents>({
 *   serviceName: 'bonus',
 * });
 * 
 * // Use in your service
 * await webhooks.initialize();
 * await webhooks.dispatch({
 *   eventType: 'bonus.awarded',  // Type-checked!
 *   tenantId: 'tenant-1',
 *   userId: 'user-123',
 *   data: { bonusId: 'b1', amount: 100 },
 * });
 */
export function createWebhookManager<TEvents extends string = string>(
  config: WebhookManagerConfig
): WebhookManager<TEvents> {
  return new WebhookManager<TEvents>(config);
}

// ═══════════════════════════════════════════════════════════════════
// Generic Webhook Service (plug-and-play for any service)
// ═══════════════════════════════════════════════════════════════════

/**
 * GraphQL type definitions for webhook management.
 * Complete and self-contained - no need to extend.
 */
export const webhookGraphQLTypes = `
  type Webhook {
    id: ID!
    tenantId: String!
    name: String!
    url: String!
    events: [String!]!
    isActive: Boolean!
    description: String
    headers: JSON
    timeout: Int
    maxRetries: Int
    lastDeliveryAt: String
    lastDeliveryStatus: String
    consecutiveFailures: Int!
    disabledReason: String
    createdAt: String!
    updatedAt: String!
  }

  type WebhookDelivery {
    id: ID!
    webhookId: String!
    eventId: String!
    eventType: String!
    statusCode: Int
    status: String!
    attempts: Int!
    error: String
    duration: Int
    responseBody: String
    createdAt: String!
    deliveredAt: String
    nextRetryAt: String
  }

  type WebhookStats {
    total: Int!
    active: Int!
    disabled: Int!
    deliveriesLast24h: Int!
    successRate: Int!
  }

  type WebhookTestResult {
    success: Boolean!
    statusCode: Int
    responseTime: Int
    error: String
  }

  input RegisterWebhookInput {
    name: String!
    url: String!
    secret: String!
    events: [String!]!
    headers: JSON
    timeout: Int
    maxRetries: Int
    description: String
  }

  input UpdateWebhookInput {
    name: String
    url: String
    secret: String
    events: [String!]
    headers: JSON
    timeout: Int
    maxRetries: Int
    isActive: Boolean
    description: String
  }

  extend type Query {
    webhooks(includeInactive: Boolean): [Webhook!]!
    webhook(id: ID!): Webhook
    webhookStats: WebhookStats!
    webhookDeliveries(webhookId: ID!, limit: Int, status: String): [WebhookDelivery!]!
  }

  extend type Mutation {
    registerWebhook(input: RegisterWebhookInput!): Webhook!
    updateWebhook(id: ID!, input: UpdateWebhookInput!): Webhook
    deleteWebhook(id: ID!): Boolean!
    testWebhook(id: ID!): WebhookTestResult!
  }
`;

/**
 * Resolver context type - matches service-core ResolverContext
 */
interface WebhookResolverContext {
  user: { userId: string; tenantId: string; roles: string[]; permissions: string[] } | null;
  requestId: string;
}

/**
 * Create GraphQL resolvers for a webhook manager.
 * Resolvers use ctx.user.tenantId for multi-tenant isolation.
 */
function createWebhookResolvers<TEvents extends string>(
  manager: WebhookManager<TEvents>
) {
  const getTenantId = (ctx: WebhookResolverContext): string => {
    if (!ctx.user?.tenantId) {
      throw new Error('Tenant ID required');
    }
    return ctx.user.tenantId;
  };

  return {
    Query: {
      webhooks: async (
        args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => manager.list(getTenantId(ctx), { includeInactive: args.includeInactive as boolean }),

      webhook: async (
        args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => {
        const webhookId = args.id as string;
        const tenantId = getTenantId(ctx);
        return manager.get(webhookId, tenantId);
      },

      webhookStats: async (
        _args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => manager.getStats(getTenantId(ctx)),

      webhookDeliveries: async (
        args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => manager.getDeliveryHistory(
        args.webhookId as string,
        getTenantId(ctx),
        { limit: args.limit as number, status: args.status as any }
      ),
    },

    Mutation: {
      registerWebhook: async (
        args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => {
        const input = args.input as RegisterWebhookInput;
        const tenantId = getTenantId(ctx);
        return manager.register({ ...input, tenantId } as any);
      },

      updateWebhook: async (
        args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => manager.update(args.id as string, getTenantId(ctx), args.input as any),

      deleteWebhook: async (
        args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => manager.delete(args.id as string, getTenantId(ctx)),

      testWebhook: async (
        args: Record<string, unknown>,
        ctx: WebhookResolverContext
      ) => {
        const webhookId = args.id as string;
        const tenantId = getTenantId(ctx);
        return manager.test(webhookId, tenantId);
      },
    },
  };
}

/**
 * Webhook service configuration
 */
export interface WebhookServiceConfig<TEvents extends string = string> {
  /** Webhook manager instance */
  manager: WebhookManager<TEvents>;
  /** Optional: Custom permission rules (default: admin only) */
  permissions?: {
    Query: Record<string, unknown>;
    Mutation: Record<string, unknown>;
  };
  /** Optional: Documentation of available events */
  eventsDocs?: string;
}

/**
 * Create a complete webhook service ready to plug into createGateway.
 * 
 * This is the recommended way to add webhooks to any service:
 * - Single source of truth for types/resolvers
 * - Consistent API across all services
 * - Easy to maintain and update
 * 
 * @example
 * // In your service:
 * const webhooks = createWebhookManager<MyEvents>({ serviceName: 'myservice' });
 * 
 * const webhookService = createWebhookService({ 
 *   manager: webhooks,
 *   eventsDocs: 'Available events: order.created, order.shipped'
 * });
 * 
 * // Add to gateway config:
 * services: [
 *   myOtherService,
 *   webhookService,  // Just add it!
 * ],
 * permissions: {
 *   ...myPermissions,
 *   ...webhookService.permissions,  // Merge permissions
 * }
 */
export function createWebhookService<TEvents extends string>(
  config: WebhookServiceConfig<TEvents>
): {
  name: string;
  types: string;
  resolvers: ReturnType<typeof createWebhookResolvers>;
  permissions: {
    Query: Record<string, unknown>;
    Mutation: Record<string, unknown>;
  };
  manager: WebhookManager<TEvents>;
} {
  const resolvers = createWebhookResolvers(config.manager);
  
  // Build types with optional event documentation
  const docsComment = config.eventsDocs 
    ? `\n  """\n  ${config.eventsDocs}\n  """\n`
    : '';
  
  // No need for 'extend type' - just use the base types
  const types = webhookGraphQLTypes;
  
  // Default permissions (admin only)
  const defaultPermissions = {
    Query: {
      webhooks: { role: 'admin' },
      webhook: { role: 'admin' },
      webhookStats: { role: 'admin' },
      webhookDeliveries: { role: 'admin' },
    },
    Mutation: {
      registerWebhook: { role: 'admin' },
      updateWebhook: { role: 'admin' },
      deleteWebhook: { role: 'admin' },
      testWebhook: { role: 'admin' },
    },
  };
  
  return {
    name: 'webhooks',
    types,
    resolvers,
    permissions: config.permissions ?? defaultPermissions,
    manager: config.manager,
  };
}

// Legacy export for backward compatibility
export { createWebhookResolvers };
