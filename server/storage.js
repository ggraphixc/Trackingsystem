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
 * keeping the server's API contract and in-memory model untouched.
 *
 * Spatial layer (Phase 2 / PostGIS): coordinates are also mirrored into
 * `dravex_points` as geometry(Point,4326) rows (the latest fix + every
 * sighting per device), indexed with GiST, so "nearest device to a
 * sighting" runs as a real SQL distance query on Neon — the JSON-file mode
 * keeps the identical API via haversine. If PostGIS is unavailable on the
 * host (plain Postgres), the table degrades to double-precision columns and
 * a btree index without breaking anything.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

/* --------------------------- distance helpers ---------------------------- */

/** Haversine distance in meters — the file-mode twin of the PostGIS query. */
function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Nearest device coordinate (latest fix or a sighting) to a point. Same shape
 * as the Postgres/PostGIS path: { deviceId, kind, lat, lng, distMeters }.
 */
function nearestFixFile(store, lat, lng, maxMeters = 50000) {
  let best = null;
  for (const dev of Object.values(store.devices || {})) {
    const cands = [];
    if (dev.lastFix && Number.isFinite(dev.lastFix.lat) && Number.isFinite(dev.lastFix.lng)) {
      cands.push({ kind: "fix", lat: dev.lastFix.lat, lng: dev.lastFix.lng });
    }
    for (const s of dev.sightings || []) {
      if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) cands.push({ kind: "sighting", lat: s.lat, lng: s.lng });
    }
    for (const c of cands) {
      const dist = haversineM({ lat, lng }, c);
      if (dist <= maxMeters && (!best || dist < best.distMeters)) {
        best = { deviceId: dev.deviceId, kind: c.kind, lat: c.lat, lng: c.lng, distMeters: Math.round(dist) };
      }
    }
  }
  return best;
}

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

    /** File-mode distance query — identical contract to the Neon path. */
    nearestFix(store, lat, lng, maxMeters = 50000) {
      return nearestFixFile(store, lat, lng, maxMeters);
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

  // PostGIS availability is checked once; a non-PostGIS host degrades to
  // plain double-precision columns + a btree index (same API, less spatial).
  let postgis = false;

  async function ensureSpatial() {
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
      // Probe the actual functions — on some managed hosts (e.g. Neon before
      // PostGIS is enabled for the project) CREATE EXTENSION succeeds but the
      // geometry functions are not callable. Detect functionality, not intent.
      await pool.query("SELECT ST_SetSRID(ST_MakePoint(0, 0), 4326)::text");
      await pool.query("CREATE TABLE IF NOT EXISTS dravex_points (device_id text NOT NULL, kind text NOT NULL, lat double precision NOT NULL, lng double precision NOT NULL, point geometry(Point,4326) NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now())");
      await pool.query("CREATE INDEX IF NOT EXISTS dravex_points_geom_idx ON dravex_points USING gist (point)");
      // Scale Core (P3): time-ordered per-device queries need a btree on
      // (device_id, recorded_at) even in PostGIS mode — the GiST index serves
      // distance, not "fixes/sightings newest-first for one device".
      await pool.query("CREATE INDEX IF NOT EXISTS dravex_points_time_idx ON dravex_points (device_id, recorded_at)");
      postgis = true;
      console.log("Dravex storage: PostGIS spatial mirror enabled (GiST index on dravex_points)");
    } catch (_) {
      // Degraded: plain coordinate columns + btree. Same API contract.
      try {
        await pool.query("DROP TABLE IF EXISTS dravex_points");
      } catch (_) {
        /* ignore */
      }
      await pool.query("CREATE TABLE IF NOT EXISTS dravex_points (device_id text NOT NULL, kind text NOT NULL, lat double precision NOT NULL, lng double precision NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now())");
      await pool.query("CREATE INDEX IF NOT EXISTS dravex_points_flat_idx ON dravex_points (device_id, recorded_at)");
      postgis = false;
      console.log("Dravex storage: PostGIS unavailable — spatial mirror uses plain columns (haversine fallback)");
    }
  }

  // Mirror the store's coordinates into dravex_points so the latest fix and
  // every sighting per device are queryable by distance. Bounded upsert:
  // the latest fix per device, plus sightings newer than the stored ones.
  async function syncPoints(store) {
    const values = [];
    const params = [];
    for (const dev of Object.values(store.devices || {})) {
      const id = dev.deviceId;
      const lastFix = dev.lastFix;
      if (lastFix && Number.isFinite(lastFix.lat) && Number.isFinite(lastFix.lng)) {
        values.push(`($${params.length + 1}::text, 'fix', $${params.length + 2}::double precision, $${params.length + 3}::double precision, $${params.length + 4}::timestamptz)`);
        params.push(id, lastFix.lat, lastFix.lng, lastFix.receivedAt || lastFix.timestamp || new Date().toISOString());
      }
      for (const s of dev.sightings || []) {
        if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
          values.push(`($${params.length + 1}::text, 'sighting', $${params.length + 2}::double precision, $${params.length + 3}::double precision, $${params.length + 4}::timestamptz)`);
          params.push(id, s.lat, s.lng, s.receivedAt || s.at || new Date().toISOString());
        }
      }
    }
    // Full refresh per write: the store is the source of truth, the point
    // mirror is derived state. Blobs are small (≤100 fixes/50 sightings per
    // device), so a clean-slate rebuild keeps the mirror exact. The DELETE
    // runs even when there are no points left to write — otherwise an
    // emptied store would keep stale rows and /api/nearest could return a
    // device that no longer has any fix.
    await pool.query("DELETE FROM dravex_points");
    if (values.length === 0) return;
    if (postgis) {
      await pool.query(
        `INSERT INTO dravex_points (device_id, kind, lat, lng, point, recorded_at)
         SELECT d.device_id, d.kind, d.lat, d.lng, ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326), d.recorded_at
         FROM (VALUES ${values.join(",")}) AS d(device_id, kind, lat, lng, recorded_at)`,
        params,
      );
    } else {
      await pool.query(
        `INSERT INTO dravex_points (device_id, kind, lat, lng, recorded_at)
         SELECT d.device_id, d.kind, d.lat, d.lng, d.recorded_at
         FROM (VALUES ${values.join(",")}) AS d(device_id, kind, lat, lng, recorded_at)`,
        params,
      );
    }
  }

  /** Nearest fix/sighting row to a point, in meters (NULL when none within maxM). */
  async function nearestFixNeon(store, lat, lng, maxMeters = 50000) {
    if (postgis) {
      const { rows } = await pool.query(
        `SELECT device_id, kind, lat, lng,
                ST_Distance(point, ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326)) AS dist_m
         FROM dravex_points
         WHERE ST_DWithin(point, ST_SetSRID(ST_MakePoint($2::double precision, $1::double precision), 4326), $3::double precision)
         ORDER BY dist_m LIMIT 1`,
        [lat, lng, maxMeters],
      );
      const r = rows[0];
      return r
        ? { deviceId: r.device_id, kind: r.kind, lat: r.lat, lng: r.lng, distMeters: Math.round(r.dist_m) }
        : null;
    }
    // File mode / non-PostGIS: identical contract via haversine over the blob.
    return nearestFixFile(store, lat, lng, maxMeters);
  }

  // Retry the schema bootstrap: Neon poolers can hiccup on TLS handshake
  // (ECONNRESET) or cold-start — a server that exits on the first transient
  // failure would be down for no reason. Three attempts, backoff 1.5 s/3 s.
  const ready = (async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pool.query("CREATE TABLE IF NOT EXISTS dravex_kv (key text PRIMARY KEY, value jsonb NOT NULL)");
        await ensureSpatial();
        return;
      } catch (err) {
        lastErr = err;
        console.error(`Neon schema attempt ${attempt}/3 failed: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastErr;
  })().catch((err) => {
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
      if (rows.length) {
        // Backfill the spatial mirror so the PostGIS path is warm on boot.
        const loaded = rows[0].value;
        try {
          await syncPoints(loaded);
        } catch (err) {
          console.error("Neon spatial backfill failed:", err.message);
        }
        return loaded;
      }
      return null;
    },

    write(store) {
      const blob = JSON.stringify(store);
      queue = queue
        .then(async () => {
          await pool.query(
            `INSERT INTO dravex_kv (key, value) VALUES ('store', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [blob],
          );
          // Keep the spatial mirror exact after every persisted change.
          try {
            await syncPoints(store);
          } catch (err) {
            console.error("Neon spatial mirror failed:", err.message);
          }
        })
        .catch((err) => console.error("Neon write failed:", err.message));
    },

    nearestFix(store, lat, lng, maxMeters = 50000) {
      return queue.then(() => nearestFixNeon(store, lat, lng, maxMeters));
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
