package com.tracknaija.agent

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.tracknaija.agent.databinding.ActivityMainBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** TrackNaija agent dashboard (Android). */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val state: AppState get() = AppState(this)
    private val scope = CoroutineScope(Dispatchers.IO)

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

    private fun requestTrackingPermissions() {
        val needed = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    }

    private fun renderState() {
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
                runOnUiThread {
                    binding.linkButton.isEnabled = true
                    if (deviceId != null) {
                        state.deviceId = deviceId
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
            if (on) TrackingService.start(this) else TrackingService.stop(this)
            renderState()
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
                        scope.launch { SyncClient(state.serverUrl).postEvidence(id, dataUrl) }
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
