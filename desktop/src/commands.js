const os = require("os");
const { exec, execSync } = require("child_process");

function run(cmd, timeoutMs = 6000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout).trim());
    });
  });
}

/** Serial number (BIOS/board serial), best-effort per platform. */
async function getSerialNumber() {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_BIOS).SerialNumber"',
        { timeout: 8000, windowsHide: true, encoding: "utf8" }
      );
      const s = String(out).trim().toUpperCase();
      return s && s !== "DEFAULT" && s !== "TO BE FILLED BY O.E.M." ? s : null;
    }
    if (process.platform === "darwin") {
      const out = execSync(
        "ioreg -l | grep IOPlatformSerialNumber | awk '{print $4}' | tr -d '\"'",
        { timeout: 8000, encoding: "utf8" }
      );
      return String(out).trim() || null;
    }
    const out = execSync("dmidecode -s system-serial-number", {
      timeout: 8000,
      encoding: "utf8",
    });
    const s = String(out).trim().toUpperCase();
    return s || null;
  } catch (_) {
    return null;
  }
}

/** Aggregate device info for the agent dashboard. */
async function getDeviceInfo() {
  const serialNumber = await getSerialNumber();
  return {
    hostname: os.hostname(),
    platform: process.platform, // win32 | darwin | linux
    platformLabel:
      process.platform === "win32"
        ? "Windows"
        : process.platform === "darwin"
          ? "macOS"
          : "Linux",
    arch: os.arch(),
    release: os.release(),
    username: os.userInfo().username,
    serialNumber: serialNumber || "Unknown (run as admin for full access)",
    cpu: os.cpus().length > 0 ? os.cpus()[0].model.trim() : "Unknown CPU",
    totalMemGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    uptimeH: Math.round(os.uptime() / 3600),
  };
}

/** Lock the workstation/session. */
async function lockScreen() {
  try {
    if (process.platform === "win32") {
      return await run("rundll32.exe user32.dll,LockWorkStation");
    }
    if (process.platform === "darwin") {
      return await run(
        '/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend'
      );
    }
    return await run("loginctl lock-session 2>/dev/null || xdg-screensaver lock");
  } catch (_) {
    return null;
  }
}

/** Play a loud system alarm sound. */
async function playAlarm() {
  try {
    if (process.platform === "win32") {
      // Windows ships a built-in alarm wav — loop it a few times.
      const ps = [
        "$s=(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Alarm01.wav');",
        "1..3 | % { $s.PlaySync() }",
      ].join(" ");
      return await run(`powershell -NoProfile -Command "${ps}"`, 15000);
    }
    if (process.platform === "darwin") {
      return await run("afplay /System/Library/Sounds/Sosumi.aiff");
    }
    return await run("paplay /usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga 2>/dev/null || beep 2>/dev/null");
  } catch (_) {
    return null;
  }
}

module.exports = { getDeviceInfo, lockScreen, playAlarm };
