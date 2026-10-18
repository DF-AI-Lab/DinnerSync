package com.dfailab.dinnersync.beta

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/** Puts alarms into Android's AlarmManager. setAlarmClock is exact and survives Doze and the app being closed. */
object Scheduler {
    const val RING = "com.dfailab.dinnersync.beta.RING"
    const val HEADS = "com.dfailab.dinnersync.beta.HEADS"

    private fun pending(c: Context, action: String, id: String): PendingIntent {
        val i = Intent(c, AlarmReceiver::class.java).setAction(action)
            .setData(Uri.parse("dinnersync://$action/$id")).putExtra("id", id)
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun canExact(am: AlarmManager) = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()

    fun schedule(c: Context, a: Alarm, now: Long = System.currentTimeMillis()) {
        if (a.at <= now) return
        AlarmStore.put(c, a)
        val am = c.getSystemService(AlarmManager::class.java)
        val show = PendingIntent.getActivity(
            c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        try {
            am.setAlarmClock(AlarmManager.AlarmClockInfo(a.at, show), pending(c, RING, a.id))
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, pending(c, RING, a.id))
        }
        val heads = a.headsUpAt
        if (heads != null && heads > now) {
            if (canExact(am)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, heads, pending(c, HEADS, a.id))
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, heads, pending(c, HEADS, a.id))
        }
    }

    fun cancel(c: Context, id: String) {
        val am = c.getSystemService(AlarmManager::class.java)
        am.cancel(pending(c, RING, id))
        am.cancel(pending(c, HEADS, id))
        AlarmStore.remove(c, id)
    }

    /** Everything belonging to one step ("<n>:start", "<n>:end"). */
    fun cancelStep(c: Context, step: Int) {
        AlarmStore.alarms(c).filter { it.step == step }.forEach { cancel(c, it.id) }
    }

    fun cancelAll(c: Context) = AlarmStore.alarms(c).forEach { cancel(c, it.id) }

    /** After a reboot Android forgets every alarm; put the ones still to come back. */
    fun restore(c: Context) = AlarmStore.alarms(c).forEach { schedule(c, it) }
}
