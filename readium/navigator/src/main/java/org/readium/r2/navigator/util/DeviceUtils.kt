package org.readium.r2.navigator.util

import android.os.Build

private val arcDeviceRegex = Regex(".+_cheets|cheets_.+")
private var isChromebook: Boolean? = null

internal fun isChromeBook():Boolean{
    if(isChromebook == null){
        isChromebook = (Build.DEVICE != null && Build.DEVICE.matches(arcDeviceRegex))
    }
    return isChromebook ?: false
}