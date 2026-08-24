import pg from 'pg';

const { Pool } = pg;

let poolInstance: any;

if (process.env.DATABASE_URL) {
  try {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    poolInstance.on('error', (err: any) => {
      console.warn('[AI Studio] Unexpected error on idle database client', err);
    });
  } catch (err) {
    console.warn('[AI Studio] DB connection failed — mock active', err);
    poolInstance = createMockPool();
  }
} else {
  console.info('[AI Studio] DATABASE_URL not set — using in-memory mock database');
  poolInstance = createMockPool();
}

function createMockPool() {
  const mockClient = {
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  };
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => mockClient,
  };
}

export const pool = poolInstance;

