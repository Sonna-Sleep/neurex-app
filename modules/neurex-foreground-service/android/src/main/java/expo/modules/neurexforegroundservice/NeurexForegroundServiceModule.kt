package expo.modules.neurexforegroundservice

import android.content.Intent
import android.os.Build
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
    Function("start") { title: String, body: String ->
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        try {
          val intent = Intent(context, NeurexForegroundService::class.java).apply {
            action = NeurexForegroundService.ACTION_START
            putExtra(NeurexForegroundService.EXTRA_TITLE, title)
            putExtra(NeurexForegroundService.EXTRA_BODY, body)
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
  }
}
