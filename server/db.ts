import pg from 'pg';

const { Pool } = pg;

let poolInstance: any;

function createMockPool() {
  const mockClient = {
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  };
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => mockClient,
    on: () => {},
  };
}

if (process.env.DATABASE_URL) {
  try {
    // Disable SSL for local/internal hosts (localhost, 127.0.0.1, compose
    // service names like "db"); only use SSL for remote managed databases.
    let dbHost = '';
    try {
      dbHost = new URL(process.env.DATABASE_URL).hostname;
    } catch {
      dbHost = '';
    }
    const isLocalDb =
      dbHost === 'localhost' ||
      dbHost === '127.0.0.1' ||
      dbHost === 'db';
    const realPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isLocalDb ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    realPool.on('error', (err: any) => {
      console.warn('[AI Studio] Unexpected error on idle database client', err);
    });

    const mockPool = createMockPool();

    poolInstance = {
      query: async (...args: any[]) => {
        try {
          return await (realPool as any).query(...args);
        } catch (err) {
          console.warn('[AI Studio] Database query failed — fallback to mock', err);
          return await mockPool.query(...args);
        }
      },
      connect: async () => {
        try {
          return await realPool.connect();
        } catch (err) {
          console.warn('[AI Studio] Database connect failed — fallback to mock client', err);
          return await mockPool.connect();
        }
      },
      on: (event: string, listener: any) => {
        realPool.on(event, listener);
      },
      end: async () => {
        try {
          await realPool.end();
        } catch (err) {
          console.warn('[AI Studio] Database pool end failed', err);
        }
      },
    };
  } catch (err) {
    console.warn('[AI Studio] DB connection failed — mock active', err);
    poolInstance = createMockPool();
  }
} else {
  console.info('[AI Studio] DATABASE_URL not set — using in-memory mock database');
  poolInstance = createMockPool();
}

export const pool = poolInstance;

