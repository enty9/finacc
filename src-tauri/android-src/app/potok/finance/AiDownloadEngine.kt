package app.potok.finance

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max
import kotlin.math.min

object AiDownloadEngine {
    const val CHANNEL_PROGRESS_ID = "finacc_ai_download"
    const val CHANNEL_DONE_ID = "finacc_ai_done"
    const val NOTIFICATION_ID_PROGRESS = 42071
    const val NOTIFICATION_ID_DONE = 42072
    const val JOB_ID_RESUME = 42071

    private const val PREFS_NAME = "finacc_ai_dl"
    private const val KEY_PENDING_MODEL_ID = "pending_model_id"
    private const val KEY_MODEL_ID = "model_id"
    private const val KEY_STATUS = "status"
    private const val KEY_STAGE = "stage"
    private const val KEY_DOWNLOADED = "downloaded_bytes"
    private const val KEY_TOTAL = "total_bytes"
    private const val KEY_PERCENT = "percent"
    private const val KEY_ERROR = "error"

    private const val MIN_TOKENIZER_BYTES = 50_000L
    private const val MIN_WEIGHTS_BYTES = 100_000_000L
    private const val MAX_REDIRECTS = 8
    private const val MAX_RETRIES = 6

    data class ModelSpec(
        val id: String,
        val name: String,
        val approxBytes: Long,
        val weightsUrl: String,
        val tokenizerUrl: String,
    )

    sealed class DownloadOutcome {
        data object Done : DownloadOutcome()
        data object Canceled : DownloadOutcome()
        data object Interrupted : DownloadOutcome()
        data class Failed(val error: String) : DownloadOutcome()
    }

    private val MODEL_SPECS = listOf(
        ModelSpec(
            id = "qwen2.5-3b",
            name = "Qwen2.5 3B Instruct (Q4_K_M)",
            approxBytes = 1_930_000_000L,
            weightsUrl = "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
            tokenizerUrl = "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/resolve/main/tokenizer.json",
        ),
        ModelSpec(
            id = "qwen2.5-1.5b",
            name = "Qwen2.5 1.5B Instruct (Q4_K_M)",
            approxBytes = 986_000_000L,
            weightsUrl = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            tokenizerUrl = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/resolve/main/tokenizer.json",
        ),
    )

    private val downloadLock = Any()
    private val stateLock = Any()
    private val cancelRequested = AtomicBoolean(false)
    private val activeGeneration = AtomicLong(0L)

    @Volatile
    private var activeThread: Thread? = null

    fun isCanceled(): Boolean = cancelRequested.get()

    @Volatile
    private var serviceRunning: Boolean = false

    @Volatile
    private var jobRunning: Boolean = false

    @Volatile
    private var webViewRef: WeakReference<WebView>? = null

    fun findSpec(modelId: String?): ModelSpec? {
        if (modelId.isNullOrBlank()) return null
        return MODEL_SPECS.firstOrNull { it.id == modelId }
    }

    fun modelsRoot(context: Context): File = File(context.dataDir, "ai-models")

    fun modelDir(context: Context, modelId: String): File = File(modelsRoot(context), modelId)

    fun isModelInstalled(context: Context, modelId: String): Boolean {
        if (findSpec(modelId) == null) return false
        val dir = modelDir(context, modelId)
        val weights = File(dir, "weights.gguf")
        val tokenizer = File(dir, "tokenizer.json")
        if (!weights.isFile || !tokenizer.isFile) return false
        if (weights.length() < MIN_WEIGHTS_BYTES || tokenizer.length() < MIN_TOKENIZER_BYTES) {
            return false
        }
        return hasValidGgufHeader(weights)
    }

    private fun hasValidGgufHeader(file: File): Boolean {
        return try {
            FileInputStream(file).use { input ->
                val header = ByteArray(4)
                val read = input.read(header)
                read == 4 &&
                    header[0] == 'G'.code.toByte() &&
                    header[1] == 'G'.code.toByte() &&
                    header[2] == 'U'.code.toByte() &&
                    header[3] == 'F'.code.toByte()
            }
        } catch (_: Throwable) {
            false
        }
    }

    fun isServiceRunning(): Boolean = serviceRunning

    fun setServiceRunning(running: Boolean) {
        serviceRunning = running
    }

