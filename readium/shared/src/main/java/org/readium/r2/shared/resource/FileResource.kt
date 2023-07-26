/*
 * Copyright 2023 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.shared.resource

import android.content.ContentResolver
import java.io.File
import java.io.FileNotFoundException
import java.io.RandomAccessFile
import java.nio.channels.Channels
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.readium.r2.shared.error.Try
import org.readium.r2.shared.error.getOrThrow
import org.readium.r2.shared.extensions.*
import org.readium.r2.shared.extensions.read
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.isLazyInitialized

/**
 * A [Resource] to access a [file].
 */
public class FileResource(override val file: File) : Resource {

    private val randomAccessFile by lazy {
        ResourceTry.catching {
            RandomAccessFile(file, "r")
        }
    }

    override suspend fun name(): ResourceTry<String?> =
        ResourceTry.success(file.name)

    override suspend fun close() {
        withContext(Dispatchers.IO) {
            if (::randomAccessFile.isLazyInitialized) {
                randomAccessFile.onSuccess {
                    tryOrLog { it.close() }
                }
            }
        }
    }

    override suspend fun read(range: LongRange?): ResourceTry<ByteArray> =
        withContext(Dispatchers.IO) {
            ResourceTry.catching {
                readSync(range)
            }
        }

    private fun readSync(range: LongRange?): ByteArray {
        if (range == null) {
            return file.readBytes()
        }

        @Suppress("NAME_SHADOWING")
        val range = range
            .coerceFirstNonNegative()
            .requireLengthFitInt()

        if (range.isEmpty()) {
            return ByteArray(0)
        }

        return randomAccessFile.getOrThrow().run {
            channel.position(range.first)

            // The stream must not be closed here because it would close the underlying
            // [FileChannel] too. Instead, [close] is responsible for that.
            Channels.newInputStream(channel).run {
                val length = range.last - range.first + 1
                read(length)
            }
        }
    }

    override suspend fun length(): ResourceTry<Long> =
        metadataLength?.let { Try.success(it) }
            ?: read().map { it.size.toLong() }

    private val metadataLength: Long? =
        tryOrNull {
            if (file.isFile)
                file.length()
            else
                null
        }

    private inline fun <T> Try.Companion.catching(closure: () -> T): ResourceTry<T> =
        try {
            success(closure())
        } catch (e: FileNotFoundException) {
            failure(Resource.Exception.NotFound(e))
        } catch (e: SecurityException) {
            failure(Resource.Exception.Forbidden(e))
        } catch (e: Exception) {
            failure(Resource.Exception.wrap(e))
        } catch (e: OutOfMemoryError) { // We don't want to catch any Error, only OOM.
            failure(Resource.Exception.wrap(e))
        }

    override fun toString(): String =
        "${javaClass.simpleName}(${file.path})"
}

public class FileResourceFactory : ResourceFactory {

    override suspend fun create(url: Url): Try<Resource, ResourceFactory.Error> {
        if (url.scheme != ContentResolver.SCHEME_FILE) {
            return Try.failure(ResourceFactory.Error.SchemeNotSupported(url.scheme))
        }

        val file = File(url.path)

        try {
            if (!file.isFile) {
                return Try.failure(ResourceFactory.Error.NotAResource(url))
            }
        } catch (e: Exception) {
            return Try.failure(ResourceFactory.Error.Forbidden(e))
        }

        return Try.success(FileResource(file))
    }
}