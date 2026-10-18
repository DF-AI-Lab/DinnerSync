package com.dfailab.dinnersync.beta

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The buttons on the notifications: Stop alarm, Done, On it, Ignore. Each is also queued for the page. */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val step = id.substringBefore(':').toIntOrNull() ?: -1
        val nm = context.getSystemService(NotificationManager::class.java)
        val type = when (intent.action) {
            Notifs.STOP -> {
                context.stopService(Intent(context, AlarmService::class.java))
                "alarm-stop"
            }
            Notifs.DONE -> {
                context.stopService(Intent(context, AlarmService::class.java))
                Scheduler.cancelStep(context, step) // that step is finished: nothing more rings for it
                "alarm-done"
            }
            Notifs.ONIT -> {
                nm.cancel(Notifs.HEADS_ID)
                Scheduler.cancel(context, "$step:start") // already started: no on-time alarm
                "heads-onit"
            }
            Notifs.IGNORE -> {
                nm.cancel(Notifs.HEADS_ID)
                "heads-ignore"
            }
            else -> return
        }
        AlarmStore.addEvent(context, type, id)
        DinnerAlarmsPlugin.instance?.tell()
    }
}
