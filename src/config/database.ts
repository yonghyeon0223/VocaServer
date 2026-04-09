import dns from 'dns';
import { MongoClient, type Db } from 'mongodb';
import { logger } from '../shared/logger.js';

// Node.js's default DNS resolver can't handle SRV lookups on some networks.
// Setting Google DNS as fallback ensures mongodb+srv:// URIs resolve correctly.
dns.setServers(['8.8.8.8', '8.8.4.4']);

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDatabase(uri: string, dbName: string): Promise<Db> {
  client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000,
    writeConcern: { w: 'majority' },
  });

  await client.connect();
  db = client.db(dbName);

  // Verify the connection works
  await db.admin().command({ ping: 1 });
  logger.info({ dbName }, 'Connected to MongoDB');

  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectDatabase() first.');
  }
  return db;
}

export function getClient(): MongoClient {
  if (!client) {
    throw new Error('Database not initialized. Call connectDatabase() first.');
  }
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed');
  }
}
