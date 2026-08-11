/* TrackNaija — push service worker.
 *
 * The sync server sends payload-less push pings (Content-Length 0). On each
 * ping we fetch the latest unread alert from the sync server and render the
 * notification here, so the content is always fresh.
 *
 * The sync-server URL is written to IndexedDB by the dashboard (so it works
 * even if the server is not on localhost); localhost:4173 is the fallback.
 *
 * Deployment note: service workers only register on secure contexts — https,
 * or http on localhost. In production the dashboard must be served over
 * https, and the sync server must also be https (a secure page cannot fetch
 * a plain-http sync server — mixed content). For local development on
 * localhost both http endpoints work fine.
 */
const DB_NAME = "tracknaija-sw";
const DB_STORE = "settings";
const DEFAULT_SERVER = "http://localhost:4173";

function getServerUrl() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(DB_STORE)) {
          open.result.createObjectStore(DB_STORE);
        }
      };
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction(DB_STORE, "readonly");
          const get = tx.objectStore(DB_STORE).get("serverUrl");
          get.onsuccess = () => resolve(get.result || DEFAULT_SERVER);
          get.onerror = () => resolve(DEFAULT_SERVER);
        } catch {
          resolve(DEFAULT_SERVER);
        }
      };
      open.onerror = () => resolve(DEFAULT_SERVER);
    } catch {
      resolve(DEFAULT_SERVER);
    }
  });
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const serverUrl = await getServerUrl();
      let alert = null;
      try {
        const res = await fetch(`${serverUrl}/api/alerts/latest`, { cache: "no-store" });
        const data = await res.json();
        alert = (data.alerts || []).find((a) => !a.read);
      } catch {
        /* server unreachable — still show a generic wake-up notification */
      }
      const title = alert
        ? `${alert.hostname} — TrackNaija`
        : "TrackNaija — device activity";
      const body = alert
        ? alert.body
        : "Something changed on one of your devices. Open the dashboard.";
      return self.registration.showNotification(title, {
        body,
        tag: alert ? `tracknaija-${alert.id}` : "tracknaija",
        renotify: false,
        silent: false,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/dashboard");
    })(),
  );
});
