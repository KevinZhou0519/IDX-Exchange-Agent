// One-time local database setup, safe to run again:
// - creates the agent's read-only MySQL user idx_user@localhost (no password,
//   local connections only, SELECT on idx_exchange only)
// - adds an index on california_sold (City, CloseDate) for sold-comps queries
//
// Connects as an admin user: MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD
// (default root with no password, the local Homebrew install).
// Usage: corepack pnpm setup:db
import mysql from "mysql2/promise";

const database = process.env.MYSQL_DATABASE ?? "idx_exchange";
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "localhost",
  user: process.env.MYSQL_ADMIN_USER ?? "root",
  password: process.env.MYSQL_ADMIN_PASSWORD ?? "",
  database,
});

try {
  const [users] = await connection.query(
    "SELECT COUNT(*) AS n FROM mysql.user WHERE user = 'idx_user' AND host = 'localhost'",
  );
  if (Number((users as { n: number }[])[0].n) === 0) {
    await connection.query("CREATE USER 'idx_user'@'localhost' IDENTIFIED BY ''");
    console.log("created user idx_user@localhost");
  } else {
    console.log("user idx_user@localhost already present");
  }
  // GRANT is idempotent; the database name cannot be a placeholder.
  await connection.query(`GRANT SELECT ON \`${database}\`.* TO 'idx_user'@'localhost'`);
  console.log(`granted SELECT on ${database} (read-only)`);

  const [indexes] = await connection.query(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'california_sold' AND INDEX_NAME = 'idx_sold_city_date'",
    [database],
  );
  if (Number((indexes as { n: number }[])[0].n) === 0) {
    await connection.query("CREATE INDEX idx_sold_city_date ON california_sold (City, CloseDate)");
    console.log("created index idx_sold_city_date on california_sold (City, CloseDate)");
  } else {
    console.log("index idx_sold_city_date already present");
  }
} finally {
  await connection.end();
}
