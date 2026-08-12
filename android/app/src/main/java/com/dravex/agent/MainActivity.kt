package com.dravex.agent

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.dravex.agent.databinding.ActivityMainBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Dravex agent dashboard (Android). */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val state: AppState get() = AppState(this)
    private val scope = CoroutineScope(Dispatchers.IO)
    private var ownershipLockShowing = false

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val fine = result[Manifest.permission.ACCESS_FINE_LOCATION] == true
            if (!fine) {
                Toast.makeText(this, R.string.permission_needed, Toast.LENGTH_LONG).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        renderState()
        wireEvents()
        requestTrackingPermissions()
    }

    override fun onResume() {
        super.onResume()
        renderState()
    }

    /**
     * App-level activation barrier (FRP-style): when the device has been
     * reported lost with a recovery code, the app locks on open and demands
     * the code before it can be used again. The code is delivered by the
     * dashboard's `lost` command — a thief who flashes the phone loses this
     * layer, but while the agent survives, the device can't be silently reused.
     */
    private fun maybeShowOwnershipLock() {
        val code = state.recoveryCode
        if (!state.lostMode || code.isNullOrBlank() || ownershipLockShowing) return
        ownershipLockShowing = true
        val input = android.widget.EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = getString(R.string.recovery_code_hint)
        }
        android.app.AlertDialog.Builder(this)
            .setTitle(R.string.recovery_lock_title)
            .setMessage(R.string.recovery_lock_body)
            .setView(input)
            .setCancelable(false)
            .setPositiveButton(R.string.recovery_unlock) { d, _ ->
                if (input.text.toString().trim() == code) {
                    state.lostMode = false
                    state.recoveryCode = null
                    Toast.makeText(this, R.string.recovery_unlocked, Toast.LENGTH_SHORT).show()
                    renderState()
                } else {
                    Toast.makeText(this, R.string.recovery_wrong, Toast.LENGTH_LONG).show()
                    d.dismiss()
                    ownershipLockShowing = false
                    maybeShowOwnershipLock() // re-lock — the barrier stays up
                }
            }
            .setNegativeButton(R.string.recovery_contact_owner) { d, _ ->
                d.dismiss()
                ownershipLockShowing = false
                showContactOwnerDialog()
            }
            .setOnDismissListener { ownershipLockShowing = false }
            .show()
    }

    /**
     * The finder channel (M4): a good samaritan holding the locked phone can
     * send the owner ONE message through this device's own recovery page —
     * anonymous, rate-limited server-side, lands in the owner's alerts.
     */
    private fun showContactOwnerDialog() {
        val input = android.widget.EditText(this).apply {
            hint = getString(R.string.contact_owner_hint)
            maxLines = 4
        }
        android.app.AlertDialog.Builder(this)
            .setTitle(R.string.contact_owner_title)
            .setMessage(R.string.contact_owner_body)
            .setView(input)
            .setPositiveButton(R.string.contact_owner_send) { d, _ ->
                d.dismiss()
                val message = input.text.toString().trim()
                if (message.isEmpty()) {
                    Toast.makeText(this, R.string.contact_owner_empty, Toast.LENGTH_SHORT).show()
                    ownershipLockShowing = false
                    maybeShowOwnershipLock() // the barrier stays up
                    return@setPositiveButton
                }
                val deviceId = state.deviceId
                scope.launch {
                    if (deviceId != null) {
                        runCatching {
                            SyncClient(state.serverUrl).postContactMessage(deviceId, message)
                        }
                    }
                    runOnUiThread {
                        Toast.makeText(
                            this@MainActivity,
                            R.string.contact_owner_sent,
                            Toast.LENGTH_LONG,
                        ).show()
                        ownershipLockShowing = false
                        maybeShowOwnershipLock() // re-lock — device stays protected
                    }
                }
            }
            .setNegativeButton(android.R.string.cancel) { d, _ ->
                d.dismiss()
                ownershipLockShowing = false
                maybeShowOwnershipLock()
            }
            .show()
    }

    /**
     * M7: guide the owner past OEM battery killers (Samsung/Tecno/Infinix
     * background-manager screens). First the system IgnoreBatteryOptimizations
     * opt-out, then per-OEM guidance.
     */
    private fun requestBatteryProtection() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        // Already exempt (or too old to ask) — no nagging on every toggle.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            pm.isIgnoringBatteryOptimizations(packageName)
        ) {
            return
        }
        android.app.AlertDialog.Builder(this)
            .setTitle(R.string.battery_protect_title)
            .setMessage(R.string.battery_protect_body)
            .setPositiveButton(R.string.battery_protect_allow) { _, _ ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        startActivity(
                            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                                .setData(Uri.parse("package:$packageName")),
                        )
                    } catch (_: Exception) {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    }
                }
            }
            .setNeutralButton(R.string.battery_protect_manufacturer) { _, _ ->
                // Samsung: Settings → Battery → Background usage limits → Never
                // deep-sleep. Tecno/Infinix: Phone Manager → Autostart + battery
                // optimization → allow. Open the OEM battery settings if possible.
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun requestTrackingPermissions() {
        val needed = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        // Community BLE beacon (Android 12+ split permissions)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed += listOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    }

    private fun renderState() {
        maybeShowOwnershipLock()
        binding.serverUrl.setText(state.serverUrl)
        binding.statusText.text =
            if (state.deviceId != null) {
                getString(R.string.status_linked, state.deviceId!!.take(8))
            } else {
                getString(R.string.status_not_linked)
            }
        binding.lostSwitch.isChecked = state.lostMode
        binding.trackingSwitch.isChecked = TrackingServiceStarted()
        state.lastFix()?.let { fix ->
            binding.lastLocation.text = getString(
                R.string.last_location,
                fix.optDouble("lat", 0.0),
                fix.optDouble("lng", 0.0),
                fix.optString("source", "—"),
            )
        }
        // Offline vault status — evidence held while the phone has no data.
        val vault = OfflineVault(this)
        binding.vaultStatus.text = if (vault.count() > 0) {
            getString(R.string.vault_status, vault.count(), vault.countOf("evidence"))
        } else {
            getString(R.string.vault_empty)
        }
    }

    private fun TrackingServiceStarted(): Boolean = TrackingService.running

    private fun wireEvents() {
        binding.linkButton.setOnClickListener {
            val url = binding.serverUrl.text.toString().trim()
            val code = binding.pairCode.text.toString().trim()
            if (url.isEmpty() || code.isEmpty()) {
                Toast.makeText(this, R.string.fill_pairing, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            state.serverUrl = url
            binding.linkButton.isEnabled = false
            scope.launch {
                val res = SyncClient(url).claim(
                    code,
                    android.os.Build.MODEL,
                    Build.SERIAL.takeIf { !it.isNullOrBlank() && it != "unknown" } ?: Build.MODEL,
                    "android",
                )
                val deviceId = res?.optString("deviceId", null)
                val token = res?.optString("token", null)
                runOnUiThread {
                    binding.linkButton.isEnabled = true
                    if (deviceId != null) {
                        state.deviceId = deviceId
                        state.deviceToken = token?.takeIf { it.isNotBlank() }
                        state.pairedAt = java.time.Instant.now().toString()
                        Toast.makeText(this@MainActivity, R.string.linked_ok, Toast.LENGTH_SHORT).show()
                        renderState()
                    } else {
                        Toast.makeText(this@MainActivity, R.string.link_failed, Toast.LENGTH_LONG).show()
                    }
                }
            }
        }

        binding.lostSwitch.setOnCheckedChangeListener { _, on ->
            state.lostMode = on
            if (on && state.deviceId != null) TrackingService.start(this)
        }

        binding.trackingSwitch.setOnCheckedChangeListener { _, on ->
            state.trackingEnabled = on
            if (on) {
                TrackingService.start(this)
                // Nudge the owner past OEM battery killers so the foreground
                // service actually survives backgrounding on Samsung/Tecno etc.
                requestBatteryProtection()
            } else {
                TrackingService.stop(this)
            }
            renderState()
        }

        binding.batteryProtectButton.setOnClickListener { requestBatteryProtection() }

        binding.deviceCheckButton.setOnClickListener {
            val q = binding.imeiInput.text.toString().trim()
            if (q.length < 6) {
                Toast.makeText(this, R.string.check_imei_short, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            binding.deviceCheckResult.text = getString(R.string.checking_registry)
            scope.launch {
                val res = SyncClient(state.serverUrl, state.deviceToken).checkRegistry(q)
                runOnUiThread {
                    if (res == null) {
                        binding.deviceCheckResult.text = getString(R.string.registry_unreachable)
                    } else if (res.optBoolean("found", false)) {
                        binding.deviceCheckResult.text = getString(R.string.registry_stolen)
                        binding.deviceCheckResult.setTextColor(0xFFDC2626.toInt())
                    } else {
                        binding.deviceCheckResult.text = getString(R.string.registry_clean)
                        binding.deviceCheckResult.setTextColor(0xFF059669.toInt())
                    }
                }
            }
        }

        binding.webcamButton.setOnClickListener {
            CommandHandler.captureWebcam(this) { dataUrl ->
                runOnUiThread {
                    if (dataUrl == null) {
                        Toast.makeText(this, R.string.capture_failed, Toast.LENGTH_SHORT).show()
                        return@runOnUiThread
                    }
                    binding.webcamPreview.setImageBitmap(decodeDataUrl(dataUrl))
                    state.deviceId?.let { id ->
                        scope.launch { SyncClient(state.serverUrl, state.deviceToken).postEvidence(id, dataUrl) }
                    }
                    Toast.makeText(this, R.string.captured, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun decodeDataUrl(dataUrl: String): android.graphics.Bitmap? {
        return runCatching {
            val b64 = dataUrl.substringAfter(",")
            val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()
    }
}
