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
import { logger } from './logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

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

export async function connectDatabase(uri: string, config: Partial<MongoConfig> = {}): Promise<Db> {
  if (db) return db;

  const cfg = { ...DEFAULT_MONGO_CONFIG, ...config };
  
  const readPrefMap = {
    primary: ReadPreference.PRIMARY,
    secondary: ReadPreference.SECONDARY_PREFERRED,
    nearest: ReadPreference.NEAREST,
  };

  client = new MongoClient(uri, {
    maxPoolSize: cfg.maxPoolSize,
    minPoolSize: cfg.minPoolSize,
    connectTimeoutMS: cfg.connectTimeoutMS,
    socketTimeoutMS: cfg.socketTimeoutMS,
    serverSelectionTimeoutMS: cfg.serverSelectionTimeoutMS,
    readPreference: readPrefMap[cfg.readPreference || 'nearest'],
    writeConcern: new WriteConcern(cfg.writeConcern || 'majority'),
    retryWrites: cfg.retryWrites,
    retryReads: cfg.retryReads,
  });

  // Connection events
  client.on('connectionPoolCreated', () => logger.debug('MongoDB pool created'));
  client.on('connectionPoolClosed', () => logger.debug('MongoDB pool closed'));
  client.on('connectionCheckedOut', () => logger.debug('MongoDB connection checked out'));
  
  await client.connect();
  
  const dbName = cfg.dbName || new URL(uri).pathname.slice(1) || 'default';
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
    logger.info('MongoDB disconnected');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════

export async function checkDatabaseHealth(): Promise<{ healthy: boolean; latencyMs: number; connections: number }> {
  if (!db || !client) {
    return { healthy: false, latencyMs: -1, connections: 0 };
  }

  const start = Date.now();
  try {
    await db.command({ ping: 1 });
    const latencyMs = Date.now() - start;
    
    // Get connection pool stats
    // @ts-ignore - accessing internal for monitoring
    const poolSize = client.topology?.s?.pool?.totalConnectionCount || 0;
    
    return { 
      healthy: true, 
      latencyMs,
      connections: poolSize,
    };
  } catch {
    return { healthy: false, latencyMs: -1, connections: 0 };
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
