package expo.modules.neurexforegroundservice

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NeurexForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NeurexForegroundService")

    Function("start") { title: String, body: String ->
      val context = appContext.reactContext ?: return@Function
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
      // Force a Unit return. startService/startForegroundService return
      // ComponentName?, which would otherwise make this an Any?-returning
      // Function and turn the bare `return@Function` guard above into a K2
      // "return type mismatch" compile error.
      Unit
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, NeurexForegroundService::class.java).apply {
        action = NeurexForegroundService.ACTION_STOP
      }
      context.startService(intent)
      Unit // keep this a Unit-returning Function (see note in "start")
    }
  }
}
