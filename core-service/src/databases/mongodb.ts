/**
 * MongoDB Connection - Optimized for 100K+ scale
 * 
 * Features:
 * - Connection pooling (optimized)
 * - Read preference (read from secondaries)
 * - Write concern (configurable)
 * - Retry logic
 * - Health checks
 */

import { MongoClient, Db, ReadPreference, WriteConcern } from 'mongodb';
import { logger } from '../common/logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

// Connection pool tracking (using events instead of internal topology access)
let connectionPoolStats = {
  totalConnections: 0,
  checkedOut: 0,
};

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

export interface MongoConfig {
  uri: string;
  dbName?: string;
  // Pool settings
  maxPoolSize?: number;
  minPoolSize?: number;
  // Timeouts
  connectTimeoutMS?: number;
  socketTimeoutMS?: number;
  serverSelectionTimeoutMS?: number;
  // Read/Write settings
  readPreference?: 'primary' | 'secondary' | 'nearest';
  writeConcern?: 'majority' | number;
  // Retry
  retryWrites?: boolean;
  retryReads?: boolean;
}

/** Default MongoDB configuration - can be used as base for customization */
export const DEFAULT_MONGO_CONFIG: Omit<Required<MongoConfig>, 'uri' | 'dbName'> = {
  maxPoolSize: 100,          // Max connections per node
  minPoolSize: 10,           // Keep warm connections
  connectTimeoutMS: 10000,   // 10s connect timeout
  socketTimeoutMS: 45000,    // 45s socket timeout
  serverSelectionTimeoutMS: 30000,
  readPreference: 'nearest', // Read from closest node (reduces latency)
  writeConcern: 'majority',  // Ensure writes are durable
  retryWrites: true,
  retryReads: true,
};

// ═══════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════

// Track base URI (server) to reuse client for same server
let baseUri: string | null = null;

export async function connectDatabase(uri: string, config: Partial<MongoConfig> = {}): Promise<Db> {
  // Parse URI to extract base (server) and database name
  const uriObj = new URL(uri);
  const currentBaseUri = `${uriObj.protocol}//${uriObj.host}${uriObj.search || ''}`;
  
  // Check if we have a cached client for the same server AND it's actually connected
  if (client && baseUri === currentBaseUri) {
    try {
      // Verify client is actually connected using ping command (modern MongoDB driver approach)
      await client.db('admin').command({ ping: 1 });
      // Client is connected to same server - return database for requested dbName
      let dbName = config.dbName || uriObj.pathname.slice(1) || 'default';
      if (dbName.includes('?')) {
        dbName = dbName.split('?')[0];
      }
      dbName = dbName.trim();
      // IMPORTANT: Update global db to the requested database
      // This ensures getDatabase() returns the correct db after gateway connects
      db = client.db(dbName);
      logger.debug('Reusing MongoDB client, switched to database', { database: dbName });
      return db;
    } catch {
      // Client exists but not connected - fall through to reconnect
      client = null;
      db = null;
      baseUri = null;
    }
  }

  const cfg = { ...DEFAULT_MONGO_CONFIG, ...config };
  
  const readPrefMap = {
    primary: ReadPreference.PRIMARY,
    secondary: ReadPreference.SECONDARY_PREFERRED,
    nearest: ReadPreference.NEAREST,
  };

  // Parse URI to check if we're connecting to localhost
  const isLocalhost = uriObj.hostname === 'localhost' || uriObj.hostname === '127.0.0.1';
  
  // When connecting from localhost to a Docker container, we need directConnection
  // to avoid replica set member discovery (which would try to resolve Docker hostnames like ms-mongo)
  // Even if MongoDB is configured as a replica set inside Docker, we connect directly from outside
  const clientOptions: any = {
    maxPoolSize: cfg.maxPoolSize,
    minPoolSize: cfg.minPoolSize,
    connectTimeoutMS: cfg.connectTimeoutMS,
    socketTimeoutMS: cfg.socketTimeoutMS,
    serverSelectionTimeoutMS: cfg.serverSelectionTimeoutMS,
    readPreference: readPrefMap[cfg.readPreference || 'nearest'],
    writeConcern: new WriteConcern(cfg.writeConcern || 'majority'),
    retryWrites: cfg.retryWrites,
    retryReads: cfg.retryReads,
  };
  
  // Always force direct connection when connecting from localhost (services outside Docker)
  // This prevents MongoDB driver from trying to discover replica set members (ms-mongo, etc.)
  if (isLocalhost) {
    // If URI doesn't have directConnection, add it
    if (!uri.includes('directConnection=')) {
      const separator = uri.includes('?') ? '&' : '?';
      uri = `${uri}${separator}directConnection=true`;
      logger.debug('Added directConnection=true to MongoDB URI for localhost connection (bypassing replica set discovery)');
    }
    // Also set in client options to ensure it's enforced
    clientOptions.directConnection = true;
    // Remove any replicaSet parameter from URI if present (we're connecting directly)
    if (uri.includes('replicaSet=')) {
      uri = uri.replace(/[?&]replicaSet=[^&]*/, '');
      logger.debug('Removed replicaSet parameter from URI for direct localhost connection');
    }
  }

  // Use base URI (server only) for client connection
  // This allows reusing the same client for different databases on the same server
  const clientUri = currentBaseUri;
  baseUri = currentBaseUri;
  client = new MongoClient(clientUri, clientOptions);

  // Connection pool monitoring using official events (MongoDB 7.x best practice)
  // This replaces internal topology access which is not a public API
  client.on('connectionPoolCreated', () => {
    logger.debug('MongoDB pool created');
  });
  client.on('connectionPoolClosed', () => {
    logger.debug('MongoDB pool closed');
    connectionPoolStats = { totalConnections: 0, checkedOut: 0 };
  });
  client.on('connectionCreated', () => {
    connectionPoolStats.totalConnections++;
  });
  client.on('connectionClosed', () => {
    connectionPoolStats.totalConnections = Math.max(0, connectionPoolStats.totalConnections - 1);
  });
  client.on('connectionCheckedOut', () => {
    connectionPoolStats.checkedOut++;
  });
  client.on('connectionCheckedIn', () => {
    connectionPoolStats.checkedOut = Math.max(0, connectionPoolStats.checkedOut - 1);
  });
  
  await client.connect();
  
  let dbName = cfg.dbName || new URL(uri).pathname.slice(1) || 'default';
  // Remove query parameters if present and trim whitespace
  if (dbName.includes('?')) {
    dbName = dbName.split('?')[0];
  }
  dbName = dbName.trim();
  db = client.db(dbName);
  
  // Create indexes for common queries
  await ensureIndexes(db);
  
  logger.info('Connected to MongoDB', { 
    database: dbName,
    maxPoolSize: cfg.maxPoolSize,
    readPreference: cfg.readPreference,
  });
  
  return db;
}

