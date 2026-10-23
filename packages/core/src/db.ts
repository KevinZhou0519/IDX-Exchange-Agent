// Read-only MySQL access for the agent. Every query is a Sql value: SQL text
// with ? placeholders plus its parameters, never user text spliced into SQL.
import mysql from "mysql2/promise";

export type Sql = { sql: string; params: (string | number)[] };

export type Db = {
  query<T = Record<string, unknown>>(q: Sql): Promise<T[]>;
  close(): Promise<void>;
};

export type DbConfig = { host?: string; user?: string; password?: string; database?: string };

export function createDb(config: DbConfig = {}): Db {
  const pool = mysql.createPool({
    host: config.host ?? process.env.MYSQL_HOST ?? "localhost",
    user: config.user ?? process.env.MYSQL_USER ?? "idx_user",
    password: config.password ?? process.env.MYSQL_PASSWORD ?? "",
    database: config.database ?? process.env.MYSQL_DATABASE ?? "idx_exchange",
    connectionLimit: 5,
    charset: "utf8mb4",
  });
  return {
    async query<T>(q: Sql) {
      const [rows] = await pool.execute(q.sql, q.params);
      return rows as T[];
    },
    close: () => pool.end(),
  };
}

/** True when the database answers a trivial query (tests skip otherwise). */
export async function dbAvailable(db: Db): Promise<boolean> {
  try {
    await db.query({ sql: "SELECT 1", params: [] });
    return true;
  } catch {
    return false;
  }
}
