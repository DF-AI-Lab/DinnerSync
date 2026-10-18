package com.dfailab.dinnersync.beta

import android.Manifest
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray

/** The page's DinnerAlarms: schedule / cancel alarms, collect taps made on them, and ask for permissions once. */
@CapacitorPlugin(name = "DinnerAlarms")
class DinnerAlarmsPlugin : Plugin() {
    companion object {
        @Volatile var instance: DinnerAlarmsPlugin? = null
        private val STEPS = listOf("notifications", "exact", "fullscreen", "battery")
    }

    override fun load() {
        instance = this
    }

    /** A tap was queued; tell the page to come and get it. */
    fun tell() = notifyListeners("alarmEvent", JSObject())

    @PluginMethod
    fun schedule(call: PluginCall) {
        try {
            val arr = call.data.getJSONArray("alarms")
            for (i in 0 until arr.length()) {
                Scheduler.schedule(context, Alarm.fromJson(arr.getJSONObject(i)))
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "bad alarms")
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val arr = call.data.optJSONArray("ids") ?: JSONArray()
        for (i in 0 until arr.length()) Scheduler.cancel(context, arr.getString(i))
        call.resolve()
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        Scheduler.cancelAll(context)
        call.resolve()
    }

    @PluginMethod
    fun takePending(call: PluginCall) {
        call.resolve(JSObject().put("events", AlarmStore.takeEvents(context)))
    }

    /** Asks for each permission once, with a plain explanation first. */
    @PluginMethod
    fun setup(call: PluginCall) {
        activity.runOnUiThread { advance() }
        call.resolve()
    }

    override fun handleOnResume() {
        // Back from a system screen or dialog: on to the next permission.
        if (AlarmStore.flag(context, "setup_running")) advance()
    }

    private fun needed(step: String): Boolean = when (step) {
        "notifications" -> Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        "exact" -> Build.VERSION.SDK_INT >= 31 &&
            !context.getSystemService(android.app.AlarmManager::class.java).canScheduleExactAlarms()
        "fullscreen" -> Build.VERSION.SDK_INT >= 34 &&
            !context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
        "battery" -> !context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
        else -> false
    }

    private fun why(step: String) = when (step) {
        "notifications" -> "DinnerSync shows a notification when a step is due. Tap Allow on the next screen."
        "exact" -> "Alarms must ring at the exact minute. On the next screen, switch \"Allow\" on for DinnerSync."
        "fullscreen" -> "So the alarm can light up the screen when your phone is locked. On the next screen, switch it on."
        else -> "Optional. Stops the phone putting DinnerSync to sleep while you cook. Tap Allow on the next screen."
    }

    private fun launch(step: String) {
        val pkg = Uri.parse("package:${context.packageName}")
        when (step) {
            "notifications" -> ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4001)
            "exact" -> if (Build.VERSION.SDK_INT >= 31) activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg))
            "fullscreen" -> if (Build.VERSION.SDK_INT >= 34) activity.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg))
            "battery" -> activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))
        }
    }

    private fun advance() {
        AlarmStore.setFlag(context, "setup_running")
        val step = STEPS.firstOrNull { needed(it) && !AlarmStore.flag(context, "asked_$it") }
        if (step == null) return
        AlarmStore.setFlag(context, "asked_$step")
        AlertDialog.Builder(activity)
            .setTitle("Set up alarms")
            .setMessage(why(step))
            .setCancelable(false)
            .setPositiveButton("Continue") { _, _ -> launch(step) }
            .setNegativeButton("Skip") { _, _ -> advance() }
            .show()
    }
}
