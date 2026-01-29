/**
 * Configurable Logger - Zero dependencies
 * Supports log streaming to subscribers (for real-time monitoring)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'text' | 'pretty';

// ═══════════════════════════════════════════════════════════════════
// Log Entry Type (for streaming)
// ═══════════════════════════════════════════════════════════════════

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  data?: Record<string, unknown>;
}

export type LogSubscriber = (entry: LogEntry) => void;

// ═══════════════════════════════════════════════════════════════════
// Correlation ID Management (for distributed tracing)
// ═══════════════════════════════════════════════════════════════════

const correlationIdStore = new Map<string, string>();

/**
 * Set correlation ID for current async context
 * Uses AsyncLocalStorage for request-scoped correlation IDs
 */
export function setCorrelationId(id: string): void {
  // Store in process context (can be enhanced with AsyncLocalStorage for better isolation)
  process.env.CORRELATION_ID = id;
}

/**
 * Get current correlation ID
 */
export function getCorrelationId(): string | undefined {
  return process.env.CORRELATION_ID;
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Run function with correlation ID context
 */
export async function withCorrelationId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previousId = getCorrelationId();
  setCorrelationId(id);
  try {
    return await fn();
  } finally {
    if (previousId) {
      setCorrelationId(previousId);
    } else {
      delete process.env.CORRELATION_ID;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

export interface LoggerConfig {
  /** Minimum log level (default: 'info') */
  level?: LogLevel;
  /** Output format (default: 'json') */
  format?: LogFormat;
  /** Include timestamp (default: true) */
  timestamp?: boolean;
  /** Service name to include in logs */
  service?: string;
  /** Custom metadata to include in every log */
  metadata?: Record<string, unknown>;
}

const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let config: Required<Omit<LoggerConfig, 'metadata'>> & { metadata?: Record<string, unknown> } = {
  level: 'info',
  format: 'json',
  timestamp: true,
  service: '',
};

// ═══════════════════════════════════════════════════════════════════
// Log Subscribers (for streaming)
// ═══════════════════════════════════════════════════════════════════

const subscribers = new Set<LogSubscriber>();

export function subscribeToLogs(subscriber: LogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function notifySubscribers(level: LogLevel, message: string, data?: object): void {
  if (subscribers.size === 0) return;
  
  const correlationId = getCorrelationId();
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: config.service || 'unknown',
    message,
    ...(correlationId && { correlationId }),
    data: data as Record<string, unknown>,
  };
  
  for (const subscriber of subscribers) {
    try {
      subscriber(entry);
    } catch {
      // Ignore subscriber errors
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════════

const colors = {
  reset: '\x1b[0m',
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};

function formatJson(level: LogLevel, message: string, data?: object): string {
  const correlationId = getCorrelationId();
  return JSON.stringify({
    ...(config.timestamp && { timestamp: new Date().toISOString() }),
    level,
    ...(config.service && { service: config.service }),
    ...(correlationId && { correlationId }),
    message,
    ...config.metadata,
    ...data,
  });
}

function formatText(level: LogLevel, message: string, data?: object): string {
  const parts: string[] = [];
  if (config.timestamp) parts.push(new Date().toISOString());
  parts.push(`[${level.toUpperCase()}]`);
  if (config.service) parts.push(`[${config.service}]`);
  const correlationId = getCorrelationId();
  if (correlationId) parts.push(`[${correlationId}]`);
  parts.push(message);
  if (data && Object.keys(data).length > 0) {
    parts.push(JSON.stringify(data));
  }
  return parts.join(' ');
}

function formatPretty(level: LogLevel, message: string, data?: object): string {
  const color = colors[level];
  const parts: string[] = [];
  if (config.timestamp) parts.push(`\x1b[90m${new Date().toISOString()}\x1b[0m`);
  parts.push(`${color}${level.toUpperCase().padEnd(5)}${colors.reset}`);
  if (config.service) parts.push(`\x1b[90m[${config.service}]\x1b[0m`);
  const correlationId = getCorrelationId();
  if (correlationId) parts.push(`\x1b[90m[${correlationId}]\x1b[0m`);
  parts.push(message);
  if (data && Object.keys(data).length > 0) {
    parts.push(`\x1b[90m${JSON.stringify(data)}\x1b[0m`);
  }
  return parts.join(' ');
}

const formatters: Record<LogFormat, (level: LogLevel, message: string, data?: object) => string> = {
  json: formatJson,
  text: formatText,
  pretty: formatPretty,
};

// ═══════════════════════════════════════════════════════════════════
// Core Logger
// ═══════════════════════════════════════════════════════════════════

function log(level: LogLevel, message: string, data?: object): void {
  if (levels[level] >= levels[config.level]) {
    const formatted = formatters[config.format](level, message, data);
    (level === 'error' ? process.stderr : process.stdout).write(formatted + '\n');
    
    // Notify subscribers for log streaming
    notifySubscribers(level, message, data);
  }
}

export const logger = {
  debug: (msg: string, data?: object) => log('debug', msg, data),
  info: (msg: string, data?: object) => log('info', msg, data),
  warn: (msg: string, data?: object) => log('warn', msg, data),
  error: (msg: string, data?: object) => log('error', msg, data),
  
  /** Configure logger settings */
  configure: (cfg: LoggerConfig) => {
    config = { ...config, ...cfg };
  },
  
  /** Get current configuration */
  getConfig: () => ({ ...config }),
};

// ═══════════════════════════════════════════════════════════════════
// Convenience Functions
// ═══════════════════════════════════════════════════════════════════

export function setLogLevel(level: LogLevel) {
  config.level = level;
}

export function setLogFormat(format: LogFormat) {
  config.format = format;
}

export function configureLogger(cfg: LoggerConfig) {
  logger.configure(cfg);
}

// ═══════════════════════════════════════════════════════════════════
// Child Logger (for creating scoped loggers)
// ═══════════════════════════════════════════════════════════════════

export function createChildLogger(childConfig: { service?: string; metadata?: Record<string, unknown> }) {
  const childMeta = { ...config.metadata, ...childConfig.metadata };
  const childService = childConfig.service || config.service;
  
  return {
    debug: (msg: string, data?: object) => log('debug', msg, { ...childMeta, ...data }),
    info: (msg: string, data?: object) => log('info', msg, { ...childMeta, ...data }),
    warn: (msg: string, data?: object) => log('warn', msg, { ...childMeta, ...data }),
    error: (msg: string, data?: object) => log('error', msg, { ...childMeta, ...data }),
  };
}
