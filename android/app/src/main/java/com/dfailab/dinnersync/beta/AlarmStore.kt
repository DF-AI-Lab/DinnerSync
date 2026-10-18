package com.dfailab.dinnersync.beta

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One alarm the page asked for. id is "<step index>:start" or "<step index>:end". */
data class Alarm(val id: String, val at: Long, val title: String, val body: String, val headsUpAt: Long?) {
    val step: Int get() = id.substringBefore(':').toIntOrNull() ?: -1

    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("at", at).put("title", title).put("body", body)
        .put("headsUpAt", headsUpAt ?: JSONObject.NULL)

    companion object {
        fun fromJson(o: JSONObject) = Alarm(
            o.getString("id"), o.getLong("at"), o.optString("title"), o.optString("body"),
            if (o.isNull("headsUpAt")) null else o.getLong("headsUpAt"),
        )
    }
}

/** What the phone holds (so a reboot can bring the alarms back) and the taps waiting for the page. */
object AlarmStore {
    private const val FILE = "dinnersync_alarms"
    private fun prefs(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    @Synchronized
    fun alarms(c: Context): List<Alarm> {
        val arr = JSONArray(prefs(c).getString("alarms", "[]"))
        return (0 until arr.length()).map { Alarm.fromJson(arr.getJSONObject(it)) }
    }

    @Synchronized
    private fun save(c: Context, list: List<Alarm>) {
        prefs(c).edit().putString("alarms", JSONArray(list.map { it.toJson() }).toString()).apply()
    }

    @Synchronized fun put(c: Context, a: Alarm) = save(c, alarms(c).filter { it.id != a.id } + a)
    @Synchronized fun remove(c: Context, id: String) = save(c, alarms(c).filter { it.id != id })
    @Synchronized fun find(c: Context, id: String): Alarm? = alarms(c).firstOrNull { it.id == id }

    /** Taps (Stop alarm, Done, On it, Ignore) wait here until the page is open to take them. */
    @Synchronized
    fun addEvent(c: Context, type: String, id: String) {
        val arr = JSONArray(prefs(c).getString("events", "[]"))
        arr.put(JSONObject().put("type", type).put("id", id))
        prefs(c).edit().putString("events", arr.toString()).apply()
    }

    @Synchronized
    fun takeEvents(c: Context): JSONArray {
        val arr = JSONArray(prefs(c).getString("events", "[]"))
        prefs(c).edit().remove("events").apply()
        return arr
    }

    fun flag(c: Context, name: String) = prefs(c).getBoolean(name, false)
    fun setFlag(c: Context, name: String) = prefs(c).edit().putBoolean(name, true).apply()
}
