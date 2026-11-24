package app.potok.finance

import android.annotation.SuppressLint
import android.app.Service
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import java.util.concurrent.atomic.AtomicBoolean

class AiDownloadService : Service() {
    companion object {
        const val ACTION_START = "app.potok.finance.action.START_AI_DOWNLOAD"
        const val EXTRA_MODEL_ID = "model_id"
        private const val WAKELOCK_TIMEOUT_MS = 6L * 60L * 60L * 1000L
    }

    private var workerThread: Thread? = null
    private var activeModelId: String? = null
    private val timedOut = AtomicBoolean(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestedModelId = intent?.getStringExtra(EXTRA_MODEL_ID)
            ?: AiDownloadEngine.pendingModelId(this)
        val spec = AiDownloadEngine.findSpec(requestedModelId)

        val fgType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else {
            0
        }

        val initialNotification = AiDownloadEngine.buildProgressNotification(
            context = this,
            modelName = spec?.name ?: "локального ИИ",
            stageText = "Подготовка загрузки...",
            percent = 0f,
            downloadedBytes = 0L,
            totalBytes = spec?.approxBytes ?: 0L,
        )
        ServiceCompat.startForeground(
            this,
            AiDownloadEngine.NOTIFICATION_ID_PROGRESS,
            initialNotification,
            fgType,
        )

        if (spec == null || AiDownloadEngine.isCanceled()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }

        if (workerThread?.isAlive == true && activeModelId == spec.id) {
            return START_NOT_STICKY
        }

        workerThread?.interrupt()
        activeModelId = spec.id
        timedOut.set(false)
        AiDownloadEngine.setServiceRunning(true)

        val thread = Thread {
            var wakeLock: PowerManager.WakeLock? = null
            var wifiLock: WifiManager.WifiLock? = null
            var outcome: AiDownloadEngine.DownloadOutcome = AiDownloadEngine.DownloadOutcome.Interrupted

            try {
                val pm = applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "finacc:ai_download")?.apply {
                    setReferenceCounted(false)
                    acquire(WAKELOCK_TIMEOUT_MS)
                }

                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                val lockMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                } else {
                    @Suppress("DEPRECATION")
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF
                }
                wifiLock = wm?.createWifiLock(lockMode, "finacc:ai_download")?.apply {
                    setReferenceCounted(false)
                    acquire()
                }

                outcome = AiDownloadEngine.downloadModel(
                    context = applicationContext,
                    modelId = spec.id,
                ) { stageText, downloaded, total, percent ->
                    val notif = AiDownloadEngine.buildProgressNotification(
                        context = applicationContext,
                        modelName = spec.name,
                        stageText = stageText,
                        percent = percent,
                        downloadedBytes = downloaded,
                        totalBytes = total,
                    )
                    AiDownloadEngine.safeNotify(
                        applicationContext,
                        AiDownloadEngine.NOTIFICATION_ID_PROGRESS,
                        notif,
                    )
                }
            } finally {
                try {
                    if (wifiLock?.isHeld == true) wifiLock.release()
                } catch (_: Throwable) {
                }
                try {
                    if (wakeLock?.isHeld == true) wakeLock.release()
                } catch (_: Throwable) {
                }
                AiDownloadEngine.setServiceRunning(false)

                when (outcome) {
                    AiDownloadEngine.DownloadOutcome.Interrupted,
                    is AiDownloadEngine.DownloadOutcome.Failed,
                    -> {
                        if (!timedOut.get() && AiDownloadEngine.hasPendingDownload(applicationContext)) {
                            AiDownloadEngine.scheduleResumeJob(applicationContext, 30_000L)
                        }
                    }
                    AiDownloadEngine.DownloadOutcome.Done,
                    AiDownloadEngine.DownloadOutcome.Canceled,
                    -> Unit
                }

                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
            }
        }.apply {
            name = "finacc-ai-fg-download"
            start()
        }

        workerThread = thread
        return START_NOT_STICKY
    }

    @SuppressLint("NewApi")
    override fun onTimeout(startId: Int, fgsType: Int) {
        timedOut.set(true)
        workerThread?.interrupt()
        if (AiDownloadEngine.hasPendingDownload(applicationContext)) {
            AiDownloadEngine.scheduleResumeJob(applicationContext, 10_000L)
        }
        AiDownloadEngine.setServiceRunning(false)
        stopSelf(startId)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Keep foreground download running; arm persisted safety net just in case OEM kills the process.
        if (AiDownloadEngine.hasPendingDownload(applicationContext)) {
            AiDownloadEngine.scheduleResumeJob(applicationContext, 60_000L)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        workerThread?.interrupt()
        AiDownloadEngine.setServiceRunning(false)
        super.onDestroy()
    }
}

class AiDownloadResumeJobService : JobService() {
    private var jobThread: Thread? = null

    override fun onStartJob(params: JobParameters?): Boolean {
        if (params == null) return false
        val modelId = AiDownloadEngine.pendingModelId(applicationContext) ?: run {
            jobFinished(params, false)
            return false
        }
        if (AiDownloadEngine.isModelInstalled(applicationContext, modelId)) {
            jobFinished(params, false)
            return false
        }
        if (AiDownloadEngine.isServiceRunning()) {
            return false
        }

        val spec = AiDownloadEngine.findSpec(modelId) ?: run {
            jobFinished(params, false)
            return false
        }

        AiDownloadEngine.setJobRunning(true)
        jobThread = Thread {
            var reschedule = false
            try {
                val outcome = AiDownloadEngine.downloadModel(
                    context = applicationContext,
                    modelId = spec.id,
                ) { stageText, downloaded, total, percent ->
                    val notif = AiDownloadEngine.buildProgressNotification(
                        context = applicationContext,
                        modelName = spec.name,
                        stageText = stageText,
                        percent = percent,
                        downloadedBytes = downloaded,
                        totalBytes = total,
                    )
                    AiDownloadEngine.safeNotify(
                        applicationContext,
                        AiDownloadEngine.NOTIFICATION_ID_PROGRESS,
                        notif,
                    )
                }
                reschedule = when (outcome) {
                    AiDownloadEngine.DownloadOutcome.Interrupted,
                    is AiDownloadEngine.DownloadOutcome.Failed,
                    -> AiDownloadEngine.hasPendingDownload(applicationContext)
                    AiDownloadEngine.DownloadOutcome.Done,
                    AiDownloadEngine.DownloadOutcome.Canceled,
                    -> false
                }
            } finally {
                AiDownloadEngine.setJobRunning(false)
                jobFinished(params, reschedule)
            }
        }.apply {
            name = "finacc-ai-job-resume"
            start()
        }

        return true
    }

    override fun onStopJob(params: JobParameters?): Boolean {
        jobThread?.interrupt()
        AiDownloadEngine.setJobRunning(false)
        return AiDownloadEngine.hasPendingDownload(applicationContext)
    }
}

class AiDownloadCancelReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (context != null) {
            AiDownloadEngine.cancelDownload(context.applicationContext)
        }
    }
}
