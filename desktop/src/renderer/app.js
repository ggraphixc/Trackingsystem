/* TrackNaija — tracking dashboard renderer (Electron, preload bridge). */
(function () {
  const api = window.tracknaija;
  if (!api) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:monospace">Preload bridge missing — run via Electron, not a browser.</p>';
    return;
  }

  const $ = (id) => document.getElementById(id);
  let state = {};
  let devices = [];
  let alerts = [];

  /* ================= navigation ================= */

  const VIEW_META = {
    overview: { title: "Overview", sub: "Live tracking at a glance" },
    devices: { title: "Devices", sub: "Every phone and laptop you protect" },
    map: { title: "Map", sub: "Device fixes and community sightings" },
    finder: { title: "Find nearby", sub: "Bluetooth relay — hear lost beacons" },
    alerts: { title: "Alerts", sub: "Reconnects, SIM changes, sightings" },
    settings: { title: "Settings", sub: "Server link, sync and protection" },
  };

  function switchView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    const view = document.getElementById("view-" + name);
    if (view) view.classList.add("active");
    const item = document.querySelector(`.nav-item[data-view="${name}"]`);
    if (item) item.classList.add("active");
    const meta = VIEW_META[name] || VIEW_META.overview;
    $("view-title").textContent = meta.title;
    $("view-subtitle").textContent = meta.sub;
    if (name === "devices") refreshDevices();
    if (name === "map") { initMap(); renderMap(); }
    if (name === "alerts") refreshAlerts();
  }

  function renderNavBadges() {
    const lostCount = devices.filter((d) => d.lost).length;
    const badge = $("devices-badge");
    if (lostCount > 0) {
      badge.textContent = lostCount;
      badge.classList.add("nav-badge-danger");
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
    const unread = alerts.filter((a) => !a.read).length;
    const ac = $("alert-count");
    if (unread > 0) {
      ac.textContent = unread;
      ac.classList.remove("hidden");
    } else {
      ac.classList.add("hidden");
    }
  }

  /* ================= init ================= */

  async function init() {
    state = (await api.getState()) || {};
    const info = await api.getDeviceInfo();

    $("device-hostname").textContent = info.hostname;
    $("device-serial").textContent = info.serialNumber || "—";
    $("device-os").textContent = `${info.platformLabel} ${info.release}`;
    $("device-specs").textContent = `${info.cpu} · ${info.totalMemGb} GB`;
    $("device-uptime").textContent = `${info.uptimeH} h`;
    $("device-platform").textContent = info.platformLabel;

    $("lost-toggle").checked = !!state.lostMode;
    $("autostart-toggle").checked = !!state.autoStart;

    if (state.lastFix) renderFix(state.lastFix);
    else refreshLocation();

    wireEvents();
    refreshLinkStatus();
    refreshVault();
    refreshDevices();
    refreshAlerts();

    setInterval(refreshVault, 30000);
    setInterval(refreshDevices, 20000); // devices stay live in the background
  }

  /* ================= offline vault ================= */

  async function refreshVault() {
    const v = (await api.vaultStatus()) || { pending: 0, evidence: 0 };
    $("vault-status").textContent =
      v.pending > 0
        ? `Offline vault: ${v.pending} pending (${v.evidence} evidence) — uploads automatically when this machine can reach the server`
        : "Offline vault: empty — captured fixes and evidence are stored locally without internet and uploaded on reconnect.";
  }

  /* ================= link to dashboard ================= */

  async function refreshLinkStatus() {
    const status = (await api.linkStatus()) || {};
    $("server-url").value = status.serverUrl || "http://localhost:4173";
    const chip = $("link-status");
    if (status.linked) {
      chip.textContent = "Linked";
      chip.className = "chip chip-success";
      $("link-note").textContent =
        "Linked as " + String(status.deviceId || "").slice(0, 8) + " — fixes, evidence and commands stream to the dashboard.";
    } else {
      chip.textContent = "Not linked";
      chip.className = "chip chip-blue";
      $("link-note").textContent = status.online
        ? "Server reachable. Enter a pairing code from the dashboard's Agents page."
        : "Enter your sync server URL and test the connection.";
    }

    // Sidebar chip: dot color reflects online + linked.
    const dot = $("link-dot");
    dot.classList.toggle("linked", !!status.linked);
    dot.classList.toggle("online", !status.linked && !!status.online);
    $("link-chip-text").textContent = status.linked
      ? "Linked to dashboard"
      : status.online
        ? "Server online — not linked"
        : "Not linked";
  }

  async function testServer() {
    const result = await api.setServer($("server-url").value.trim());
    if (result && result.serverOnline) {
      $("link-note").textContent = "Server online — enter the pairing code to link this agent.";
      return true;
    }
    $("link-note").textContent = "Server unreachable. Start it with: cd server && npm start";
    return false;
  }

  async function linkAgent() {
    $("btn-link").disabled = true;
    $("btn-link").textContent = "Linking…";
    await api.setServer($("server-url").value.trim());
    const result = await api.claim($("pair-code").value);
    $("btn-link").disabled = false;
    $("btn-link").textContent = "Link agent";
    if (result && result.ok) {
      $("pair-code").value = "";
      refreshLinkStatus();
      refreshDevices();
    } else {
      $("link-note").textContent = (result && result.error) || "Pairing failed — is the sync server running?";
    }
  }

  /* ================= location / signal ladder ================= */

  function renderFix(fix) {
    if (!fix) return;
    const map = $("map");
    map.classList.add("has-fix");
    $("map-coords").textContent = `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}° · ${fix.source}`;

    document.querySelectorAll(".ladder-row").forEach((row) => row.classList.remove("current"));
    const current = document.querySelector(`.ladder-row[data-source="${fix.source}"]`);
    if (current) current.classList.add("current");

    const time = fix.timestamp ? new Date(fix.timestamp).toLocaleTimeString() : "just now";
    const lastInfo = fix.lastKnownFrom ? ` (from ${new Date(fix.lastKnownFrom).toLocaleTimeString()})` : "";

    if (fix.source === "wifi") {
      $("ladder-wifi-detail").textContent = `${fix.networks ?? 0} network${fix.networks === 1 ? "" : "s"} seen · ±${fix.accuracy} m`;
      $("ladder-ip-detail").textContent = fix.ipAddress ? `IP ${fix.ipAddress}` : "No IP lookup yet";
      $("ladder-last-detail").textContent = "—";
    } else if (fix.source === "ip") {
      $("ladder-wifi-detail").textContent = "No Wi-Fi networks found";
      $("ladder-ip-detail").textContent = `${fix.ipAddress || "unknown IP"} · ±${fix.accuracy} m`;
      $("ladder-last-detail").textContent = "—";
    } else {
      $("ladder-wifi-detail").textContent = "No scan yet";
      $("ladder-ip-detail").textContent = "No lookup yet";
      $("ladder-last-detail").textContent = `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}°${lastInfo}`;
    }

    $("fix-meta").textContent =
      `Confidence ${fix.confidence}% · updated ${time}${state.lostMode ? " · LOST MODE ACTIVE" : ""}`;
    $("last-update").textContent = `last fix ${time}`;
  }

  async function refreshLocation() {
    $("btn-track").disabled = true;
    $("btn-track").textContent = "Locating…";
    const fix = await api.trackNow();
    if (fix) renderFix(fix);
    $("btn-track").disabled = false;
    $("btn-track").textContent = "Locate now";
  }

  /* ================= devices ================= */

  const TYPE_LABEL = { phone: "Phone", laptop: "Laptop" };

  function timeAgo(iso) {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return new Date(iso).toLocaleDateString();
  }

  function deviceName(d) {
    if (d.hostname) return d.hostname;
    const id = d.deviceId || "";
    return id ? "Device " + id.slice(0, 6).toUpperCase() : "Unknown";
  }

  function deviceIdCode(d) {
    if (d.type === "phone" && d.imei) return `IMEI ${d.imei}`;
    if (d.serialNumber) return d.serialNumber;
    return "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function refreshDevices() {
    const res = await api.listDevices();
    const linked = res && res.ok;
    if (!linked) {
      $("devices-body").innerHTML =
        '<tr><td colspan="6" class="table-empty">Link this agent to your dashboard (Settings) to see all devices.</td></tr>';
      $("devices-foot").textContent = "";
      devices = [];
      renderNavBadges();
      renderStats();
      return;
    }
    devices = res.devices || [];
    $("devices-body").innerHTML = devices
      .map((d) => {
        const name = escapeHtml(deviceName(d));
        const code = escapeHtml(deviceIdCode(d));
        const type = d.type === "phone" ? "Phone" : "Laptop";
        const chip = d.lost
          ? '<span class="chip chip-danger">● Lost</span>'
          : d.lastSeenAt
            ? '<span class="chip chip-success">● Online</span>'
            : '<span class="chip chip-gray">Offline</span>';
        const sightings = d.sightingCount || 0;
        const sight = sightings > 0
          ? `<button class="btn-icon sightings" data-sightings="${escapeHtml(d.deviceId)}" title="Community sightings for this device">👁 ${sightings}</button>`
          : "";
        const evidence = d.evidenceCount || 0;
        const ev = evidence > 0
          ? `<button class="btn-icon evidence" data-evidence-id="${escapeHtml(d.deviceId)}" title="Captured evidence photos">📷 ${evidence}</button>`
          : "";
        return `<tr>
          <td>
            <div class="device-cell">
              <strong>${name}</strong>
              <small>${code || escapeHtml(d.deviceId || "")}</small>
            </div>
          </td>
          <td><span class="chip ${d.type === "phone" ? "chip-blue" : "chip-amber"}">${type}</span></td>
          <td>${escapeHtml(d.operator || "—")}</td>
          <td class="mono" style="font-size:12px">${timeAgo(d.lastSeenAt)}</td>
          <td>${chip}</td>
          <td class="td-right">
            <button class="btn-lost ${d.lost ? "lost" : ""}" data-lost-id="${escapeHtml(d.deviceId)}" data-lost="${d.lost ? "1" : "0"}">
              ${d.lost ? "Lost — click to find" : "Mark lost"}
            </button>
            ${sight}${ev}
          </td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="6" class="table-empty">No devices paired yet.</td></tr>';

    const lost = devices.filter((d) => d.lost).length;
    $("devices-foot").textContent =
      `${devices.length} device${devices.length === 1 ? "" : "s"} protected · ${lost} lost` +
      (devices.length === 0 ? " — generate a pairing code on the web dashboard's Agents page and enter it in Settings." : "");

    document.querySelectorAll("[data-lost-id]").forEach((btn) => {
      btn.addEventListener("click", () => toggleDeviceLost(btn));
    });
    document.querySelectorAll("[data-sightings]").forEach((btn) => {
      btn.addEventListener("click", () => showSightings(btn.getAttribute("data-sightings")));
    });
    document.querySelectorAll("[data-evidence-id]").forEach((btn) => {
      btn.addEventListener("click", () => openEvidence(btn.getAttribute("data-evidence-id")));
    });

    renderNavBadges();
    renderStats();
    // Keep the map fresh if it's the active view (polling path stays live).
    if (map && document.getElementById("view-map").classList.contains("active")) renderMap();
  }

  async function toggleDeviceLost(btn) {
    const id = btn.getAttribute("data-lost-id");
    const next = btn.getAttribute("data-lost") !== "1";
    btn.disabled = true;
    const res = await api.setDeviceLost(id, next);
    btn.disabled = false;
    if (res && res.ok) {
      btn.setAttribute("data-lost", next ? "1" : "0");
      btn.classList.toggle("lost", next);
      btn.textContent = next ? "Lost — click to find" : "Mark lost";
      const dev = devices.find((d) => d.deviceId === id);
      if (dev) dev.lost = next;
      renderNavBadges();
      renderStats();
    }
  }

  async function showSightings(deviceId) {
    const res = await api.getSightings(deviceId);
    const list = (res && res.sightings) || [];
    const dev = devices.find((d) => d.deviceId === deviceId);
    const name = deviceName(dev || {});
    if (list.length === 0) {
      alert(`No community sightings for ${name} yet.\n\nSightings appear when another TrackNaija device hears its beacon nearby — while it is marked lost.`);
      return;
    }
    const lines = list
      .map(
        (s) =>
          `${s.receivedAt ? new Date(s.receivedAt).toLocaleString() : "?"}  ·  ${Number(s.lat).toFixed(4)}°, ${Number(s.lng).toFixed(4)}°` +
          (s.accuracy ? `  (±${s.accuracy}m)` : ""),
      )
      .join("\n");
    alert(`Community sightings — ${name}\n\n${lines}`);
  }

  /* ================= overview stats ================= */

  function renderStats() {
    $("stat-devices").textContent = devices.length;
    $("stat-lost").textContent = devices.filter((d) => d.lost).length;
    $("stat-sightings").textContent = devices.reduce((n, d) => n + (d.sightingCount || 0), 0);
  }

  /* ================= map view ================= */

  let map = null;
  let markerLayer = null;
  let tileErrors = 0;
  const NIGERIA_CENTER = [9.08, 8.68];

  function initMap() {
    if (map) return;
    map = L.map("map-canvas", { zoomControl: true }).setView(NIGERIA_CENTER, 6);
    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    tiles.on("tileerror", () => {
      tileErrors++;
      if (tileErrors === 3) {
        $("map-note").textContent =
          "Map tiles need internet — showing positions on the grid instead. Markers are still accurate.";
      }
    });
    tiles.addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  function devicePinClass(d) {
    if (d.lost) return "pin pin-lost";
    return d.type === "phone" ? "pin pin-phone" : "pin pin-laptop";
  }

  function devicePopup(d, fix) {
    const tag = d.lost ? '<span class="popup-tag lost">● LOST</span>' : '<span class="popup-tag safe">Safe</span>';
    const time = fix.timestamp ? new Date(fix.timestamp).toLocaleString() : timeAgo(d.lastSeenAt);
    const code = escapeHtml(deviceIdCode(d));
    return `<div>
      <p class="popup-title">${escapeHtml(deviceName(d))}</p>
      <p class="popup-meta"><b>${d.type === "phone" ? "Phone" : "Laptop"}</b>${d.operator ? " · " + escapeHtml(d.operator) : ""}</p>
      <p class="popup-meta">${Number(fix.lat).toFixed(5)}°, ${Number(fix.lng).toFixed(5)}° · ±${fix.accuracy || "?"} m</p>
      <p class="popup-meta">${escapeHtml(fix.source)} · ${time}</p>
      ${code ? `<p class="popup-meta">${code}</p>` : ""}
      ${tag}
    </div>`;
  }

  function sightingPopup(s) {
    const t = s.receivedAt ? new Date(s.receivedAt).toLocaleString() : "?";
    return `<div>
      <p class="popup-title">Community sighting</p>
      <p class="popup-meta">${Number(s.lat).toFixed(5)}°, ${Number(s.lng).toFixed(5)}°${s.accuracy ? ` · ±${s.accuracy} m` : ""}</p>
      <p class="popup-meta">beacon ${escapeHtml(s.beacon || "")} · ${t}</p>
      <span class="popup-tag sighting">● Seen by another TrackNaija device</span>
    </div>`;
  }

  let mapRendering = false;

  async function renderMap() {
    if (!map || mapRendering) return;
    mapRendering = true;
    try {
      await paintMap();
    } finally {
      mapRendering = false;
    }
  }

  async function paintMap() {
    markerLayer.clearLayers();
    const points = [];
    const addPoint = (ll) => points.push(ll);

    // This machine's own last-known fix.
    if (state.lastFix) {
      const fix = state.lastFix;
      const ll = [fix.lat, fix.lng];
      addPoint(ll);
      L.marker(ll, { icon: L.divIcon({ className: "pin pin-laptop", iconSize: [18, 18], iconAnchor: [9, 9] }) })
        .bindPopup(
          `<div><p class="popup-title">This machine</p><p class="popup-meta">${Number(fix.lat).toFixed(5)}°, ${Number(fix.lng).toFixed(5)}° · ${escapeHtml(fix.source)}</p></div>`,
        )
        .addTo(markerLayer);
    }

    // Device markers first, then fetch sightings for every device that has
    // them in parallel (avoids serial N+1 round-trips).
    for (const d of devices) {
      const fix = d.lastFix;
      if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)) {
        const ll = [fix.lat, fix.lng];
        addPoint(ll);
        L.marker(ll, { icon: L.divIcon({ className: devicePinClass(d), iconSize: [18, 18], iconAnchor: [9, 9] }) })
          .bindPopup(devicePopup(d, fix))
          .addTo(markerLayer);
      }
    }
    const withSightings = devices.filter((d) => (d.sightingCount || 0) > 0);
    const sightingLists = await Promise.all(
      withSightings.map(async (d) => {
        const res = await api.getSightings(d.deviceId);
        return (res && res.sightings) || [];
      }),
    );
    for (const list of sightingLists) {
      for (const s of list) {
        if (!Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lng))) continue;
        const ll = [Number(s.lat), Number(s.lng)];
        addPoint(ll);
        L.marker(ll, { icon: L.divIcon({ className: "pin pin-sighting", iconSize: [12, 12], iconAnchor: [6, 6] }) })
          .bindPopup(sightingPopup(s))
          .addTo(markerLayer);
      }
    }

    if (points.length > 0) {
      // maxZoom keeps single-device / co-located markers from zooming to
      // street level (degenerate bounds would otherwise fit at maxZoom 19).
      map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 16 });
      $("map-note").textContent =
        `${devices.length} device${devices.length === 1 ? "" : "s"} · ${points.length} location${points.length === 1 ? "" : "s"} plotted`;
    } else {
      map.setView(NIGERIA_CENTER, 6);
      $("map-note").textContent =
        "No positions yet — fixes and sightings appear here as devices report in. Map tiles need internet; markers are accurate either way.";
    }
    map.invalidateSize();
  }

  /* ================= evidence gallery ================= */

  let evidenceReq = 0; // guards rapid clicks: only the latest request paints

  async function openEvidence(deviceId) {
    const dev = devices.find((d) => d.deviceId === deviceId);
    $("evidence-modal-title").textContent = `Evidence — ${deviceName(dev || {})}`;
    const grid = $("evidence-grid");
    grid.innerHTML = '<p class="evidence-empty">Loading photos…</p>';
    $("evidence-modal").classList.remove("hidden");

    const token = ++evidenceReq;
    const res = await api.getEvidence(deviceId);
    if (token !== evidenceReq) return; // a newer request superseded this one
    const list = (res && res.evidence) || [];
    if (list.length === 0) {
      grid.innerHTML =
        '<p class="evidence-empty">No photos captured yet. Webcam evidence appears here when lost mode arms the camera.</p>';
      return;
    }
    grid.innerHTML = list
      .map((e) => {
        const t = e.capturedAt || e.receivedAt;
        const label = t ? new Date(t).toLocaleString() : "";
        return `<div class="evidence-thumb" data-evidence-src="${escapeHtml(e.dataUrl)}" data-evidence-time="${escapeHtml(t || "")}" title="${escapeHtml(label)}">
          <img src="${escapeHtml(e.dataUrl)}" alt="Evidence captured ${escapeHtml(label)}" />
          <span class="thumb-time">${escapeHtml(label)}</span>
        </div>`;
      })
      .join("");
    grid.querySelectorAll("[data-evidence-src]").forEach((thumb) => {
      thumb.addEventListener("click", () =>
        openLightbox(thumb.getAttribute("data-evidence-src"), thumb.getAttribute("data-evidence-time")),
      );
    });
  }

  function closeEvidence() {
    $("evidence-modal").classList.add("hidden");
    $("evidence-grid").innerHTML = "";
  }

  function openLightbox(src, time) {
    $("lightbox-img").src = src;
    $("lightbox-caption").textContent = time ? `captured ${time}` : "";
    $("lightbox").classList.remove("hidden");
  }

  function closeLightbox() {
    $("lightbox").classList.add("hidden");
    $("lightbox-img").src = "";
  }

  /* ================= find nearby (BLE) ================= */

  let scanning = false;

  async function startScan() {
    if (scanning) return;
    scanning = true;
    $("btn-scan").disabled = true;
    $("btn-scan").textContent = "Scanning…";
    $("scan-status").innerHTML = '<span class="scan-spinner"></span> Sweeping for TrackNaija beacons…';
    $("scan-results").innerHTML = "";

    const duration = Number($("scan-duration").value || 15);
    const res = await api.scanNearby(duration);

    $("btn-scan").disabled = false;
    $("btn-scan").textContent = "Start sweep";
    scanning = false;

    if (!res || !res.supported) {
      $("scan-status").textContent =
        "Bluetooth scanning is only supported on Windows with a Bluetooth radio. On macOS/Linux this machine can still find its own position.";
      $("scan-results").innerHTML = "";
      return;
    }

    const beacons = res.beacons || [];
    if (beacons.length === 0) {
      $("scan-status").textContent =
        res.reason === "unsupported"
          ? "Sweep finished — no TrackNaija beacons heard. (Bluetooth adapter unavailable: " + (res.reason || "unknown") + ")"
          : "Sweep finished — no TrackNaija beacons in range. Lost phones near you broadcast one; keep this dashboard open and sweep again.";
      $("scan-results").innerHTML =
        '<div class="scan-empty">No beacons heard. If a lost device is nearby, its beacon will show up here.</div>';
      return;
    }

    $("scan-status").textContent =
      `Heard ${beacons.length} beacon${beacons.length === 1 ? "" : "s"}` +
      (res.reported ? ` — ${res.reported} sighting${res.reported === 1 ? "" : "s"} reported to your dashboard` : "") +
      (res.at ? ` from ${Number(res.at.lat).toFixed(4)}°, ${Number(res.at.lng).toFixed(4)}°` : "") +
      ".";
    $("scan-results").innerHTML = beacons
      .map(
        (b) => `<div class="scan-beacon">
          <span class="scan-spinner" style="border-top-color:var(--violet)"></span>
          <div>
            <div class="beacon-id">${escapeHtml(b.beacon)}</div>
            <div class="beacon-meta">TrackNaija beacon · ${b.rssi ?? "?"} dBm</div>
          </div>
        </div>`,
      )
      .join("");
  }

  /* ================= alerts ================= */

  function alertClass(type) {
    return type === "sim_change" ? "sim_change" : type === "sighting" ? "sighting" : "reconnect";
  }

  function alertTitle(a) {
    const host = a.hostname ? " " + a.hostname : "";
    switch (a.type) {
      case "sim_change":
        return "SIM change detected" + host;
      case "sighting":
        return "Seen by the community" + host;
      default:
        return "Device reconnected" + host;
    }
  }

  function upsertAlert(a) {
    if (!a || !a.id) return;
    const i = alerts.findIndex((x) => x.id === a.id);
    if (i >= 0) alerts[i] = a;
    else alerts.unshift(a);
    renderAlerts();
    renderNavBadges();
  }

  function renderAlerts() {
    if (alerts.length === 0) {
      $("alerts-feed").innerHTML = '<p class="table-empty">No alerts yet. Reconnects, SIM changes and sightings appear here.</p>';
      return;
    }
    $("alerts-feed").innerHTML = alerts
      .map(
        (a) => `<div class="alert-item ${alertClass(a.type)}">
          <div class="alert-item-body">
            <p class="alert-item-title">${escapeHtml(alertTitle(a))}</p>
            <p>${escapeHtml(a.body || "")}</p>
          </div>
          <span class="alert-item-time">${a.at ? new Date(a.at).toLocaleString() : ""}</span>
        </div>`,
      )
      .join("");
  }

  async function refreshAlerts() {
    const res = await api.getAlerts();
    if (!res || !res.ok) return;
    const incoming = res.alerts || [];
    let changed = false;
    for (const a of incoming) {
      if (!alerts.some((x) => x.id === a.id)) {
        alerts.push(a);
        changed = true;
      }
    }
    if (changed) {
      renderAlerts();
      renderNavBadges();
    }
  }

  async function clearAllAlerts() {
    await api.markAlertRead();
    alerts = alerts.map((a) => ({ ...a, read: true }));
    renderNavBadges();
  }

  /* ================= alert banner (pushed live) ================= */

  function showAlertBanner(alert) {
    if (!alert) return;
    $("alert-banner-text").textContent = alert.body || alertTitle(alert);
    const banner = $("alert-banner");
    banner.classList.toggle("danger", alert.type === "sim_change");
    banner.classList.toggle("info", alert.type !== "sim_change" && alert.type !== "sighting");
    banner.classList.toggle("violet", alert.type === "sighting");
    banner.classList.remove("hidden");
    upsertAlert(alert);
  }

  /* ================= lost mode ================= */

  function updateStatusChip(on) {
    const chip = $("status-chip");
    const quick = $("lost-quick");
    if (on) {
      chip.textContent = "● LOST MODE — webcam armed";
      chip.className = "chip chip-danger";
      quick.classList.remove("hidden");
    } else {
      chip.textContent = "● Agent running";
      chip.className = "chip chip-success";
      quick.classList.add("hidden");
    }
  }

  async function toggleLost(on) {
    state = (await api.setLostMode(on)) || state;
    updateStatusChip(!!state.lostMode);
  }

  /* ================= webcam ================= */

  let stream = null;
  async function startWebcam() {
    $("webcam").classList.remove("hidden");
    $("webcam-note").classList.add("hidden");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      $("webcam-video").srcObject = stream;
      $("btn-shoot").disabled = false;
    } catch (err) {
      $("webcam").classList.add("hidden");
      alert("Could not open the webcam. " + (err.message || err));
    }
  }

  function snapPhoto() {
    const video = $("webcam-video");
    const canvas = $("webcam-canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.classList.remove("hidden");
    video.classList.add("hidden");
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    api.webcamCaptured(dataUrl).catch(() => {});
    $("webcam-note").textContent =
      "Photo captured and saved as evidence — uploaded to your dashboard now (or held offline until this machine reconnects).";
    $("webcam-note").classList.remove("hidden");
  }

  function stopWebcam() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    $("webcam").classList.add("hidden");
    $("webcam-video").srcObject = null;
    $("webcam-video").classList.remove("hidden");
    $("webcam-canvas").classList.add("hidden");
    $("webcam-note").classList.add("hidden");
  }

  /* ================= events ================= */

  function wireEvents() {
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => switchView(item.getAttribute("data-view")));
    });

    $("btn-track").addEventListener("click", refreshLocation);
    $("lost-toggle").addEventListener("change", (e) => toggleLost(e.target.checked));
    $("autostart-toggle").addEventListener("change", async (e) => {
      state = (await api.setAutoStart(e.target.checked)) || state;
    });

    $("btn-webcam").addEventListener("click", startWebcam);
    $("btn-shoot").addEventListener("click", snapPhoto);
    $("btn-cam-off").addEventListener("click", stopWebcam);
    $("btn-alarm").addEventListener("click", () => api.playAlarm());
    $("btn-lock").addEventListener("click", () => api.lockScreen());

    $("btn-refresh-devices").addEventListener("click", refreshDevices);
    $("btn-map-refresh").addEventListener("click", () => {
      refreshDevices().then(() => renderMap());
    });
    $("btn-map-fit").addEventListener("click", () => {
      if (map) renderMap();
    });
    $("evidence-close").addEventListener("click", closeEvidence);
    $("evidence-backdrop").addEventListener("click", closeEvidence);
    $("lightbox-close").addEventListener("click", closeLightbox);
    $("lightbox-backdrop").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("lightbox").classList.contains("hidden")) closeLightbox();
      else if (!$("evidence-modal").classList.contains("hidden")) closeEvidence();
    });
    $("btn-scan").addEventListener("click", startScan);
    $("btn-clear-alerts").addEventListener("click", clearAllAlerts);

    $("btn-server").addEventListener("click", testServer);
    $("btn-link").addEventListener("click", linkAgent);
    $("btn-open-dashboard").addEventListener("click", () => {
      const url = $("server-url").value.trim() || "http://localhost:4173";
      api.openUrl(url);
    });

    $("alert-banner-dismiss").addEventListener("click", () => $("alert-banner").classList.add("hidden"));

    // Live events from the main process.
    api.onFix(renderFix);
    api.onState((next) => {
      state = next;
      $("lost-toggle").checked = !!next.lostMode;
      $("autostart-toggle").checked = !!next.autoStart;
      updateStatusChip(!!next.lostMode);
    });
    api.onWebcamCommand(() => {
      switchView("overview");
      startWebcam();
      setTimeout(() => {
        if (document.getElementById("webcam-video").srcObject) snapPhoto();
      }, 1500);
    });
    api.onVault(refreshVault);
    api.onAlert(showAlertBanner);
  }

  init();
})();
