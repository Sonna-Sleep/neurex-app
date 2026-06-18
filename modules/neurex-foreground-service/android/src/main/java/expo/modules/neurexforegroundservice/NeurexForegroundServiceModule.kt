package expo.modules.neurexforegroundservice

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NeurexForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NeurexForegroundService")

    // NOTE: these bodies use `if (context != null) { ... }` rather than an
    // elvis `?: return@Function` guard ON PURPOSE. The Expo Function DSL types
    // the body's expected return as Any?, so a bare `return@Function` (which
    // returns Unit) is a K2 "return type mismatch: expected Any?, actual Unit"
    // compile error. An if-without-else is always Unit and needs no early
    // return, so it sidesteps the issue entirely.

    // Returns Boolean so JS can verify the service actually started: true if the
    // start intent dispatched, false if there's no context or it threw (e.g.
    // Android 12+ ForegroundServiceStartNotAllowedException when started from the
    // background). Both branches yield Boolean, so there's no K2 Unit-return
    // mismatch (unlike a bare `return@Function`).
    Function("start") { title: String, body: String, startMs: Double ->
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        try {
          val intent = Intent(context, NeurexForegroundService::class.java).apply {
            action = NeurexForegroundService.ACTION_START
            putExtra(NeurexForegroundService.EXTRA_TITLE, title)
            putExtra(NeurexForegroundService.EXTRA_BODY, body)
            putExtra(NeurexForegroundService.EXTRA_START_MS, startMs.toLong())
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
          } else {
            context.startService(intent)
          }
          true
        } catch (e: Exception) {
          false
        }
      }
    }

    Function("stop") {
      val context = appContext.reactContext
      if (context != null) {
        val intent = Intent(context, NeurexForegroundService::class.java).apply {
          action = NeurexForegroundService.ACTION_STOP
        }
        context.startService(intent)
      }
    }

    // True if the app is already exempt from Doze battery optimization. Lets JS
    // skip prompting when there's nothing to ask for. if/else (not elvis) for the
    // same K2 Any?-vs-Unit reason documented on `start` above.
    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm == null) {
          false
        } else {
          pm.isIgnoringBatteryOptimizations(context.packageName)
        }
      }
    }

    // Ask the OS to exempt the app from Doze so an overnight BLE recording isn't
    // throttled with the screen off. Returns true if already exempt or the system
    // dialog was launched; false if there's no context or it threw. The
    // connectedDevice foreground service is the primary keep-alive — this is
    // additional insurance for long unattended nights.
    Function("requestIgnoreBatteryOptimizations") {
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm != null && pm.isIgnoringBatteryOptimizations(context.packageName)) {
          true
        } else {
          try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
              data = Uri.parse("package:" + context.packageName)
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
          } catch (e: Exception) {
            false
          }
        }
      }
    }
  }
}
