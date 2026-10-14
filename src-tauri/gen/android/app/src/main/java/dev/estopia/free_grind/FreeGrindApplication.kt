package dev.estopia.free_grind

import android.app.Application

class FreeGrindApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PushFirebase.initialize(this)
    }
}