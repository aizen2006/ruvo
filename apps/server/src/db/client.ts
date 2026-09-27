import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";
import * as schema from "./schema";

/** Shared connection pool. Workers and the API each create one per process. */
export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export { schema };
