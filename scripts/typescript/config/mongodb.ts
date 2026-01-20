/**
 * Centralized MongoDB Connection Configuration
 * 
 * Provides consistent MongoDB client connections for all test scripts.
 * Handles database name resolution and connection pooling.
 */

import { MongoClient, Db } from 'mongodb';

export interface MongoConfig {
  auth_service: string;
  payment_service: string;
  bonus_service: string;
  notification_service: string;
}

/**
 * Default MongoDB connection URIs for each service
 * Uses localhost with directConnection=true to avoid replica set discovery issues
 */
const DEFAULT_MONGO_URIS: MongoConfig = {
  auth_service: process.env.MONGO_URI_AUTH || 'mongodb://localhost:27017/auth_service?directConnection=true',
  payment_service: process.env.MONGO_URI_PAYMENT || 'mongodb://localhost:27017/payment_service?directConnection=true',
  bonus_service: process.env.MONGO_URI_BONUS || 'mongodb://localhost:27017/bonus_service?directConnection=true',
  notification_service: process.env.MONGO_URI_NOTIFICATION || 'mongodb://localhost:27017/notification_service?directConnection=true',
};

/**
 * Connection pool to reuse clients across script executions
 */
const clientPool = new Map<string, MongoClient>();

/**
 * Get MongoDB client for a specific service
 * Reuses existing connections when possible
 */
export async function getMongoClient(service: keyof MongoConfig): Promise<MongoClient> {
  const uri = DEFAULT_MONGO_URIS[service];
  
  // Check if we already have a client for this URI
  if (clientPool.has(uri)) {
    const existingClient = clientPool.get(uri)!;
    // Verify connection is still alive
    try {
      await existingClient.db().admin().ping();
      return existingClient;
    } catch (error) {
      // Connection is dead, remove it
      clientPool.delete(uri);
      await existingClient.close().catch(() => {});
    }
  }
  
  // Create new client
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  
  await client.connect();
  clientPool.set(uri, client);
  
  return client;
}

/**
 * Get MongoDB database for a specific service
 * Extracts database name from URI - simple and straightforward
 */
export async function getMongoDatabase(service: keyof MongoConfig): Promise<Db> {
  const client = await getMongoClient(service);
  // Extract database name from URI pathname
  const uri = DEFAULT_MONGO_URIS[service];
  const url = new URL(uri);
  let dbName = url.pathname.slice(1) || service.replace('_', '');
  
  // Remove query parameters if present
  if (dbName.includes('?')) {
    dbName = dbName.split('?')[0];
  }
  
  // Trim any whitespace (shouldn't be needed, but safety check)
  dbName = dbName.trim();
  
  // Use database name directly from URI
  return client.db(dbName);
}

/**
 * Close all MongoDB connections
 * Call this at the end of scripts to clean up
 */
export async function closeAllConnections(): Promise<void> {
  const closePromises = Array.from(clientPool.values()).map(client => 
    client.close().catch(() => {})
  );
  await Promise.all(closePromises);
  clientPool.clear();
}

/**
 * Get MongoDB client for auth_service database
 */
export async function getAuthClient(): Promise<MongoClient> {
  return getMongoClient('auth_service');
}

/**
 * Get MongoDB database for auth_service
 */
export async function getAuthDatabase(): Promise<Db> {
  return getMongoDatabase('auth_service');
}

/**
 * Get MongoDB client for payment_service database
 */
export async function getPaymentClient(): Promise<MongoClient> {
  return getMongoClient('payment_service');
}

/**
 * Get MongoDB database for payment_service
 */
export async function getPaymentDatabase(): Promise<Db> {
  return getMongoDatabase('payment_service');
}

/**
 * Get MongoDB client for bonus_service database
 */
export async function getBonusClient(): Promise<MongoClient> {
  return getMongoClient('bonus_service');
}

/**
 * Get MongoDB database for bonus_service
 */
export async function getBonusDatabase(): Promise<Db> {
  return getMongoDatabase('bonus_service');
}

/**
 * Get MongoDB client for notification_service database
 */
export async function getNotificationClient(): Promise<MongoClient> {
  return getMongoClient('notification_service');
}

/**
 * Get MongoDB database for notification_service
 */
export async function getNotificationDatabase(): Promise<Db> {
  return getMongoDatabase('notification_service');
}
