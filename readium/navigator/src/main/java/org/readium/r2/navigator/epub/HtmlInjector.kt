/*
 * Copyright 2022 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import org.readium.r2.navigator.epub.css.ReadiumCss
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.publication.epub.EpubLayout
import org.readium.r2.shared.publication.presentation.presentation
import org.readium.r2.shared.publication.services.isProtected
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.resource.Resource
import org.readium.r2.shared.util.resource.TransformingResource
import timber.log.Timber

/**
 * Injects the Readium CSS files and scripts in the HTML [Resource] receiver.
 *
 * @param baseHref Base URL where the Readium CSS and scripts are served.
 */
@OptIn(ExperimentalReadiumApi::class)
internal fun Resource.injectHtml(
    publication: Publication,
    mediaType: MediaType,
    css: ReadiumCss,
    baseHref: AbsoluteUrl,
    disableSelectionWhenProtected: Boolean,
): Resource =
    TransformingResource(this) { bytes ->
        if (!mediaType.isHtml) {
            return@TransformingResource Try.success(bytes)
        }

        var content = bytes.toString(mediaType.charset ?: Charsets.UTF_8).trim()
        val injectables = mutableListOf<String>()

        if (publication.metadata.presentation.layout == EpubLayout.FIXED) {
            injectables.add(
                script(baseHref.resolve(Url("readium/scripts/readium-fixed.js")!!))
            )
        } else {
            content = try {
                css.injectHtml(content)
            } catch (e: Exception) {
                return@TransformingResource Try.failure(ReadError.Decoding(e))
            }

            injectables.add(
                script(
                    baseHref.resolve(Url("readium/scripts/readium-reflowable.js")!!)
                )
            )
        }

        // Disable the text selection if the publication is protected.
        // FIXME: This is a hack until proper LCP copy is implemented, see https://github.com/readium/kotlin-toolkit/issues/221
        if (disableSelectionWhenProtected && publication.isProtected) {
            injectables.add(
                """
                <style>
                *:not(input):not(textarea) {
                    user-select: none;
                    -webkit-user-select: none;
                }
                </style>
            """
            )
        }

        val injectableContent = "\n" + injectables.joinToString("\n") + "\n"
        content = content.injectReadiumContent(injectableContent, sourceUrl)

        Try.success(content.toByteArray())
    }

private fun script(src: Url): String =
    """<script type="text/javascript" src="$src"></script>"""

internal fun String.injectReadiumContent(
    injectableContent: String,
    sourceUrl: AbsoluteUrl?,
): String {
    val headEndIndex = indexOf("</head>", 0, true)
    if (headEndIndex != -1) {
        return StringBuilder(length + injectableContent.length)
            .append(this, 0, headEndIndex)
            .append(injectableContent)
            .append(this, headEndIndex, length)
            .toString()
    }

    // Some EPUB resources (especially fixed-layout pages) can omit a closing </head>.
    // In that case, create a head block so Readium scripts are still injected.
    val headBlock = "<head>$injectableContent</head>"

    val htmlOpenIndex = indexOf("<html", 0, true)
    if (htmlOpenIndex != -1) {
        val htmlOpenEndIndex = indexOf(">", htmlOpenIndex)
        if (htmlOpenEndIndex != -1) {
            val insertionPoint = htmlOpenEndIndex + 1
            return StringBuilder(length + headBlock.length + 1)
                .append(this, 0, insertionPoint)
                .append('\n')
                .append(headBlock)
                .append(this, insertionPoint, length)
                .toString()
        }
    }

    val bodyOpenIndex = indexOf("<body", 0, true)
    if (bodyOpenIndex != -1) {
        return StringBuilder(length + headBlock.length + 1)
            .append(this, 0, bodyOpenIndex)
            .append(headBlock)
            .append('\n')
            .append(this, bodyOpenIndex, length)
            .toString()
    }

    Timber.e(
        "</head> closing tag not found in resource with href: $sourceUrl. Injecting scripts at document start."
    )
    return injectableContent + this
}
