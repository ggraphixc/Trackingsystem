/**
 * Dravex storage — dual mode, same API contract.
 *
 *   Mode 1 (default): JSON file (data.json). Zero dependencies, works fully
 *   offline — perfect for the local sync server the desktop agent talks to.
 *
 *   Mode 2 (Neon Postgres): set DATABASE_URL and the same store object is
 *   persisted to a hosted, durable, serverless Postgres database instead.
 *   The `pg` package is optional — it is only loaded when DATABASE_URL is
 *   present (`npm i pg` in server/ when you wire up Neon).
 *
 * The store is a plain in-memory object (devices, pairCodes, alerts,
 * pushSubscriptions, …). load() hydrates it from the source and write()
 * flushes it back. Writes are debounced by the caller (server.js) and
 * serialized here so concurrent saves can never interleave.
 *
 * Postgres layout (auto-created on first connect):
 *
 *   CREATE TABLE IF NOT EXISTS dravex_kv (
 *     key   text PRIMARY KEY,
 *     value jsonb NOT NULL
 *   );
 *
 * One row ('store') holds the whole store blob as JSONB. This is the honest
 * bootstrap schema: it gives you durable hosted storage, point-in-time
 * recovery and a real database you can query with SQL from day one, while
 * keeping the server's API contract and in-memory model untouched. When the
 * schema needs to grow (per-device tables, indexes on fixes, etc.) you can
 * normalize out of this blob without changing a single route.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

/* ------------------------------- file mode ------------------------------- */

function createFileStorage() {
  return {
    mode: "file",
    describe: () => `JSON file (${DATA_FILE})`,

    load() {
      try {
        if (fs.existsSync(DATA_FILE)) {
          return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        }
      } catch (err) {
        console.error("Failed to load store:", err.message);
      }
      return null;
    },

    write(store) {
      try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
      } catch (err) {
        console.error("Failed to save store:", err.message);
      }
    },
  };
}

/* ------------------------------ postgres mode ---------------------------- */

function createPgStorage(url) {
  let Pool;
  try {
    // Lazily loaded: `pg` is an optionalDependency and must only exist when
    // someone actually points the server at a hosted database.
    ({ Pool } = require("pg"));
  } catch (err) {
    throw new Error(
      "DATABASE_URL is set but the `pg` driver is not installed. Run: npm i pg  (in server/)",
    );
  }

  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 });
  const ready = pool
    .query("CREATE TABLE IF NOT EXISTS dravex_kv (key text PRIMARY KEY, value jsonb NOT NULL)")
    .catch((err) => {
      console.error("Failed to initialise Neon schema:", err.message);
      throw err;
    });

  // Serialized write-through: every save is queued behind the previous one so
  // the database always converges to the latest store state, in order.
  let queue = Promise.resolve();

  return {
    mode: "neon",
    describe: () => {
      try {
        return `Neon Postgres (${new URL(url).host})`;
      } catch {
        return "Neon Postgres";
      }
    },

    async load() {
      await ready;
      const { rows } = await pool.query(
        "SELECT value FROM dravex_kv WHERE key = 'store'",
      );
      return rows.length ? rows[0].value : null;
    },

    write(store) {
      const blob = JSON.stringify(store);
      queue = queue
        .then(() =>
          pool.query(
            `INSERT INTO dravex_kv (key, value) VALUES ('store', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [blob],
          ),
        )
        .catch((err) => console.error("Neon write failed:", err.message));
    },
  };
}

/* ---------------------------------- api ---------------------------------- */

/**
 * @returns {{ mode: string, describe(): string, load(): Promise<object|null>, write(store: object): void }}
 */
function createStorage() {
  const url = process.env.DATABASE_URL;
  if (url) {
    console.log("Dravex storage: Neon Postgres mode (DATABASE_URL detected)");
    return createPgStorage(url);
  }
  console.log("Dravex storage: JSON file mode (set DATABASE_URL to use Neon)");
  return createFileStorage();
}

module.exports = { createStorage, DATA_FILE };
