package com.dfailab.dinnersync.beta

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

object Notifs {
    const val RING_CHANNEL = "ring"
    const val HEADS_CHANNEL = "heads"
    const val RING_ID = 4101
    const val HEADS_ID = 4102

    const val STOP = "com.dfailab.dinnersync.beta.STOP"
    const val DONE = "com.dfailab.dinnersync.beta.DONE"
    const val ONIT = "com.dfailab.dinnersync.beta.ONIT"
    const val IGNORE = "com.dfailab.dinnersync.beta.IGNORE"

    fun channels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        // The service plays the sound itself, on the alarm stream, so the channel is silent.
        nm.createNotificationChannel(NotificationChannel(RING_CHANNEL, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null)
            enableVibration(false)
            setBypassDnd(true)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        })
        nm.createNotificationChannel(NotificationChannel(HEADS_CHANNEL, "Coming up", NotificationManager.IMPORTANCE_DEFAULT))
    }

    /** A button on a notification: goes to ActionReceiver. */
    fun action(c: Context, action: String, id: String): PendingIntent {
        val i = Intent(c, ActionReceiver::class.java).setAction(action).setData(Uri.parse("dinnersync://$action/$id")).putExtra("id", id)
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun openApp(c: Context): PendingIntent {
        val i = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
