package com.tracknaija.agent

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.provider.Settings
import android.util.Base64
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.Executors

/** Executes remote commands (alarm, webcam) issued from the dashboard. */
object CommandHandler {
    private const val TAG = "TrackNaija"

    /** Play the device ringtone loudly a few times — the "loud alarm". */
    fun playAlarm(context: Context) {
        try {
            val uri: Uri = Settings.System.DEFAULT_RINGTONE_URI
            val player = MediaPlayer.create(context, uri)
            player?.apply {
                isLooping = true
                setVolume(1f, 1f)
                start()
                // Stop after ~9 s so it never blasts forever.
                android.os.Handler(context.mainLooper).postDelayed({
                    runCatching { if (isPlaying) stop() }
                    release()
                }, 9_000)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Alarm failed", e)
        }
    }

    /**
     * Capture a webcam photo as evidence using CameraX. Runs on a dedicated
     * executor, binds a transient lifecycle owner, converts the frame to a
     * JPEG data: URL and hands it to [onResult].
     */
    fun captureWebcam(context: Context, onResult: (String?) -> Unit) {
        val executor = Executors.newSingleThreadExecutor()
        val owner = ServiceLifecycleOwner()

        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            val imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            try {
                provider.unbindAll()
                provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, imageCapture)
                // Write a proper JPEG to cache, then read it back as a data URL.
                // (The in-memory OnImageCapturedCallback path returns raw YUV
                // planes — encoding those as JPEG gives green/grey photos.)
                val file = File(context.cacheDir, "evidence_${System.currentTimeMillis()}.jpg")
                val output = ImageCapture.OutputFileOptions.Builder(file).build()
                imageCapture.takePicture(
                    output,
                    executor, // callbacks below run on `executor`
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(results: ImageCapture.OutputFileResults) {
                            val dataUrl = runCatching {
                                val bytes = file.readBytes()
                                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                                "data:image/jpeg;base64,$b64"
                            }.getOrNull()
                            file.delete()
                            // CameraX requires bind/unbind on the main thread.
                            ContextCompat.getMainExecutor(context).execute {
                                provider.unbindAll()
                                onResult(dataUrl)
                            }
                            executor.shutdown()
                        }

                        override fun onError(exception: ImageCaptureException) {
                            Log.e(TAG, "Webcam capture failed", exception)
                            file.delete()
                            // Release the camera even on failure so it isn't held
                            // until the next capture.
                            ContextCompat.getMainExecutor(context).execute {
                                provider.unbindAll()
                                onResult(null)
                            }
                            executor.shutdown()
                        }
                    },
                )
            } catch (e: Exception) {
                Log.e(TAG, "Camera bind failed", e)
                onResult(null)
                executor.shutdown()
            }
        }, ContextCompat.getMainExecutor(context))
    }
}

/** Minimal LifecycleOwner so CameraX can bind inside a Service. */
class ServiceLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)
    init {
        registry.currentState = Lifecycle.State.STARTED
    }
    override val lifecycle: Lifecycle
        get() = registry
}
