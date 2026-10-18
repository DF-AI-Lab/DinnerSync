package com.dfailab.dinnersync.beta

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat

/** Rings: the phone's alarm tone on the alarm stream, vibration, and a full-screen notification. Loops until Stop or Done. */
class AlarmService : Service() {
    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private val giveUp = Runnable { stopSelf() } // never ring for ever if the phone is left alone

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra("id") ?: run { stopSelf(); return START_NOT_STICKY }
        val title = intent.getStringExtra("title") ?: "DinnerSync"
        val body = intent.getStringExtra("body") ?: ""
        Notifs.channels(this)
        val n = NotificationCompat.Builder(this, Notifs.RING_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(Notifs.openApp(this))
            .setFullScreenIntent(Notifs.openApp(this), true)
            .addAction(0, "Stop alarm", Notifs.action(this, Notifs.STOP, id))
            .addAction(0, "Done ✓", Notifs.action(this, Notifs.DONE, id))
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(Notifs.RING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(Notifs.RING_ID, n)
        }
        startSound()
        startVibration()
        handler.removeCallbacks(giveUp)
        handler.postDelayed(giveUp, 30 * 60_000L)
        return START_NOT_STICKY
    }

    private fun startSound() {
        if (player?.isPlaying == true) return
        val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        try {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                )
                setDataSource(this@AlarmService, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            player?.release()
            player = null
        }
    }

    private fun vibrator(): Vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator

    private fun startVibration() {
        val pattern = longArrayOf(0, 600, 400)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator().vibrate(
                VibrationEffect.createWaveform(pattern, 0),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
            )
        } else {
            @Suppress("DEPRECATION") vibrator().vibrate(pattern, 0)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(giveUp)
        player?.run { runCatching { stop() }; release() }
        player = null
        vibrator().cancel()
        super.onDestroy()
    }
}
