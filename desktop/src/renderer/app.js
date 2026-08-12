/* Dravex — tracking dashboard renderer (Electron, preload bridge). */
(function () {
  const api = window.dravex;
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
    $("owner-key").value = state.ownerKey || "";

    if (state.lastFix) renderFix(state.lastFix);
    else refreshLocation();

    wireEvents();
    refreshLinkStatus();
    refreshVault();
    refreshDevices();
    refreshAlerts();
    loadReportInfo();

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

  async function saveOwnerKey() {
    $("btn-save-owner-key").disabled = true;
    const res = await api.setOwnerKey($("owner-key").value);
    $("btn-save-owner-key").disabled = false;
    $("owner-key-note").textContent = res
      ? "Saved — owner-only views are now unlocked on this machine (if the server has auth enabled)."
      : "Could not save — is the agent running normally?";
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
    // wifi_resolved is the honest "real BSSID→coordinate" source from
    // POST /api/geolocate; the ladder highlights the same Wi-Fi row.
    const ladderSource = fix.source === "wifi_resolved" ? "wifi" : fix.source;
    $("map-coords").textContent = `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}° · ${fix.source}`;

    document.querySelectorAll(".ladder-row").forEach((row) => row.classList.remove("current"));
    const current = document.querySelector(`.ladder-row[data-source="${ladderSource}"]`);
    if (current) current.classList.add("current");

    const time = fix.timestamp ? new Date(fix.timestamp).toLocaleTimeString() : "just now";
    const lastInfo = fix.lastKnownFrom ? ` (from ${new Date(fix.lastKnownFrom).toLocaleTimeString()})` : "";

    if (ladderSource === "wifi") {
      $("ladder-wifi-detail").textContent = `${fix.networks ?? 0} network${fix.networks === 1 ? "" : "s"} seen · ±${fix.accuracy} m`;
      $("ladder-ip-detail").textContent = fix.ipAddress ? `IP ${fix.ipAddress}` : "No IP lookup yet";
      $("ladder-last-detail").textContent = "—";
    } else if (ladderSource === "ip") {
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
        const report = `<button class="btn-icon report" data-report-id="${escapeHtml(d.deviceId)}" title="Printable incident report — IMEI, timeline, sightings, evidence">📄</button>`;
        const verify = d.lost
          ? `<button class="btn-icon verify" data-verify-id="${escapeHtml(d.deviceId)}" title="Verified — back in your possession">✓</button>`
          : "";
        const transfer = `<button class="btn-icon transfer" data-transfer-id="${escapeHtml(d.deviceId)}" title="Transfer ownership (resale) — clears registry, new pairing code">↔</button>`;
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
            ${verify}${transfer}${sight}${ev}${report}
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
    document.querySelectorAll("[data-transfer-id]").forEach((btn) => {
      btn.addEventListener("click", () => transferDevice(btn.getAttribute("data-transfer-id")));
    });
    document.querySelectorAll("[data-verify-id]").forEach((btn) => {
      btn.addEventListener("click", () => verifyDevice(btn.getAttribute("data-verify-id")));
    });
    document.querySelectorAll("[data-sightings]").forEach((btn) => {
      btn.addEventListener("click", () => showSightings(btn.getAttribute("data-sightings")));
    });
    document.querySelectorAll("[data-evidence-id]").forEach((btn) => {
      btn.addEventListener("click", () => openEvidence(btn.getAttribute("data-evidence-id")));
    });
    document.querySelectorAll("[data-report-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "…";
        await openReport(btn.getAttribute("data-report-id"));
        btn.disabled = false;
        btn.textContent = "📄";
      });
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
      if (next && res.recoveryCode) {
        const name = deviceName(dev || {});
        alert(
          `${name} marked lost. Recovery code: ${res.recoveryCode}\n\nKeep this code — it unlocks the device's app (ownership check) if the phone comes back to you.`,
        );
      }
    }
  }

  /** Ownership handover for resale (registry clears, old agent disconnected). */
  async function transferDevice(id) {
    const dev = devices.find((d) => d.deviceId === id);
    const name = deviceName(dev || {});
    if (
      !confirm(
        `${name}: transfer to a new owner? Its stolen-registry listing is cleared, all previous owner data is purged, and a fresh pairing code is issued for the new owner's agent.`,
      )
    )
      return;
    const res = await api.transferDevice(id);
    if (res && res.ok) {
      alert(`Device transferred. Give this pairing code to the new owner (single use):\n\n${res.code}\n\nThey enter it in the Dravex agent to link the device.`);
      refreshDevices();
    } else {
      alert("Could not transfer — is the server reachable?");
    }
  }

  /** Lifecycle step "Verified → Recovered": owner confirms the device is back. */
  async function verifyDevice(id) {
    const dev = devices.find((d) => d.deviceId === id);
    const name = deviceName(dev || {});
    if (!confirm(`${name}: confirm this device is back in your possession? The registry listing resolves and the beacon disarms.`)) return;
    const res = await api.verifyDevice(id);
    if (res && res.ok) {
      alert(`${name} marked verified-recovered.`);
      refreshDevices();
    } else {
      alert("Could not verify — is the server reachable?");
    }
  }

  async function showSightings(deviceId) {
    const res = await api.getSightings(deviceId);
    const list = (res && res.sightings) || [];
    const dev = devices.find((d) => d.deviceId === deviceId);
    const name = deviceName(dev || {});
    if (list.length === 0) {
      alert(`No community sightings for ${name} yet.\n\nSightings appear when another Dravex device hears its beacon nearby — while it is marked lost.`);
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

  function sightingPopup(s, nearest, nearestDist) {
    const t = s.receivedAt ? new Date(s.receivedAt).toLocaleString() : "?";
    const near = nearest
      ? `<p class="popup-meta">Closest device: <b>${escapeHtml(deviceName(nearest))}</b> (${fmtKm(nearestDist)})</p>`
      : "";
    return `<div>
      <p class="popup-title">Community sighting</p>
      <p class="popup-meta">${Number(s.lat).toFixed(5)}°, ${Number(s.lng).toFixed(5)}°${Number(s.accuracy) ? ` · ±${Number(s.accuracy)} m` : ""}</p>
      ${near}
      <p class="popup-meta">beacon ${escapeHtml(s.beacon || "")} · ${t}</p>
      <span class="popup-tag sighting">● Seen by another Dravex device</span>
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
    // Fetch sightings for every device that has them, in parallel, keeping
    // the owning device so the proximity view can say "whose beacon was heard".
    const withSightings = devices.filter((d) => (d.sightingCount || 0) > 0);
    const sightingPairs = [];
    const lists = await Promise.all(
      withSightings.map(async (d) => {
        const res = await api.getSightings(d.deviceId);
        const list = (res && res.sightings) || [];
        return list.map((s) => ({ device: d, sighting: s }));
      }),
    );
    lists.forEach((pairs) => sightingPairs.push(...pairs));

    // Devices with a known position, for nearest-tracker distances.
    const fixedDevices = devices.filter(
      (d) => d.lastFix && Number.isFinite(d.lastFix.lat) && Number.isFinite(d.lastFix.lng),
    );

    for (const { device, sighting: s } of sightingPairs) {
      if (!Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lng))) continue;
      const ll = [Number(s.lat), Number(s.lng)];
      addPoint(ll);
      let nearest = null;
      let nearestDist = Infinity;
      for (const d of fixedDevices) {
        const dist = haversineKm(d.lastFix.lat, d.lastFix.lng, Number(s.lat), Number(s.lng));
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = d;
        }
      }
      L.marker(ll, { icon: L.divIcon({ className: "pin pin-sighting", iconSize: [12, 12], iconAnchor: [6, 6] }) })
        .bindPopup(sightingPopup(s, nearest, nearestDist))
        .addTo(markerLayer);
      // Dashed violet line: which of your devices is closest to the sighting.
      if (nearest) {
        L.polyline([[nearest.lastFix.lat, nearest.lastFix.lng], ll], {
          color: "#7c3aed",
          weight: 2,
          dashArray: "6 6",
          opacity: 0.7,
        }).addTo(markerLayer);
      }
    }

    renderProximity(sightingPairs, fixedDevices);

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

  /** Distance between two points, in km (haversine). */
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    // Clamp to [0,1]: float drift on near-antipodal points can push a > 1,
    // which would make Math.asin return NaN.
    return 2 * R * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
  }

  function fmtKm(km) {
    if (!Number.isFinite(km)) return "—";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  }

  /** Below the map: which of your devices is nearest to each sighting. */
  function renderProximity(sightingPairs, fixedDevices) {
    const panel = $("proximity-panel");
    const valid = sightingPairs.filter(({ sighting: s }) =>
      Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)),
    );
    if (valid.length === 0 || fixedDevices.length === 0) {
      panel.classList.add("hidden");
      return;
    }
    const rows = valid
      .map(({ device, sighting: s }) => {
        let nearest = null;
        let nearestDist = Infinity;
        for (const d of fixedDevices) {
          const dist = haversineKm(d.lastFix.lat, d.lastFix.lng, Number(s.lat), Number(s.lng));
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = d;
          }
        }
        if (!nearest) return "";
        return `<div class="proximity-row">
          <span class="prox-icon"></span>
          <div class="prox-body">
            <p class="prox-title">${escapeHtml(deviceName(device))} beacon heard — closest device: <b>${escapeHtml(deviceName(nearest))}</b></p>
            <p class="prox-meta">${s.receivedAt ? new Date(s.receivedAt).toLocaleString() : ""} · ${Number(s.lat).toFixed(4)}°, ${Number(s.lng).toFixed(4)}°</p>
          </div>
          <span class="prox-dist">${fmtKm(nearestDist)}</span>
        </div>`;
      })
      .filter(Boolean)
      .join("");
    $("proximity-list").innerHTML = rows || '<p class="meta">No positioned devices to compare against yet.</p>';
    panel.classList.remove("hidden");
  }

  /* ================= incident report ================= */

  let reportInfo = { ownerName: "", ownerPhone: "", policeStation: "" };

  async function loadReportInfo() {
    const info = (await api.getReportInfo()) || {};
    reportInfo = {
      ownerName: info.ownerName || "",
      ownerPhone: info.ownerPhone || "",
      policeStation: info.policeStation || "",
    };
    $("report-owner").value = reportInfo.ownerName;
    $("report-phone").value = reportInfo.ownerPhone;
    $("report-station").value = reportInfo.policeStation;
  }

  async function saveReportInfo() {
    $("btn-save-report-info").disabled = true;
    const info = await api.setReportInfo({
      ownerName: $("report-owner").value,
      ownerPhone: $("report-phone").value,
      policeStation: $("report-station").value,
    });
    $("btn-save-report-info").disabled = false;
    if (info) {
      reportInfo = {
        ownerName: info.ownerName || "",
        ownerPhone: info.ownerPhone || "",
        policeStation: info.policeStation || "",
      };
      $("report-info-note").textContent =
        "Saved — incident reports now include " +
        (reportInfo.ownerName || "your name") +
        (reportInfo.policeStation ? ` · station: ${reportInfo.policeStation}` : "") +
        ".";
    } else {
      $("report-info-note").textContent = "Could not save — is the agent running normally?";
    }
  }

  async function openReport(deviceId) {
    const res = await api.getDeviceDetail(deviceId);
    if (!res || !res.ok || !res.device) {
      alert("Could not load report data — is the server reachable?");
      return;
    }
    const html = buildReportHtml(res, devices, reportInfo); // all devices → real closest-tracker

    const dev = res.device;
    const slug = String(dev.hostname || "device").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase() || "device";
    const filename = `Dravex-Report-${slug}-${new Date().toISOString().slice(0, 10)}.html`;
    const saved = await api.saveReport(html, filename);
    if (saved && saved.ok) {
      alert(
        `Report saved to:\n${saved.path}\n\nIt opened in your browser — use Ctrl/Cmd+P to print or save as PDF.`,
      );
    } else {
      alert("Could not write the report: " + ((saved && saved.error) || "unknown error"));
    }
  }

  function reportRow(label, value, extraClass) {
    return `<tr><th>${escapeHtml(label)}</th><td class="${extraClass || ""}">${value}</td></tr>`;
  }

  function buildReportHtml(res, allDevices, info) {
    const dev = res.device;
    const fixes = res.fixes || [];
    const sightings = res.sightings || [];
    const evidence = res.evidence || [];
    const events = (dev.events || []).filter((e) => e.type === "sim_change" || e.type === "reconnected");
    const now = new Date().toLocaleString();
    const fix = dev.lastFix;
    const lost = !!dev.lost;

    // Closest-device per sighting: compare against ALL owned devices with a
    // position (the map view does the same), falling back to this device alone.
    const pool = (Array.isArray(allDevices) && allDevices.length > 0 ? allDevices : [dev]);
    const fixedDevices = pool.filter((d) => d.lastFix && Number.isFinite(d.lastFix.lat));

    const rows = [
      reportRow("Status", lost ? '<span class="badge badge-lost">● LOST</span>' : '<span class="badge badge-safe">Active</span>'),
      reportRow("Device name", escapeHtml(dev.hostname || "—")),
      reportRow("Type", dev.type === "phone" ? "Phone" : "Laptop"),
      reportRow(dev.type === "phone" ? "IMEI" : "Serial number", escapeHtml(dev.imei || dev.serialNumber || "—"), "mono"),
      reportRow("Operator", escapeHtml(dev.operator || "—")),
      reportRow("Platform", escapeHtml(dev.platform || "—")),
      reportRow("Paired", dev.pairedAt ? new Date(dev.pairedAt).toLocaleString() : "—"),
      reportRow("Last seen", dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString() : "—"),
      reportRow("Sightings", String(sightings.length)),
    ].join("");

    const fixHtml = fix
      ? `<div class="box">
          <p><b>Last known position</b></p>
          <p class="mono">${Number(fix.lat).toFixed(5)}°, ${Number(fix.lng).toFixed(5)}° · ±${fix.accuracy || "?"} m · ${escapeHtml(fix.source)}</p>
          <p class="dim">${fix.timestamp ? new Date(fix.timestamp).toLocaleString() : new Date(fix.receivedAt || Date.now()).toLocaleString()}</p>
        </div>`
      : '<p class="dim">No fix recorded.</p>';

    const fixRows = fixes
      .slice(0, 30)
      .map(
        (f) => `<tr>
          <td>${f.timestamp ? new Date(f.timestamp).toLocaleString() : "—"}</td>
          <td class="mono">${Number(f.lat).toFixed(5)}°, ${Number(f.lng).toFixed(5)}°</td>
          <td>${escapeHtml(f.source || "—")}</td>
          <td>±${Number(f.accuracy) || "?"} m</td>
        </tr>`,
      )
      .join("") || '<tr><td colspan="4" class="dim">No fix history yet.</td></tr>';

    const eventRows = events
      .map((e) => {
        let detail = "";
        if (e.type === "sim_change" && e.detail) {
          detail = `SIM changed to ${escapeHtml(e.detail.to || "?" )}${e.detail.from ? ` (was ${escapeHtml(e.detail.from)})` : ""}`;
        } else if (e.type === "reconnected" && e.detail) {
          detail = `Came online after ${escapeHtml(String(e.detail.gapHours))}h offline`;
        }
        return `<tr><td>${new Date(e.at).toLocaleString()}</td><td>${escapeHtml(e.type.replace("_", " "))}</td><td>${detail || "—"}</td></tr>`;
      })
      .join("") || '<tr><td colspan="3" class="dim">No SIM-change or reconnect events.</td></tr>';

    const sightRows = sightings
      .map((s) => {
        let nearest = null;
        let nearestDist = Infinity;
        for (const d of fixedDevices) {
          const dist = haversineKm(d.lastFix.lat, d.lastFix.lng, Number(s.lat), Number(s.lng));
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = d;
          }
        }
        const t = s.receivedAt || s.at;
        return `<tr>
          <td>${t ? new Date(t).toLocaleString() : "—"}</td>
          <td class="mono">${Number(s.lat).toFixed(5)}°, ${Number(s.lng).toFixed(5)}°${Number(s.accuracy) ? ` ±${Number(s.accuracy)}m` : ""}</td>
          <td>${nearest ? escapeHtml(deviceName(nearest)) : "—"}</td>
          <td>${nearest ? fmtKm(nearestDist) : "—"}</td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="4" class="dim">No community sightings. Sightings appear while the device is marked lost.</td></tr>';

    const evidenceHtml = evidence
      .map((e) => {
        const t = e.capturedAt || e.receivedAt;
        return `<figure class="photo">
          <img src="${escapeHtml(e.dataUrl)}" alt="Evidence photo" />
          <figcaption>${t ? new Date(t).toLocaleString() : ""}</figcaption>
        </figure>`;
      })
      .join("") || '<p class="dim">No webcam evidence captured.</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Dravex Incident Report — ${escapeHtml(dev.hostname || "device")}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1e293b; margin: 0 auto; padding: 32px 40px; max-width: 900px; background: #fff; }
  h1 { font-size: 22px; margin: 4px 0 2px; }
  h2 { font-size: 15px; margin: 26px 0 10px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
  .brand { color: #f97316; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; }
  .meta { color: #64748b; font-size: 12px; margin: 0; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  th { color: #64748b; font-weight: 600; width: 40%; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .badge-lost { background: #fef2f2; color: #dc2626; }
  .badge-safe { background: #ecfdf5; color: #059669; }
  .box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; background: #f8fafc; font-size: 13px; }
  .reporter { border-color: #fca5a5; background: #fff7f7; margin: 14px 0 0; }
  .box p { margin: 4px 0; }
  .dim { color: #94a3b8; }
  .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  figure { margin: 0; }
  figure img { width: 100%; border-radius: 10px; border: 1px solid #e2e8f0; }
  figcaption { font-size: 11px; color: #64748b; margin-top: 4px; font-family: ui-monospace, monospace; }
  footer { margin-top: 34px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; }
  @media print { body { padding: 0; } h2 { page-break-after: avoid; } .photos { page-break-inside: avoid; } }
</style>
</head>
<body>
  <p class="brand">DRAVEX</p>
  <h1>Incident Report — ${escapeHtml(dev.hostname || "Unnamed device")}</h1>
  <p class="meta">Generated ${now} · Device ID ${escapeHtml(String(dev.deviceId || "").slice(0, 8))}</p>

  ${info && (info.ownerName || info.ownerPhone || info.policeStation)
    ? `<div class="box reporter">
        <p><b>Reported by</b>${info.policeStation ? ` — for submission to ${escapeHtml(info.policeStation)}` : ""}</p>
        <p>${escapeHtml(info.ownerName || "—")}${info.ownerPhone ? ` · ${escapeHtml(info.ownerPhone)}` : ""}</p>
      </div>`
    : ""}

  <h2>Device</h2>
  <table>${rows}</table>

  <h2>Last known position</h2>
  ${fixHtml}

  <h2>Location timeline</h2>
  <table><thead><tr><th>Time</th><th>Coordinates</th><th>Source</th><th>Accuracy</th></tr></thead><tbody>${fixRows}</tbody></table>

  <h2>Security events</h2>
  <table><thead><tr><th>Time</th><th>Event</th><th>Detail</th></tr></thead><tbody>${eventRows}</tbody></table>

  <h2>Community sightings (BLE relay)</h2>
  <table><thead><tr><th>Time</th><th>Coordinates</th><th>Closest device</th><th>Distance</th></tr></thead><tbody>${sightRows}</tbody></table>

  <h2>Webcam evidence</h2>
  <div class="photos">${evidenceHtml}</div>

  <footer>
    Prepared with Dravex. IMEI/serial and sighting data are intended for law-enforcement follow-up
    (report the IMEI to the police for NPF/SCID network tracing). Device data is collected with owner
    consent and handled in line with the NDPA 2023.
  </footer>
</body>
</html>`;
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
    $("scan-status").innerHTML = '<span class="scan-spinner"></span> Sweeping for Dravex beacons…';
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
          ? "Sweep finished — no Dravex beacons heard. (Bluetooth adapter unavailable: " + (res.reason || "unknown") + ")"
          : "Sweep finished — no Dravex beacons in range. Lost phones near you broadcast one; keep this dashboard open and sweep again.";
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
            <div class="beacon-meta">Dravex beacon · ${b.rssi ?? "?"} dBm</div>
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
    $("btn-save-owner-key").addEventListener("click", saveOwnerKey);
    $("btn-save-report-info").addEventListener("click", saveReportInfo);
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