export function getDatabase(): Db {
  if (!db) throw new Error('Database not connected');
  return db;
}

export function getClient(): MongoClient {
  if (!client) throw new Error('Database not connected');
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    baseUri = null;
    connectionPoolStats = { totalConnections: 0, checkedOut: 0 };
    logger.info('MongoDB disconnected');
  }
}

/**
 * Get current connection pool statistics.
 * Uses event-based tracking (MongoDB 7.x best practice).
 */
export function getConnectionPoolStats(): { totalConnections: number; checkedOut: number } {
  return { ...connectionPoolStats };
}

// ═══════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════

export async function checkDatabaseHealth(): Promise<{ 
  healthy: boolean; 
  latencyMs: number; 
  connections: number;
  checkedOut: number;
}> {
  if (!db || !client) {
    return { healthy: false, latencyMs: -1, connections: 0, checkedOut: 0 };
  }

  const start = Date.now();
  try {
    await db.command({ ping: 1 });
    const latencyMs = Date.now() - start;
    
    // Use event-tracked connection pool stats (MongoDB 7.x best practice)
    return { 
      healthy: true, 
      latencyMs,
      connections: connectionPoolStats.totalConnections,
      checkedOut: connectionPoolStats.checkedOut,
    };
  } catch {
    return { healthy: false, latencyMs: -1, connections: 0, checkedOut: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Auto-create common indexes
// ═══════════════════════════════════════════════════════════════════

// Custom index definitions - apps can register their indexes
const customIndexes: Map<string, Array<{ key: Record<string, 1 | -1>; unique?: boolean }>> = new Map();

/**
 * Register indexes for a collection (call before connectDatabase)
 * 
 * @example
 * registerIndexes('products', [
 *   { key: { id: 1 }, unique: true },
 *   { key: { category: 1 } },
 *   { key: { createdAt: -1 } },
 * ]);
 */
export function registerIndexes(
  collection: string, 
  indexes: Array<{ key: Record<string, 1 | -1>; unique?: boolean }>
): void {
  customIndexes.set(collection, indexes);
}

async function ensureIndexes(database: Db): Promise<void> {
  try {
    if (customIndexes.size === 0) {
      logger.debug('No custom indexes registered');
      return;
    }

    const collections = await database.listCollections().toArray();
    const collNames = collections.map(c => c.name);

    for (const [collName, indexes] of customIndexes) {
      if (collNames.includes(collName)) {
        await database.collection(collName).createIndexes(indexes);
        logger.debug(`Indexes ensured for ${collName}`);
      }
    }

    logger.debug('Database indexes ensured');
  } catch (error) {
    logger.warn('Failed to ensure indexes', { error });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Stats for monitoring
// ═══════════════════════════════════════════════════════════════════

export async function getDatabaseStats(): Promise<Record<string, unknown>> {
  if (!db) return {};
  
  try {
    const stats = await db.stats();
    return {
      collections: stats.collections,
      objects: stats.objects,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
      indexes: stats.indexes,
      indexSize: stats.indexSize,
    };
  } catch {
    return {};
  }
}
