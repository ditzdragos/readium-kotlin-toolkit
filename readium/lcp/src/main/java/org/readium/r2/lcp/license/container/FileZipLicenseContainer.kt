/*
 * Module: r2-lcp-kotlin
 * Developers: Aferdita Muriqi, Mickaël Menu
 *
 * Copyright (c) 2019. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

package org.readium.r2.lcp.license.container

import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.ZipFile
import org.readium.r2.lcp.BuildConfig.DEBUG
import org.readium.r2.lcp.LcpError
import org.readium.r2.lcp.LcpException
import org.readium.r2.lcp.license.model.LicenseDocument
import org.readium.r2.shared.util.Url
import timber.log.Timber

/**
 * Access to a License Document stored in a ZIP archive.
 */
internal class FileZipLicenseContainer(
    private val zip: String,
    private val pathInZIP: Url,
) : WritableLicenseContainer {

    override fun read(): ByteArray {
        val file = File(zip)

        if (DEBUG) {
            Timber.d("FileZipLicenseContainer.read() - Attempting to read from: $zip")
            Timber.d("FileZipLicenseContainer.read() - File exists: ${file.exists()}, canRead: ${file.canRead()}, size: ${file.length()}")
        }

        if (!file.exists()) {
            if (DEBUG) Timber.e("FileZipLicenseContainer.read() - File does not exist: $zip")
            throw LcpException(LcpError.Container.FileNotFound(pathInZIP))
        }

        if (!file.canRead()) {
            if (DEBUG) Timber.e("FileZipLicenseContainer.read() - File cannot be read: $zip")
            throw LcpException(LcpError.Container.OpenFailed)
        }

        val archive = try {
            ZipFile(file)
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "FileZipLicenseContainer.read() - Failed to open ZIP file: $zip")
            throw LcpException(LcpError.Container.OpenFailed)
        }

        val entry = try {
            archive.getEntry(pathInZIP.toString())
                ?: throw Exception("Entry not found: $pathInZIP")
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "FileZipLicenseContainer.read() - Failed to get entry: $pathInZIP")
            archive.close()
            throw LcpException(LcpError.Container.FileNotFound(pathInZIP))
        }

        return try {
            archive.getInputStream(entry).readBytes()
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "FileZipLicenseContainer.read() - Failed to read entry: $pathInZIP")
            throw LcpException(LcpError.Container.ReadFailed(pathInZIP))
        } finally {
            archive.close()
        }

    }

    override fun write(license: LicenseDocument) {
        try {
            val source = File(zip)
            val tmpZip = File("$zip.tmp")
            val zipFile = ZipFile(source)
            try {
                zipFile.addOrReplaceEntry(
                    pathInZIP.toString(),
                    ByteArrayInputStream(license.toByteArray()),
                    tmpZip
                )
            } finally {
                zipFile.close()
            }
            tmpZip.moveTo(source)
        } catch (e: Exception) {
            throw LcpException(LcpError.Container.WriteFailed(pathInZIP))
        }
    }
}
