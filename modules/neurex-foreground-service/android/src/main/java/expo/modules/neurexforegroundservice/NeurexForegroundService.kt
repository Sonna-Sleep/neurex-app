package expo.modules.neurexforegroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class NeurexForegroundService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.neurexforegroundservice.START"
    const val ACTION_STOP = "expo.modules.neurexforegroundservice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val CHANNEL_ID = "neurex_recording"
    const val NOTIFICATION_ID = 7001
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopForegroundCompat()
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Neurex"
        val body = intent?.getStringExtra(EXTRA_BODY) ?: "Recording your sleep…"
        startInForeground(title, body)
      }
    }
    // START_NOT_STICKY: if the OS kills the process, the RN/JS runtime is gone
    // and nothing would be writing to disk — a recreated service would show a
    // "Recording…" notification over a dead recording. Better to stay down than
    // to lie. (The foreground service + a plugged-in phone overnight is what
    // prevents the kill in the first place.)
    return START_NOT_STICKY
  }

  private fun startInForeground(title: String, body: String) {
    createChannel()
    val notification = buildNotification(title, body)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14+ requires the type at startForeground time.
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Sleep recording",
          NotificationManager.IMPORTANCE_LOW // no sound, quiet
        ).apply {
          description = "Keeps the EEG recording alive while you sleep."
          setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
      }
    }
  }

  private fun buildNotification(title: String, body: String): Notification {
    val builder = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
    // Tapping the notification re-opens the app's launcher activity. But
    // getLaunchIntentForPackage can return null, and PendingIntent.getActivity
    // with a null intent throws — which would crash before startForeground
    // completes (ANR risk). Only attach the tap action when we have an intent.
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    if (launchIntent != null) {
      val contentIntent = PendingIntent.getActivity(
        this,
        0,
        launchIntent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      builder.setContentIntent(contentIntent)
    }
    return builder.build()
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  override fun onDestroy() {
    stopForegroundCompat()
    super.onDestroy()
  }
}
