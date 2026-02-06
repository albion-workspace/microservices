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
import { logger } from '../logger.js';
import { getErrorMessage } from '../errors.js';
import { generateMongoId, normalizeDocument } from '../../databases/mongodb/utils.js';
import { CircuitBreaker, CircuitBreakerOpenError } from '../resilience/circuit-breaker.js';
import { retry, RetryConfigs } from '../resilience/retry.js';
import type { Db } from 'mongodb';
import type { DatabaseStrategyResolver, DatabaseContext } from '../../databases/mongodb/strategy.js';
import { timestampFieldsRequiredSDL } from '../graphql/sdl-fragments.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface WebhookDelivery {
  /** Unique delivery ID */
  id: string;
  /** Event ID (for idempotency) */
  eventId: string;
  /** Event type */
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

export interface WebhookConfig {
  id?: string; // MongoDB will automatically generate _id, which we map to id
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
  /** Recent deliveries (sub-documents, limited to last N for performance) */
  deliveries?: WebhookDelivery[];
  /** Total delivery count (for statistics) */
  deliveryCount?: number;
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
  /** Database instance (if provided, uses this directly) */
  database?: Db;
  /** Database strategy resolver (for dynamic database resolution) */
  databaseStrategy?: DatabaseStrategyResolver;
  /** Default database context for strategy resolution */
  defaultContext?: DatabaseContext;
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
    const errorMsg = getErrorMessage(error);
    logger.error('HMAC signature generation failed', { 
      error: errorMsg,
      secretLength: secret.length,
      payloadLength: payload.length 
    });
    throw new Error(`Failed to generate HMAC signature: ${errorMsg}`);
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
  private config: Required<Omit<WebhookManagerConfig, 'database' | 'databaseStrategy' | 'defaultContext'>> & {
    database?: Db;
    databaseStrategy?: DatabaseStrategyResolver;
    defaultContext?: DatabaseContext;
  };
  private enabled = false;
  /** Circuit breakers per webhook URL to prevent cascading failures */
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private db: Db | null = null;

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
      database: config.database,
      databaseStrategy: config.databaseStrategy,
      defaultContext: config.defaultContext,
    };
    this.db = config.database || null;
  }

  /**
   * Configure the webhook manager with database or database strategy.
   * Call this after database connection is established when the manager
   * was created at module level without database configuration.
   */
  configure(options: {
    database?: Db;
    databaseStrategy?: DatabaseStrategyResolver;
    defaultContext?: DatabaseContext;
  }): void {
    if (options.database) {
      this.db = options.database;
      this.config.database = options.database;
    }
    if (options.databaseStrategy) {
      this.config.databaseStrategy = options.databaseStrategy;
    }
    if (options.defaultContext) {
      this.config.defaultContext = options.defaultContext;
    }
  }

  /**
   * Get or create circuit breaker for a webhook URL
   */
  private getCircuitBreaker(url: string): CircuitBreaker {
    if (!this.circuitBreakers.has(url)) {
      this.circuitBreakers.set(
        url,
        new CircuitBreaker({
          name: `Webhook-${this.config.serviceName}-${url}`,
          failureThreshold: 5,
          resetTimeout: 60000, // 1 minute
          monitoringWindow: 120000, // 2 minutes
        })
      );
    }
    return this.circuitBreakers.get(url)!;
  }

  // ─────────────────────────────────────────────────────────────────
  // Collection Access (service-namespaced)
  // ─────────────────────────────────────────────────────────────────

  private async getWebhooksCollection(context?: Partial<DatabaseContext>) {
    let db: Db;
    
    if (this.db) {
      db = this.db;
    } else if (this.config.databaseStrategy) {
      // Merge context with service name and default context
      const resolvedContext: DatabaseContext = {
        service: this.config.serviceName,
        ...this.config.defaultContext,
        ...context,
      };
      db = await this.config.databaseStrategy.resolve(resolvedContext);
    } else {
      throw new Error('WebhookManager requires either database or databaseStrategy with defaultContext');
    }
    
    return db.collection<WebhookConfig>(`${this.config.serviceName}_webhooks`);
  }

  /**
   * Maximum number of recent deliveries to keep in webhook document
   */
  private readonly MAX_RECENT_DELIVERIES = 100;

  // ─────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────

  /**
   * Initialize webhook system (call at service startup).
   * Creates indexes and enables webhook dispatching.
   */
  async initialize(context?: DatabaseContext): Promise<void> {
    await this.createIndexes(context);
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
    // Use MongoDB ObjectId for performant single-insert operation
    const { objectId, idString } = generateMongoId();
    const webhook = {
      _id: objectId,
      id: idString,
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
      deliveries: [], // Initialize deliveries array
      deliveryCount: 0, // Initialize delivery count
    };
    
    const collection = await this.getWebhooksCollection({ tenantId: input.tenantId } as Partial<DatabaseContext>);
    await collection.insertOne(webhook as any);
    
    logger.info('Webhook registered', { 
      service: this.config.serviceName,
      webhookId: webhook.id, 
      tenantId: webhook.tenantId,
      url: webhook.url,
      events: webhook.events,
    });
    
    return webhook as WebhookConfig;
  }

  /**
   * Update a webhook configuration.
   */
  async update(
    id: string,
    tenantId: string,
    updates: Partial<Pick<WebhookConfig, 'name' | 'url' | 'secret' | 'events' | 'headers' | 'timeout' | 'maxRetries' | 'description' | 'isActive'>>
  ): Promise<WebhookConfig | null> {
    const updateDoc: any = { 
      ...updates, 
      updatedAt: new Date(),
      ...(updates.isActive === true && { consecutiveFailures: 0, disabledReason: undefined }),
    };

    const collection = await this.getWebhooksCollection({ tenantId } as Partial<DatabaseContext>);
    // Ensure deliveries and deliveryCount are initialized if missing
    const webhook = await collection.findOne({ id, tenantId });
    if (webhook) {
      if (!webhook.deliveries) {
        updateDoc.deliveries = [];
      }
      if (webhook.deliveryCount === undefined || webhook.deliveryCount === null) {
        updateDoc.deliveryCount = 0;
      }
    }

    const result = await collection.findOneAndUpdate(
      { id, tenantId },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );
    
    if (!result) return null;
    
    // Ensure deliveries and deliveryCount are initialized in returned result
    return {
      ...result,
      deliveries: result.deliveries || [],
      deliveryCount: result.deliveryCount ?? 0,
    } as WebhookConfig;
  }

  /**
   * Delete a webhook.
   */
  async delete(id: string, tenantId: string): Promise<boolean> {
    const collection = await this.getWebhooksCollection({ tenantId } as Partial<DatabaseContext>);
    const result = await collection.deleteOne({ id, tenantId });
    return result.deletedCount > 0;
  }

  /**
   * Get a webhook by ID.
   * Returns webhook with deliveries array and deliveryCount (merged structure).
   */
  async get(id: string, tenantId: string): Promise<WebhookConfig | null> {
    const collection = await this.getWebhooksCollection({ tenantId } as Partial<DatabaseContext>);
    const result = await collection.findOne({ id, tenantId }) as WebhookConfig | null;
    if (!result) {
      logger.debug(`Webhook not found: id=${id}, tenantId=${tenantId}, service=${this.config.serviceName}, collection=${this.config.serviceName}_webhooks`);
      return null;
    }
    // Ensure deliveries and deliveryCount are initialized (for webhooks created before optimization)
    if (!result.deliveries) {
      result.deliveries = [];
    }
    if (result.deliveryCount === undefined) {
      result.deliveryCount = 0;
    }
    return result;
  }

  /**
   * List webhooks for a tenant.
   * Returns webhooks with deliveries arrays and deliveryCount (merged structure).
   */
  async list(
    tenantId: string,
    options: { includeInactive?: boolean } = {}
  ): Promise<WebhookConfig[]> {
    const filter: any = { tenantId };
    if (!options.includeInactive) {
      filter.isActive = true;
    }
    const collection = await this.getWebhooksCollection({ tenantId } as Partial<DatabaseContext>);
    const webhooks = await collection.find(filter).toArray() as WebhookConfig[];
    // Ensure deliveries and deliveryCount are initialized for all webhooks
    return webhooks.map(webhook => ({
      ...webhook,
      deliveries: webhook.deliveries || [],
      deliveryCount: webhook.deliveryCount ?? 0,
    }));
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
    // Generate delivery ID (no MongoDB ObjectId needed - it's a sub-document)
    const { idString } = generateMongoId();
    const delivery: Partial<WebhookDelivery> & { id: string; eventId: string; eventType: string; status: WebhookDelivery['status']; attempts: number; createdAt: Date } = {
      id: idString,
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
        error: getErrorMessage(error),
      });
      throw error;
    }

    const maxAttempts = webhook.maxRetries ?? this.config.defaultMaxRetries;
    const circuitBreaker = this.getCircuitBreaker(webhook.url);

    // Use enhanced retry with circuit breaker protection
    try {
      const retryResult = await retry(
        async () => {
          // Wrap fetch with circuit breaker
          return await circuitBreaker.execute(async () => {
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

            // Treat non-2xx responses as errors (will trigger retry)
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
          });
        },
        {
          maxRetries: maxAttempts - 1, // -1 because first attempt is not a retry
          strategy: 'exponential',
          baseDelay: 1000, // Start with 1s delay
          maxDelay: 60000, // Max 60s delay
          jitter: true,
          name: `Webhook-${this.config.serviceName}-${webhook.id}`,
          isRetryable: (error) => {
            // Don't retry circuit breaker open errors
            if (error instanceof CircuitBreakerOpenError) {
              return false;
            }
            // Retry network errors and 5xx errors
            return true;
          },
        }
      );

      delivery.attempts = retryResult.attempts;
      delivery.status = 'success';
      delivery.deliveredAt = new Date();

      const collection = await this.getWebhooksCollection({ tenantId: webhook.tenantId });
      await collection.updateOne(
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
        statusCode: delivery.statusCode,
        duration: delivery.duration,
        attempts: retryResult.attempts,
      });

    } catch (error) {
      delivery.attempts = maxAttempts;
      delivery.status = 'failed';
      delivery.error = getErrorMessage(error);

      // Check if circuit breaker is open
      if (error instanceof CircuitBreakerOpenError) {
        logger.warn('Webhook delivery blocked by circuit breaker', {
          service: this.config.serviceName,
          webhookId: webhook.id,
          eventType: event.eventType,
          state: error.state,
        });
      } else {
        logger.error('Webhook delivery failed after all retries', {
          service: this.config.serviceName,
          webhookId: webhook.id,
          eventType: event.eventType,
          error: delivery.error,
          attempts: maxAttempts,
        });
      }

      // Update consecutive failures
      const collection1 = await this.getWebhooksCollection({ tenantId: webhook.tenantId });
      await collection1.updateOne(
        { id: webhook.id },
        { 
          $inc: { consecutiveFailures: 1 },
          $set: { 
            lastDeliveryStatus: 'failed',
          } 
        }
      );
    }

    // Final status
    if (delivery.status !== 'success') {
      delivery.status = 'failed';

      const collection2 = await this.getWebhooksCollection({ tenantId: webhook.tenantId });
      await collection2.updateOne(
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
      if (webhook.id) {
        const updatedWebhook = await this.get(webhook.id, webhook.tenantId);
        if (updatedWebhook && updatedWebhook.consecutiveFailures >= this.config.maxConsecutiveFailures) {
          await this.update(webhook.id, webhook.tenantId, { isActive: false });
          const collection3 = await this.getWebhooksCollection({ tenantId: webhook.tenantId });
          await collection3.updateOne(
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
    }

    // Save delivery record as sub-document in webhook (optimized: single write operation)
    // Remove webhookId and tenantId from delivery (already in parent webhook)
    const { webhookId, tenantId, _id, ...deliveryData } = delivery as any;
    const deliveryToStore: WebhookDelivery = {
      id: delivery.id,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      status: delivery.status,
      attempts: delivery.attempts,
      createdAt: delivery.createdAt,
      ...(delivery.statusCode && { statusCode: delivery.statusCode }),
      ...(delivery.responseBody && { responseBody: delivery.responseBody }),
      ...(delivery.error && { error: delivery.error }),
      ...(delivery.duration && { duration: delivery.duration }),
      ...(delivery.deliveredAt && { deliveredAt: delivery.deliveredAt }),
      ...(delivery.nextRetryAt && { nextRetryAt: delivery.nextRetryAt }),
    };

    // Update webhook with delivery using $push and $slice to keep only recent deliveries
    const collection4 = await this.getWebhooksCollection({ tenantId: webhook.tenantId });
    await collection4.updateOne(
      { id: webhook.id },
      {
        $push: {
          deliveries: {
            $each: [deliveryToStore],
            $slice: -this.MAX_RECENT_DELIVERIES, // Keep only last N deliveries
          },
        },
        $inc: { deliveryCount: 1 },
        $set: { updatedAt: new Date() },
      }
    );

    return deliveryToStore;
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
      const collection5 = await this.getWebhooksCollection({ tenantId });
      const allWithId = await collection5.find({ id }).toArray();
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
   * Reads from webhook.deliveries array (optimized: no separate query needed)
   */
  async getDeliveryHistory(
    webhookId: string,
    tenantId: string,
    options: { limit?: number; status?: WebhookDelivery['status'] } = {}
  ): Promise<WebhookDelivery[]> {
    const webhook = await this.get(webhookId, tenantId);
    if (!webhook) {
      return [];
    }

    // Get deliveries from webhook document (recent deliveries are stored here)
    let deliveries = (webhook.deliveries || []).slice();

    // Filter by status if specified
    if (options.status) {
      deliveries = deliveries.filter(d => d.status === options.status);
    }

    // Sort by createdAt descending (newest first)
    deliveries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Apply limit
    const limit = options.limit ?? 100;
    return deliveries.slice(0, limit);
  }

  /**
   * Get webhook statistics for a tenant.
   * Now counts from webhook.deliveries arrays (optimized: no separate query needed)
   */
  async getStats(tenantId: string): Promise<WebhookStats> {
    const collection = await this.getWebhooksCollection({ tenantId } as Partial<DatabaseContext>);
    const webhooks = await collection.find({ tenantId }).toArray();

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Count deliveries from webhook.deliveries arrays
    let recentDeliveries: WebhookDelivery[] = [];
    for (const webhook of webhooks) {
      if (webhook.deliveries) {
        const recent = webhook.deliveries.filter(
          d => d.createdAt >= last24h
        );
        recentDeliveries.push(...recent);
      }
    }

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
   * Clean up old delivery records from webhook.deliveries arrays.
   * Old deliveries are automatically removed by $slice, but this can clean up
   * any that might have accumulated.
   */
  async cleanupDeliveries(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    // Clean up old deliveries from webhook documents
    // Note: This method needs to query across all tenants, so we use defaultContext
    const collection = await this.getWebhooksCollection();
    const webhooks = await collection
      .find({ 'deliveries.createdAt': { $lt: cutoff } })
      .toArray();

    for (const webhook of webhooks) {
      if (webhook.deliveries && webhook.deliveries.length > 0) {
        const filteredDeliveries = webhook.deliveries.filter(
          d => d.createdAt >= cutoff || d.status !== 'success'
        );
        
        if (filteredDeliveries.length !== webhook.deliveries.length) {
          const webhookCollection = await this.getWebhooksCollection({ tenantId: webhook.tenantId });
          await webhookCollection.updateOne(
            { id: webhook.id },
            {
              $set: {
                deliveries: filteredDeliveries.slice(-this.MAX_RECENT_DELIVERIES),
                updatedAt: new Date(),
              },
            }
          );
          cleanedCount += webhook.deliveries.length - filteredDeliveries.length;
        }
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old webhook deliveries`, {
        service: this.config.serviceName,
        olderThanDays,
      });
    }

    return cleanedCount;
  }

  // ─────────────────────────────────────────────────────────────────
  // Indexes
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create database indexes.
   */
  private async createIndexes(context?: DatabaseContext): Promise<void> {
    const webhooksCol = await this.getWebhooksCollection(context);

    await webhooksCol.createIndex({ tenantId: 1 });
    await webhooksCol.createIndex({ tenantId: 1, isActive: 1 });
    await webhooksCol.createIndex({ id: 1, tenantId: 1 }, { unique: true });
    // Indexes for querying deliveries within webhook documents
    await webhooksCol.createIndex({ 'deliveries.createdAt': -1 });
    await webhooksCol.createIndex({ 'deliveries.eventId': 1 });

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
 * 
 * Optimized Structure:
 * - Deliveries are stored as sub-documents in webhook.deliveries array (not separate collection)
 * - WebhookDelivery does not include webhookId/tenantId (inherited from parent webhook)
 * - Recent deliveries (last 100) are kept in webhook document for performance
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
    deliveries: [WebhookDelivery!]!
    deliveryCount: Int!
    ${timestampFieldsRequiredSDL()}
  }

  type WebhookDelivery {
    id: ID!
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
    return ctx.user?.tenantId || 'default';
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

    // Field resolvers to ensure deliveries, deliveryCount, and dates are always present
    Webhook: {
      deliveries: (webhook: WebhookConfig) => {
        // Always return an array, never null/undefined
        return Array.isArray(webhook.deliveries) ? webhook.deliveries : [];
      },
      deliveryCount: (webhook: WebhookConfig) => {
        // Always return a number, never null/undefined
        return typeof webhook.deliveryCount === 'number' ? webhook.deliveryCount : 0;
      },
      lastDeliveryAt: (webhook: WebhookConfig) => {
        // If lastDeliveryAt is missing, compute it from the most recent delivery
        if (webhook.lastDeliveryAt) {
          return webhook.lastDeliveryAt instanceof Date 
            ? webhook.lastDeliveryAt.toISOString() 
            : webhook.lastDeliveryAt;
        }
        // Compute from deliveries array if available
        const deliveries = Array.isArray(webhook.deliveries) ? webhook.deliveries : [];
        if (deliveries.length > 0) {
          const lastDelivery = deliveries
            .filter(d => d.deliveredAt || d.createdAt)
            .sort((a, b) => {
              const aTime = (a.deliveredAt || a.createdAt)?.getTime() || 0;
              const bTime = (b.deliveredAt || b.createdAt)?.getTime() || 0;
              return bTime - aTime;
            })[0];
          if (lastDelivery) {
            const date = lastDelivery.deliveredAt || lastDelivery.createdAt;
            return date instanceof Date ? date.toISOString() : date;
          }
        }
        return null;
      },
      createdAt: (webhook: WebhookConfig) => {
        // Ensure createdAt is always a string
        if (!webhook.createdAt) return new Date().toISOString();
        return webhook.createdAt instanceof Date 
          ? webhook.createdAt.toISOString() 
          : webhook.createdAt;
      },
      updatedAt: (webhook: WebhookConfig) => {
        // Ensure updatedAt is always a string
        if (!webhook.updatedAt) return new Date().toISOString();
        return webhook.updatedAt instanceof Date 
          ? webhook.updatedAt.toISOString() 
          : webhook.updatedAt;
      },
    },
    WebhookDelivery: {
      createdAt: (delivery: WebhookDelivery) => {
        // Ensure createdAt is always a string
        if (!delivery.createdAt) return new Date().toISOString();
        return delivery.createdAt instanceof Date 
          ? delivery.createdAt.toISOString() 
          : delivery.createdAt;
      },
      deliveredAt: (delivery: WebhookDelivery) => {
        // Return null if not delivered, otherwise serialize to string
        if (!delivery.deliveredAt) return null;
        return delivery.deliveredAt instanceof Date 
          ? delivery.deliveredAt.toISOString() 
          : delivery.deliveredAt;
      },
      nextRetryAt: (delivery: WebhookDelivery) => {
        // Return null if no retry scheduled, otherwise serialize to string
        if (!delivery.nextRetryAt) return null;
        return delivery.nextRetryAt instanceof Date 
          ? delivery.nextRetryAt.toISOString() 
          : delivery.nextRetryAt;
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

export { createWebhookResolvers };

// ═══════════════════════════════════════════════════════════════════
// Generic Webhook Initialization Helper
// ═══════════════════════════════════════════════════════════════════

/**
 * Generic webhook initialization function for any service.
 * Configures the webhook manager with database strategy and initializes indexes.
 * 
 * @example
 * // In your service's event-dispatcher.ts:
 * export const myWebhooks = createWebhookManager<MyEvents>({ serviceName: 'my-service' });
 * 
 * // In your service's index.ts (after DB connection):
 * await initializeWebhooks(myWebhooks, {
 *   databaseStrategy,
 *   defaultContext: { service: 'my-service', brand, tenantId },
 * });
 */
export async function initializeWebhooks<TEvents extends string>(
  webhookManager: WebhookManager<TEvents>,
  options: {
    databaseStrategy: DatabaseStrategyResolver;
    defaultContext: DatabaseContext;
  }
): Promise<void> {
  try {
    // Configure the webhook manager with database strategy
    webhookManager.configure({
      databaseStrategy: options.databaseStrategy,
      defaultContext: options.defaultContext,
    });
    
    // Initialize indexes and enable dispatching
    await webhookManager.initialize();
    logger.info('Webhooks initialized with database strategy', { 
      service: options.defaultContext.service,
    });
  } catch (err) {
    logger.warn('Could not initialize webhooks', { 
      service: options.defaultContext.service,
      error: (err as Error).message,
    });
  }
}