    fun setJobRunning(running: Boolean) {
        jobRunning = running
    }

    fun pendingModelId(context: Context): String? {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val id = prefs.getString(KEY_PENDING_MODEL_ID, null)
        return findSpec(id)?.id
    }

    fun hasPendingDownload(context: Context): Boolean {
        val id = pendingModelId(context) ?: return false
        return !cancelRequested.get() && !isModelInstalled(context, id)
    }

    fun attachWebView(webView: WebView) {
        webViewRef = WeakReference(webView)
    }

    fun detachWebView(webView: WebView?) {
        val current = webViewRef?.get()
        if (webView == null || current == null || current === webView) {
            webViewRef = null
        }
    }

    fun pushCurrentStateToWebView(context: Context) {
        emitToWebView(snapshotJson(context))
    }

    private fun emitToWebView(json: String) {
        val webView = webViewRef?.get() ?: return
        val quoted = JSONObject.quote(json)
        webView.post {
            try {
                webView.evaluateJavascript(
                    "window.__finaccAiBgEvent && window.__finaccAiBgEvent(JSON.parse($quoted));",
                    null,
                )
            } catch (_: Throwable) {
                // WebView might be torn down while background work continues.
            }
        }
    }

    private fun updateState(
        context: Context,
        modelId: String?,
        status: String,
        stage: String,
        downloadedBytes: Long,
        totalBytes: Long,
        percent: Float,
        error: String? = null,
        pendingModelId: String? = pendingModelId(context),
        emit: Boolean = true,
    ) {
        val appCtx = context.applicationContext
        synchronized(stateLock) {
            appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
                if (pendingModelId != null) putString(KEY_PENDING_MODEL_ID, pendingModelId)
                else remove(KEY_PENDING_MODEL_ID)

                if (modelId != null) putString(KEY_MODEL_ID, modelId)
                else remove(KEY_MODEL_ID)

                putString(KEY_STATUS, status)
                putString(KEY_STAGE, stage)
                putLong(KEY_DOWNLOADED, downloadedBytes)
                putLong(KEY_TOTAL, totalBytes)
                putFloat(KEY_PERCENT, percent)

                if (error != null) putString(KEY_ERROR, error)
                else remove(KEY_ERROR)
            }.apply()
        }
        if (emit) {
            emitToWebView(snapshotJson(appCtx))
        }
    }

    fun snapshotJson(context: Context): String {
        val appCtx = context.applicationContext
        synchronized(stateLock) {
            val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val modelId = prefs.getString(KEY_MODEL_ID, null)
            var status = prefs.getString(KEY_STATUS, "idle") ?: "idle"
            val stage = prefs.getString(KEY_STAGE, "weights") ?: "weights"
            val downloaded = prefs.getLong(KEY_DOWNLOADED, 0L)
            val total = prefs.getLong(KEY_TOTAL, 0L)
            val percent = prefs.getFloat(KEY_PERCENT, 0f)
            val error = prefs.getString(KEY_ERROR, null)
            val pending = prefs.getString(KEY_PENDING_MODEL_ID, null)

            if (status == "done" && (modelId == null || !isModelInstalled(appCtx, modelId))) {
                status = "idle"
            }

            val isActivelyDownloading =
                status == "downloading" || serviceRunning || jobRunning || (!cancelRequested.get() && pending != null)

            return JSONObject().apply {
                put("modelId", modelId ?: pending ?: JSONObject.NULL)
                put("status", status)
                put("stage", stage)
                put("downloadedBytes", downloaded)
                put("totalBytes", total)
                put("percent", percent.toDouble())
                put("error", error ?: JSONObject.NULL)
                put("active", isActivelyDownloading)
            }.toString()
        }
    }

    fun startForegroundDownload(context: Context, modelId: String): Boolean {
        val spec = findSpec(modelId) ?: return false
        val appCtx = context.applicationContext
        cancelRequested.set(false)
        activeGeneration.incrementAndGet()

        if (isModelInstalled(appCtx, spec.id)) {
            updateState(
                context = appCtx,
                modelId = spec.id,
                status = "done",
                stage = "verifying",
                downloadedBytes = spec.approxBytes,
                totalBytes = spec.approxBytes,
                percent = 100f,
                error = null,
                pendingModelId = null,
            )
            return true
        }

        val dir = modelDir(appCtx, spec.id)
        val existingPart = File(dir, "weights.gguf.part").let { if (it.isFile) it.length() else 0L }
        val pct = if (existingPart > 0L) {
            ((existingPart.toDouble() / spec.approxBytes.toDouble()) * 100.0).coerceIn(0.0, 99.5).toFloat()
        } else {
            0f
        }

        updateState(
            context = appCtx,
            modelId = spec.id,
            status = "downloading",
            stage = if (existingPart > 0L) "weights" else "tokenizer",
            downloadedBytes = existingPart,
            totalBytes = spec.approxBytes,
            percent = pct,
            error = null,
            pendingModelId = spec.id,
        )

        scheduleResumeJob(appCtx, 5 * 60_000L)
        val intent = Intent(appCtx, AiDownloadService::class.java).apply {
            action = AiDownloadService.ACTION_START
            putExtra(AiDownloadService.EXTRA_MODEL_ID, spec.id)
        }
        ContextCompat.startForegroundService(appCtx, intent)
        return true
    }

    fun promotePendingDownload(context: Context) {
        val appCtx = context.applicationContext
        val pending = pendingModelId(appCtx) ?: return
        if (cancelRequested.get()) return
        if (isModelInstalled(appCtx, pending)) {
            val spec = findSpec(pending)
            cancelResumeJob(appCtx)
            updateState(
                context = appCtx,
                modelId = pending,
                status = "done",
                stage = "verifying",
                downloadedBytes = spec?.approxBytes ?: 0L,
                totalBytes = spec?.approxBytes ?: 0L,
                percent = 100f,
                error = null,
                pendingModelId = null,
            )
            return
        }
        if (!serviceRunning && !jobRunning) {
            val intent = Intent(appCtx, AiDownloadService::class.java).apply {
                action = AiDownloadService.ACTION_START
                putExtra(AiDownloadService.EXTRA_MODEL_ID, pending)
            }
            try {
                ContextCompat.startForegroundService(appCtx, intent)
            } catch (_: Throwable) {
                scheduleResumeJob(appCtx, 5_000L)
            }
        }
    }

    fun cancelDownload(context: Context) {
        val appCtx = context.applicationContext
        cancelRequested.set(true)
        activeGeneration.incrementAndGet()
        cancelResumeJob(appCtx)

        val targetId = synchronized(stateLock) {
            val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString(KEY_PENDING_MODEL_ID, null) ?: prefs.getString(KEY_MODEL_ID, null)
        }

        activeThread?.interrupt()

        if (targetId != null && findSpec(targetId) != null) {
            val dir = modelDir(appCtx, targetId)
            File(dir, "tokenizer.json.part").delete()
            File(dir, "weights.gguf.part").delete()
        }

        val nm = appCtx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        nm?.cancel(NOTIFICATION_ID_PROGRESS)

        updateState(
            context = appCtx,
            modelId = targetId,
            status = "canceled",
            stage = "weights",
            downloadedBytes = 0L,
            totalBytes = 0L,
            percent = 0f,
            error = "Загрузка отменена пользователем.",
            pendingModelId = null,
        )
    }

    fun scheduleResumeJob(context: Context, delayMs: Long) {
        val appCtx = context.applicationContext
        if (!hasPendingDownload(appCtx)) return
        val scheduler = appCtx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler ?: return
        val info = JobInfo.Builder(
            JOB_ID_RESUME,
            ComponentName(appCtx, AiDownloadResumeJobService::class.java),
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setMinimumLatency(max(1_000L, delayMs))
            .setBackoffCriteria(15_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build()
        try {
            scheduler.schedule(info)
        } catch (_: Throwable) {
            // Some OEM builds may reject if boot permission stripped; foreground retry remains active.
        }
    }

    fun cancelResumeJob(context: Context) {
        val scheduler = context.applicationContext.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler
        scheduler?.cancel(JOB_ID_RESUME)
    }

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (nm.getNotificationChannel(CHANNEL_PROGRESS_ID) == null) {
            val progressChannel = NotificationChannel(
                CHANNEL_PROGRESS_ID,
                "Загрузка ИИ-модели",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Прогресс фонового скачивания локальной ИИ-модели"
                setShowBadge(false)
            }
            nm.createNotificationChannel(progressChannel)
        }
        if (nm.getNotificationChannel(CHANNEL_DONE_ID) == null) {
            val doneChannel = NotificationChannel(
                CHANNEL_DONE_ID,
                "Готовность ИИ-помощника",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Уведомление после завершения загрузки ИИ-модели"
            }
            nm.createNotificationChannel(doneChannel)
        }
    }

    fun buildProgressNotification(
        context: Context,
        modelName: String,
        stageText: String,
        percent: Float,
        downloadedBytes: Long,
        totalBytes: Long,
    ): Notification {
        ensureChannels(context)
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPending = PendingIntent.getActivity(
            context,
            1,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val cancelIntent = Intent(context, AiDownloadCancelReceiver::class.java)
        val cancelPending = PendingIntent.getBroadcast(
            context,
            2,
            cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val pctInt = percent.toInt().coerceIn(0, 100)
        val detail = if (totalBytes > 0L) {
            "$stageText • ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}"
        } else {
            stageText
        }

        return NotificationCompat.Builder(context, CHANNEL_PROGRESS_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Установка $modelName")
            .setContentText(detail)
            .setSubText(if (pctInt > 0) "$pctInt%" else null)
            .setProgress(100, pctInt, pctInt == 0 && stageText.contains("токенизатор", ignoreCase = true))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(contentPending)
            .addAction(0, "Отменить", cancelPending)
            .build()
    }

    @SuppressLint("MissingPermission")
    fun safeNotify(context: Context, notificationId: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        try {
            nm.notify(notificationId, notification)
        } catch (_: SecurityException) {
            // Permission may be revoked concurrently.
        }
    }

    private fun showDoneNotification(context: Context, modelName: String) {
        ensureChannels(context)
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        nm?.cancel(NOTIFICATION_ID_PROGRESS)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPending = PendingIntent.getActivity(
            context,
            3,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(context, CHANNEL_DONE_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("ИИ-помощник готов к работе")
            .setContentText("$modelName установлен. Нажмите ✨ в приложении.")
            .setAutoCancel(true)
            .setContentIntent(contentPending)
            .build()
        safeNotify(context, NOTIFICATION_ID_DONE, notif)
    }

    private fun showErrorNotification(context: Context, message: String) {
        ensureChannels(context)
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        nm?.cancel(NOTIFICATION_ID_PROGRESS)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPending = PendingIntent.getActivity(
            context,
            4,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(context, CHANNEL_DONE_ID)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle("Загрузка ИИ приостановлена")
            .setContentText(message)
            .setAutoCancel(true)
            .setContentIntent(contentPending)
            .build()
        safeNotify(context, NOTIFICATION_ID_DONE, notif)
    }

    fun formatBytes(bytes: Long): String {
        if (bytes <= 0L) return "0 МБ"
        val gb = bytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
        if (gb >= 1.0) return String.format(java.util.Locale.US, "%.2f ГБ", gb)
        val mb = max(1L, bytes / (1024L * 1024L))
        return "$mb МБ"
    }

    fun downloadModel(
        context: Context,
        modelId: String,
        onNotificationUpdate: ((stageText: String, downloaded: Long, total: Long, percent: Float) -> Unit)? = null,
    ): DownloadOutcome {
        val spec = findSpec(modelId) ?: return DownloadOutcome.Failed("Неизвестная модель ИИ: $modelId")
        val appCtx = context.applicationContext

        synchronized(downloadLock) {
            activeThread = Thread.currentThread()
            try {
                if (cancelRequested.get()) return DownloadOutcome.Canceled
                if (isModelInstalled(appCtx, spec.id)) {
                    cancelResumeJob(appCtx)
                    updateState(
                        context = appCtx,
                        modelId = spec.id,
                        status = "done",
                        stage = "verifying",
                        downloadedBytes = spec.approxBytes,
                        totalBytes = spec.approxBytes,
                        percent = 100f,
                        pendingModelId = null,
                    )
                    showDoneNotification(appCtx, spec.name)
                    return DownloadOutcome.Done
                }

                val dir = modelDir(appCtx, spec.id)
                if (!dir.exists() && !dir.mkdirs()) {
                    val err = "Не удалось создать каталог для модели."
                    updateState(appCtx, spec.id, "error", "tokenizer", 0L, spec.approxBytes, 0f, err, pendingModelId = spec.id)
                    return DownloadOutcome.Failed(err)
                }

                val tokenizerFile = File(dir, "tokenizer.json")
                val tokenizerPart = File(dir, "tokenizer.json.part")
                val weightsFile = File(dir, "weights.gguf")
                val weightsPart = File(dir, "weights.gguf.part")

                if (!tokenizerFile.isFile || tokenizerFile.length() < MIN_TOKENIZER_BYTES) {
                    tokenizerPart.delete()
                    updateState(appCtx, spec.id, "downloading", "tokenizer", 0L, spec.approxBytes, 0f, pendingModelId = spec.id)
                    onNotificationUpdate?.invoke("Подготовка токенизатора...", 0L, spec.approxBytes, 0f)

                    when (val tokRes = downloadWithRetries(
                        appCtx = appCtx,
                        spec = spec,
                        url = spec.tokenizerUrl,
                        partFile = tokenizerPart,
                        allowResume = false,
                        stage = "tokenizer",
                        onNotificationUpdate = onNotificationUpdate,
                    )) {
                        DownloadOutcome.Done -> Unit
                        else -> return tokRes
                    }

                    if (!tokenizerPart.isFile || tokenizerPart.length() < MIN_TOKENIZER_BYTES) {
                        tokenizerPart.delete()
                        val err = "Скачанный токенизатор повреждён или неполный."
                        updateState(appCtx, spec.id, "error", "tokenizer", 0L, spec.approxBytes, 0f, err, pendingModelId = null)
                        showErrorNotification(appCtx, err)
                        return DownloadOutcome.Failed(err)
                    }
                    if (!renameReplacing(tokenizerPart, tokenizerFile)) {
                        val err = "Не удалось сохранить tokenizer.json."
                        updateState(appCtx, spec.id, "error", "tokenizer", 0L, spec.approxBytes, 0f, err, pendingModelId = spec.id)
                        return DownloadOutcome.Failed(err)
                    }
                }

                if (cancelRequested.get()) return DownloadOutcome.Canceled

                when (val weightsRes = downloadWithRetries(
                    appCtx = appCtx,
                    spec = spec,
                    url = spec.weightsUrl,
                    partFile = weightsPart,
                    allowResume = true,
                    stage = "weights",
                    onNotificationUpdate = onNotificationUpdate,
                )) {
                    DownloadOutcome.Done -> Unit
                    else -> return weightsRes
                }

                val verifyingTotal = max(spec.approxBytes, weightsPart.length())
                updateState(appCtx, spec.id, "downloading", "verifying", verifyingTotal, verifyingTotal, 99.8f, pendingModelId = spec.id)
                onNotificationUpdate?.invoke("Проверка целостности GGUF...", verifyingTotal, verifyingTotal, 99.8f)

                if (!weightsPart.isFile || weightsPart.length() < MIN_WEIGHTS_BYTES) {
                    val err = "Файл весов модели скачался не полностью."
                    updateState(appCtx, spec.id, "error", "verifying", weightsPart.length(), verifyingTotal, 0f, err, pendingModelId = spec.id)
                    showErrorNotification(appCtx, err)
                    return DownloadOutcome.Failed(err)
                }

                if (!hasValidGgufHeader(weightsPart)) {
                    weightsPart.delete()
                    tokenizerPart.delete()
                    val err = "Скачанный файл не является корректной моделью GGUF."
                    updateState(appCtx, spec.id, "error", "verifying", 0L, spec.approxBytes, 0f, err, pendingModelId = null)
                    showErrorNotification(appCtx, err)
                    return DownloadOutcome.Failed(err)
                }

                if (!renameReplacing(weightsPart, weightsFile)) {
                    val err = "Не удалось сохранить weights.gguf."
                    updateState(appCtx, spec.id, "error", "verifying", verifyingTotal, verifyingTotal, 99.8f, err, pendingModelId = spec.id)
                    return DownloadOutcome.Failed(err)
                }

                val finalSize = weightsFile.length()
                cancelResumeJob(appCtx)
                updateState(
                    context = appCtx,
                    modelId = spec.id,
                    status = "done",
                    stage = "verifying",
                    downloadedBytes = finalSize,
                    totalBytes = finalSize,
                    percent = 100f,
                    error = null,
                    pendingModelId = null,
                )
                showDoneNotification(appCtx, spec.name)
                return DownloadOutcome.Done
            } finally {
                if (activeThread === Thread.currentThread()) {
                    activeThread = null
                }
            }
        }
    }

    private fun renameReplacing(src: File, dst: File): Boolean {
        if (dst.exists() && !dst.delete()) return false
        return src.renameTo(dst)
    }

    private fun downloadWithRetries(
        appCtx: Context,
        spec: ModelSpec,
        url: String,
        partFile: File,
        allowResume: Boolean,
        stage: String,
        onNotificationUpdate: ((String, Long, Long, Float) -> Unit)?,
    ): DownloadOutcome {
        var attempt = 0
        var resetRangeOnce = false

        while (true) {
            if (cancelRequested.get()) {
                partFile.delete()
                return DownloadOutcome.Canceled
            }
            if (Thread.currentThread().isInterrupted) {
                return DownloadOutcome.Interrupted
            }

            try {
                streamWithRange(
                    appCtx = appCtx,
                    spec = spec,
                    initialUrl = url,
                    partFile = partFile,
                    allowResume = allowResume,
                    stage = stage,
                    onNotificationUpdate = onNotificationUpdate,
                )
                return DownloadOutcome.Done
            } catch (e: ResetRangeException) {
                if (!resetRangeOnce) {
                    resetRangeOnce = true
                    partFile.delete()
                    continue
                }
                val err = "Сервер отклонил диапазон докачки. Попробуйте заново."
                updateState(appCtx, spec.id, "error", stage, 0L, spec.approxBytes, 0f, err, pendingModelId = spec.id)
                return DownloadOutcome.Failed(err)
            } catch (_: CanceledException) {
                partFile.delete()
                return DownloadOutcome.Canceled
            } catch (_: InterruptedException) {
                return DownloadOutcome.Interrupted
            } catch (e: HttpStatusException) {
                val err = "Сервер моделей вернул HTTP ${e.code} при загрузке."
                updateState(
                    appCtx,
                    spec.id,
                    "error",
                    stage,
                    if (partFile.isFile) partFile.length() else 0L,
                    spec.approxBytes,
                    0f,
                    err,
                    pendingModelId = spec.id,
                )
                showErrorNotification(appCtx, err)
                return DownloadOutcome.Failed(err)
            } catch (e: IOException) {
                attempt++
                val savedBytes = if (partFile.isFile) partFile.length() else 0L
                val pct = ((savedBytes.toDouble() / spec.approxBytes.toDouble()) * 100.0).coerceIn(0.0, 99.5).toFloat()

                if (attempt > MAX_RETRIES) {
                    val err = "Нет стабильного интернета (${e.message ?: "сбой сети"}). Загрузка продолжится автоматически."
                    updateState(appCtx, spec.id, "error", "waiting", savedBytes, spec.approxBytes, pct, err, pendingModelId = spec.id)
                    showErrorNotification(appCtx, "Ожидание сети — докачается с ${formatBytes(savedBytes)}.")
                    return DownloadOutcome.Failed(err)
                }

                updateState(appCtx, spec.id, "downloading", "waiting", savedBytes, spec.approxBytes, pct, null, pendingModelId = spec.id)
                onNotificationUpdate?.invoke("Ожидание сети...", savedBytes, spec.approxBytes, pct)

                val delayMs = min(30_000L, 3_000L shl min(attempt - 1, 3))
                var slept = 0L
                while (slept < delayMs) {
                    if (cancelRequested.get()) {
                        partFile.delete()
                        return DownloadOutcome.Canceled
                    }
                    if (Thread.currentThread().isInterrupted) {
                        return DownloadOutcome.Interrupted
                    }
                    try {
                        Thread.sleep(250L)
                    } catch (_: InterruptedException) {
                        return DownloadOutcome.Interrupted
                    }
                    slept += 250L
                }
            }
        }
    }

    private class ResetRangeException : Exception()
    private class CanceledException : Exception()
    private class HttpStatusException(val code: Int) : Exception("HTTP $code")

    private fun openFollowingRedirects(
        startUrl: String,
        rangeOffset: Long,
    ): HttpURLConnection {
        var currentUrl = startUrl
        for (redirectCount in 0..MAX_REDIRECTS) {
            if (cancelRequested.get()) throw CanceledException()
            if (Thread.currentThread().isInterrupted) throw InterruptedException()

            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 45_000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "finacc/0.2.0")
                setRequestProperty("Accept-Encoding", "identity")
                if (rangeOffset > 0L) {
                    setRequestProperty("Range", "bytes=$rangeOffset-")
                }
            }

            val code = conn.responseCode
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                val location = conn.getHeaderField("Location")
                conn.disconnect()
                if (location.isNullOrBlank()) {
                    throw IOException("Пустой redirect Location (HTTP $code)")
                }
                currentUrl = URL(URL(currentUrl), location).toString()
                continue
            }
            return conn
        }
        throw IOException("Слишком много перенаправлений HTTP")
    }

    private fun parseContentRangeTotal(header: String?): Long? {
        if (header.isNullOrBlank()) return null
        val slash = header.lastIndexOf('/')
        if (slash < 0 || slash + 1 >= header.length) return null
        val tail = header.substring(slash + 1).trim()
        return tail.toLongOrNull()?.takeIf { it > 0L }
    }

    private fun streamWithRange(
        appCtx: Context,
        spec: ModelSpec,
        initialUrl: String,
        partFile: File,
        allowResume: Boolean,
        stage: String,
        onNotificationUpdate: ((String, Long, Long, Float) -> Unit)?,
    ) {
        val existingOffset = if (allowResume && partFile.isFile) partFile.length() else 0L
        val conn = openFollowingRedirects(initialUrl, existingOffset)

        try {
            val code = conn.responseCode
            if (code == 416 && existingOffset > 0L) {
                throw ResetRangeException()
            }
            if (code !in 200..299) {
                throw HttpStatusException(code)
            }

            val isPartial = code == HttpURLConnection.HTTP_PARTIAL && existingOffset > 0L
            val contentLength = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                conn.contentLengthLong
            } else {
                conn.contentLength.toLong()
            }

            val startOffset = if (isPartial) existingOffset else 0L
            val totalBytes = when {
                isPartial -> {
                    parseContentRangeTotal(conn.getHeaderField("Content-Range"))
                        ?: if (contentLength > 0L) existingOffset + contentLength else spec.approxBytes
                }
                contentLength > 0L -> contentLength
                else -> spec.approxBytes
            }.coerceAtLeast(1L)

            val buffer = ByteArray(64 * 1024)
            var downloaded = startOffset
            var lastNotifyMs = 0L
            var lastPercent = -1

            if (stage == "weights") {
                val initPct = ((downloaded.toDouble() / totalBytes.toDouble()) * 100.0).coerceIn(0.0, 99.5).toFloat()
                updateState(appCtx, spec.id, "downloading", stage, downloaded, totalBytes, initPct, null, pendingModelId = spec.id)
                onNotificationUpdate?.invoke("Загрузка модели...", downloaded, totalBytes, initPct)
            }

            conn.inputStream.use { input ->
                FileOutputStream(partFile, isPartial).use { output ->
                    while (true) {
                        if (cancelRequested.get()) throw CanceledException()
                        if (Thread.currentThread().isInterrupted) throw InterruptedException()

                        val read = input.read(buffer)
                        if (read == -1) break
                        if (read > 0) {
                            output.write(buffer, 0, read)
                            downloaded += read.toLong()

                            if (stage == "weights") {
                                val pct = ((downloaded.toDouble() / totalBytes.toDouble()) * 100.0)
                                    .coerceIn(0.0, 99.5)
                                    .toFloat()
                                val wholePct = pct.toInt()
                                val now = System.currentTimeMillis()
                                if (wholePct != lastPercent || now - lastNotifyMs >= 250L) {
                                    lastPercent = wholePct
                                    lastNotifyMs = now
                                    updateState(
                                        context = appCtx,
                                        modelId = spec.id,
                                        status = "downloading",
                                        stage = stage,
                                        downloadedBytes = downloaded,
                                        totalBytes = totalBytes,
                                        percent = pct,
                                        pendingModelId = spec.id,
                                    )
                                    onNotificationUpdate?.invoke("Загрузка модели...", downloaded, totalBytes, pct)
                                }
                            }
                        }
                    }
                    output.flush()
                }
            }
        } finally {
            conn.disconnect()
        }
    }
}
