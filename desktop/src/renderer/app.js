/* TrackNaija Agent — renderer logic (runs inside Electron, uses the preload bridge). */
(function () {
  const api = window.tracknaija;
  if (!api) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:monospace">Preload bridge missing — run via Electron, not a browser.</p>';
    return;
  }

  const $ = (id) => document.getElementById(id);
  let state = {};

  /* ---------- init ---------- */

  async function init() {
    state = (await api.getState()) || {};
    const info = await api.getDeviceInfo();

    $("device-hostname").textContent = info.hostname;
    $("device-serial").textContent = info.serialNumber || "—";
    $("device-os").textContent = `${info.platformLabel} ${info.release}`;
    $("device-user").textContent = info.username || "—";
    $("device-specs").textContent = `${info.cpu} · ${info.totalMemGb} GB`;
    $("device-uptime").textContent = `${info.uptimeH} h`;
    $("device-platform").textContent = info.platformLabel;

    // Serial number is the link key to the web dashboard vault.
    if (info.serialNumber && info.serialNumber !== "Unknown (run as admin for full access)") {
      $("device-serial").classList.add("mono");
      $("sync-note").textContent =
        "Serial number captured — link this machine to your dashboard account to enable remote commands (Phase 2).";
    }

    $("lost-toggle").checked = !!state.lostMode;
    $("autostart-toggle").checked = !!state.autoStart;

    if (state.lastFix) renderFix(state.lastFix);
    else refreshLocation();

    wireEvents();
    refreshLinkStatus();
    refreshVault();
    setInterval(refreshVault, 30000);
  }

  /* ---------- offline vault ---------- */

  async function refreshVault() {
    const v = (await api.vaultStatus()) || { pending: 0, evidence: 0 };
    $("vault-status").textContent =
      v.pending > 0
        ? `Offline vault: ${v.pending} pending (${v.evidence} evidence) — uploads automatically when this machine can reach the server`
        : "Offline vault: empty — captured fixes and evidence are stored locally without internet and uploaded on reconnect.";
  }

  /* ---------- link to dashboard ---------- */

  async function refreshLinkStatus() {
    const status = (await api.linkStatus()) || {};
    $("server-url").value = status.serverUrl || "http://localhost:4173";
    const chip = $("link-status");
    if (status.linked) {
      chip.textContent = "Linked";
      chip.className = "chip chip-success";
      $("link-note").textContent =
        "Linked as " + status.deviceId.slice(0, 8) + " — fixes and evidence stream to the dashboard.";
    } else {
      chip.textContent = "Not linked";
      chip.className = "chip chip-blue";
      $("link-note").textContent = status.online
        ? "Server reachable. Enter a pairing code from the dashboard's Agents page."
        : "Enter your sync server URL and test the connection.";
    }
  }

  async function testServer() {
    const result = await api.setServer($("server-url").value.trim());
    if (result && result.serverOnline) {
      $("link-note").textContent = "Server online — enter the pairing code to link this agent.";
      return true;
    }
    $("link-note").textContent =
      "Server unreachable. Start it with: cd server && npm start";
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
    } else {
      $("link-note").textContent =
        (result && result.error) || "Pairing failed — is the sync server running?";
    }
  }

  /* ---------- location ---------- */

  function renderFix(fix) {
    if (!fix) return;
    const map = $("map");
    map.classList.add("has-fix");
    $("map-coords").textContent = `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}° · ${fix.source}`;

    // Highlight the current ladder rung.
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

  /* ---------- owner alerts (reconnects, SIM changes) ---------- */

  function showAlertBanner(alert) {
    if (!alert) return;
    const banner = $("alert-banner");
    $("alert-banner-text").textContent =
      alert.body || `${alert.hostname} — ${alert.type.replace("_", " ")}`;
    banner.classList.toggle("danger", alert.type === "sim_change");
    banner.classList.toggle("info", alert.type !== "sim_change");
    banner.classList.remove("hidden");
  }

  /* ---------- lost mode ---------- */

  function updateStatusChip(on) {
    const chip = $("status-chip");
    if (on) {
      chip.textContent = "● LOST MODE — webcam armed";
      chip.className = "chip chip-danger";
    } else {
      chip.textContent = "● Agent running";
      chip.className = "chip chip-success";
    }
  }

  async function toggleLost(on) {
    state = (await api.setLostMode(on)) || state;
    updateStatusChip(!!state.lostMode);
  }

  /* ---------- webcam ---------- */

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
      "Photo captured and saved as evidence — uploaded to your dashboard when the backend is wired.";
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

  /* ---------- events ---------- */

  function wireEvents() {
    $("btn-track").addEventListener("click", refreshLocation);

    $("lost-toggle").addEventListener("change", (e) => toggleLost(e.target.checked));

    $("autostart-toggle").addEventListener("change", async (e) => {
      state = (await api.setAutoStart(e.target.checked)) || state;
    });

    $("btn-webcam").addEventListener("click", startWebcam);
    $("btn-shoot").addEventListener("click", snapPhoto);
    $("btn-cam-off").addEventListener("click", stopWebcam);

    $("btn-alarm").addEventListener("click", () => api.playAlarm());
    $("btn-lock").addEventListener("click", async () => {
      await api.lockScreen();
    });

    // Live updates from the main process (periodic fixes, state changes).
    api.onFix(renderFix);
    api.onState((next) => {
      state = next;
      $("lost-toggle").checked = !!next.lostMode;
      $("autostart-toggle").checked = !!next.autoStart;
      updateStatusChip(!!next.lostMode);
    });

    // Remote command from the dashboard: capture webcam evidence.
    api.onWebcamCommand(() => {
      startWebcam();
      // Give the camera a moment to warm up, then snap automatically.
      setTimeout(() => {
        if (document.getElementById("webcam-video").srcObject) snapPhoto();
      }, 1500);
    });

    api.onVault(refreshVault);
    api.onAlert(showAlertBanner);

    $("alert-banner-dismiss").addEventListener("click", () =>
      $("alert-banner").classList.add("hidden"),
    );

    $("btn-server").addEventListener("click", testServer);
    $("btn-link").addEventListener("click", linkAgent);
  }

  init();
})();
