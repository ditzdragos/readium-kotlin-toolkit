/*
 * Copyright 2024 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.navigator.web.internals.util

import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Url
import timber.log.Timber

// FIXME: This is a hack until proper LCP copy is implemented, see https://github.com/readium/kotlin-toolkit/issues/221
public const val disableSelectionInjectable: String =
    """
        <style>
        *:not(input):not(textarea) {
            user-select: none;
            -webkit-user-select: none;
        }
        </style>
    """

public fun script(src: Url): String =
    """<script type="text/javascript" src="$src"></script>"""

public fun String.inject(
    sourceUrl: AbsoluteUrl?,
    injectables: List<String>,
): String {
    val injectableContent = "\n" + injectables.joinToString("\n") + "\n"
    val headEndIndex = this.indexOf("</head>", 0, true)
    if (headEndIndex != -1) {
        StringBuilder(this)
            .insert(headEndIndex, injectableContent)
            .toString()
    } else {
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
        injectableContent + this
    }
}
