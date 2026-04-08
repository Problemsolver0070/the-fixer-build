import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let _db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not configured");
    }
    const client = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      ...(process.env.NODE_ENV === "production" ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

// Backwards-compatible export for existing imports
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
  has(_, prop) {
    return prop in getDb();
  },
  ownKeys() {
    return Reflect.ownKeys(getDb());
  },
  getOwnPropertyDescriptor(_, prop) {
    return Object.getOwnPropertyDescriptor(getDb(), prop);
  },
});
