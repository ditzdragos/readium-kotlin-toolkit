/*
 * Copyright 2025 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

/** The page box a fixed-layout resource declares for itself, in CSS pixels. */
internal data class FixedLayoutViewport(
    val width: Double,
    val height: Double,
)

/**
 * Reads the page box declared by `<meta name="viewport">`, falling back to the wrapping `<svg>`
 * for image-only pages that only state it there. Null when neither gives two usable lengths.
 */
internal object FixedLayoutViewportParser {

    fun parse(html: String): FixedLayoutViewport? =
        fromMetaViewport(html) ?: fromSvg(html)

    private fun fromMetaViewport(html: String): FixedLayoutViewport? {
        for (tag in metaTagRegex.findAll(html)) {
            val meta = tag.value
            if (!nameIsViewportRegex.containsMatchIn(meta)) continue
            val content = attribute(meta, "content") ?: continue
            val width = viewportLength(content, "width") ?: continue
            val height = viewportLength(content, "height") ?: continue
            return FixedLayoutViewport(width, height)
        }
        return null
    }

    private fun fromSvg(html: String): FixedLayoutViewport? {
        val svg = svgTagRegex.find(html)?.value ?: return null

        attribute(svg, "viewBox")?.trim()?.split(viewBoxSeparatorRegex)?.let { box ->
            val width = box.getOrNull(2)?.let(::length)
            val height = box.getOrNull(3)?.let(::length)
            if (width != null && height != null) {
                return FixedLayoutViewport(width, height)
            }
        }

        // A percentage size describes the containing block, not a page box.
        val width = attribute(svg, "width")?.takeIf { !it.contains('%') }?.let(::length)
        val height = attribute(svg, "height")?.takeIf { !it.contains('%') }?.let(::length)
        return if (width != null && height != null) FixedLayoutViewport(width, height) else null
    }

    /** Matches `width=1200`, but not the `width=` inside `device-width` or `min-width`. */
    private fun viewportLength(content: String, name: String): Double? =
        Regex("""(?:^|[;,\s])$name\s*=\s*($NUMBER)""", RegexOption.IGNORE_CASE)
            .find(content)
            ?.groupValues?.get(1)
            ?.let(::length)

    /** Leading number of a CSS length, so `1200px` and `1200` both read as 1200. */
    private fun length(value: String): Double? =
        leadingNumberRegex.find(value)
            ?.value
            ?.trim()
            ?.toDoubleOrNull()
            ?.takeIf { it.isFinite() && it > 0 }

    private fun attribute(tag: String, name: String): String? =
        attributeRegexes.getValue(name).find(tag)?.groupValues?.get(1)

    private const val NUMBER = """[0-9]*\.?[0-9]+"""

    private val metaTagRegex = Regex("""<meta\b[^>]*>""", RegexOption.IGNORE_CASE)
    private val svgTagRegex = Regex("""<svg\b[^>]*>""", RegexOption.IGNORE_CASE)
    private val nameIsViewportRegex =
        Regex("""\bname\s*=\s*["']?\s*viewport\b""", RegexOption.IGNORE_CASE)
    private val leadingNumberRegex = Regex("""^\s*$NUMBER""")
    private val viewBoxSeparatorRegex = Regex("""[\s,]+""")

    // The lookbehind keeps `width` from matching inside `stroke-width` or `xlink:width`.
    private val attributeRegexes: Map<String, Regex> =
        listOf("content", "viewBox", "width", "height").associateWith { name ->
            Regex("""(?<![-\w:])$name\s*=\s*["']([^"']*)["']""", RegexOption.IGNORE_CASE)
        }
}
