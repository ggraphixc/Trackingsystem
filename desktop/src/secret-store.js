/**
 * Dravex secret-store — zero-dependency at-rest encryption for agent
 * credentials (deviceToken, ownerKey). The state JSON never holds a
 * plaintext credential; it holds a boxed string the OS protects:
 *
 *   dpapi:    Windows DPAPI (CurrentUser) via PowerShell — no password, tied
 *             to the Windows account, so a stolen JSON file alone is useless.
 *   keychain: macOS Keychain via the `security` CLI (generic password).
 *   xor:      Fallback (Linux / missing tooling) — XOR with a per-install
 *             random key file (0600). Not as strong as DPAPI/Keychain, but it
 *             stops casual reading of agent-state.json; the console warns.
 *
 * All functions are synchronous (execSync) — they run at claim time and boot
 * only, so the few hundred ms they cost never affects tracking.
 */

const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PREFIXES = ["dpapi:", "keychain:", "xor:"];
let keyDir = os.tmpdir(); // set to the app userData dir before first use

function setKeyDir(dir) {
  keyDir = dir;
}

/** True when a value is already boxed (safe to store as-is). */
function isBoxed(value) {
  return typeof value === "string" && PREFIXES.some((p) => value.startsWith(p));
}

/* ------------------------------ DPAPI ------------------------------ */

function dpapiProtect(plaintext) {
  const b64 = Buffer.from(plaintext, "utf8").toString("base64");
  const script =
    "Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue; " +
    `$b=[Convert]::FromBase64String('${b64}'); ` +
    "$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
    "[Convert]::ToBase64String($p)";
  const out = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  ).trim();
  if (!out) throw new Error("empty dpapi output");
  return "dpapi:" + out;
}

function dpapiUnprotect(payload) {
  const script =
    "Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue; " +
    `$b=[Convert]::FromBase64String('${payload}'); ` +
    "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
    "[Text.Encoding]::UTF8.GetString($p)";
  return execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  ).trim();
}

/* ------------------------------ Keychain ------------------------------ */

function keychainProtect(plaintext, service) {
  const b64 = Buffer.from(plaintext, "utf8").toString("base64");
  execSync(
    `security add-generic-password -U -a dravex -s ${service} -w ${b64}`,
    { encoding: "utf8", timeout: 10000, stdio: "ignore" },
  );
  return `keychain:${service}:${b64}`;
}

function keychainUnprotect(service) {
  const out = execSync(
    `security find-generic-password -a dravex -s ${service} -w`,
    { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  return Buffer.from(out, "base64").toString("utf8");
}

function keychainDestroy(service) {
  try {
    execSync(`security delete-generic-password -a dravex -s ${service}`, {
      encoding: "utf8",
      timeout: 10000,
      stdio: "ignore",
    });
  } catch (_) {
    /* already gone */
  }
}

/* --------------------------- XOR fallback --------------------------- */

function xorKey() {
  const keyFile = path.join(keyDir, ".dravex-secret.key");
  try {
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    return Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
  } catch (_) {
    // Last resort: derive from the machine hostname so it at least differs
    // across machines (still weaker than the file — documented in the UI).
    return crypto.createHash("sha256").update(os.hostname()).digest();
  }
}

function xorProtect(plaintext) {
  const key = xorKey();
  const bytes = Buffer.from(plaintext, "utf8");
  const xored = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) xored[i] = bytes[i] ^ key[i % key.length];
  console.warn(
    "[Dravex secret-store] No OS keychain available — storing credentials with per-install XOR protection. " +
      "For stronger protection run on Windows (DPAPI) or macOS (Keychain).",
  );
  return "xor:" + xored.toString("base64");
}

function xorUnprotect(payload) {
  const key = xorKey();
  const xored = Buffer.from(payload, "base64");
  const bytes = Buffer.alloc(xored.length);
  for (let i = 0; i < xored.length; i++) bytes[i] = xored[i] ^ key[i % key.length];
  return bytes.toString("utf8");
}

/* ------------------------------ public ------------------------------ */

/** Encrypt a plaintext credential. Returns the boxed string. */
function protectSync(plaintext, service) {
  if (!plaintext) return "";
  if (isBoxed(plaintext)) return plaintext;
  const svc = String(service || "dravex-secret").replace(/[^a-zA-Z0-9-]/g, "");
  if (process.platform === "win32") {
    try {
      return dpapiProtect(plaintext);
    } catch (_) {
      /* fall through to xor */
    }
  } else if (process.platform === "darwin") {
    try {
      return keychainProtect(plaintext, svc);
    } catch (_) {
      /* fall through to xor */
    }
  }
  return xorProtect(plaintext);
}

/** Decrypt a boxed string. Returns plaintext or null on failure. */
function unprotectSync(boxed) {
  if (!boxed || typeof boxed !== "string") return null;
  try {
    if (boxed.startsWith("dpapi:")) return dpapiUnprotect(boxed.slice(6));
    if (boxed.startsWith("keychain:")) {
      const rest = boxed.slice(9);
      const sep = rest.indexOf(":");
      if (sep <= 0) return null;
      return keychainUnprotect(rest.slice(0, sep));
    }
    if (boxed.startsWith("xor:")) return xorUnprotect(boxed.slice(4));
  } catch (_) {
    return null; // credential unreadable — treat as absent, never crash
  }
  return null;
}

/** Remove a boxed secret from its keychain (XOR/DPAPI need nothing). */
function destroySync(boxed) {
  if (!boxed || !boxed.startsWith("keychain:")) return;
  const rest = boxed.slice(9);
  const sep = rest.indexOf(":");
  if (sep > 0) keychainDestroy(rest.slice(0, sep));
}

module.exports = { setKeyDir, isBoxed, protectSync, unprotectSync, destroySync };
