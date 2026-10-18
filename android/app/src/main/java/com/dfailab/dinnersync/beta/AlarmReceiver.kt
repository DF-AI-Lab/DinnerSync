package com.dfailab.dinnersync.beta

import android.app.Notification
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

/** Wakes at the alarm time (RING) or shortly before it (HEADS). */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        // Gone from the store means the page cancelled it after this was queued: stay quiet.
        val alarm = AlarmStore.find(context, id) ?: return
        Notifs.channels(context)
        when (intent.action) {
            Scheduler.RING -> {
                AlarmStore.remove(context, id)
                val svc = Intent(context, AlarmService::class.java).putExtra("id", alarm.id)
                    .putExtra("title", alarm.title).putExtra("body", alarm.body)
                context.startForegroundService(svc)
            }
            Scheduler.HEADS -> {
                val n = NotificationCompat.Builder(context, Notifs.HEADS_CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                    .setContentTitle("Coming up soon")
                    .setContentText(alarm.title)
                    .setCategory(Notification.CATEGORY_REMINDER)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(Notifs.openApp(context))
                    .setTimeoutAfter(120_000)
                    .addAction(0, "On it", Notifs.action(context, Notifs.ONIT, id))
                    .addAction(0, "Ignore", Notifs.action(context, Notifs.IGNORE, id))
                    .build()
                context.getSystemService(NotificationManager::class.java).notify(Notifs.HEADS_ID, n)
            }
        }
    }
}
