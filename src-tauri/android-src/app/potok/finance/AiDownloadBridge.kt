package app.potok.finance

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class AiDownloadBridge(
    private val activity: Activity,
    private val webView: WebView,
) {
    companion object {
        private const val REQ_POST_NOTIFICATIONS = 42071
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @JavascriptInterface
    fun startDownload(modelId: String): String {
        val appCtx = activity.applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                appCtx,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                activity.runOnUiThread {
                    try {
                        ActivityCompat.requestPermissions(
                            activity,
                            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                            REQ_POST_NOTIFICATIONS,
                        )
                    } catch (_: Throwable) {
                        // Notification permission denial must not block download start.
                    }
                }
            }
        }

        AiDownloadEngine.attachWebView(webView)
        AiDownloadEngine.startForegroundDownload(appCtx, modelId)
        return AiDownloadEngine.snapshotJson(appCtx)
    }

    @JavascriptInterface
    fun cancelDownload() {
        AiDownloadEngine.cancelDownload(activity.applicationContext)
    }

    @JavascriptInterface
    fun getStateJson(): String = AiDownloadEngine.snapshotJson(activity.applicationContext)

    @JavascriptInterface
    fun resumePendingIfNeeded() {
        AiDownloadEngine.attachWebView(webView)
        AiDownloadEngine.promotePendingDownload(activity.applicationContext)
        AiDownloadEngine.pushCurrentStateToWebView(activity.applicationContext)
    }
}
