/*
 * Copyright 2022 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub.css

import android.net.Uri
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.readium.r2.navigator.preferences.FontFamily
import org.readium.r2.navigator.preferences.ReadingProgression
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.util.Url

@ExperimentalReadiumApi
internal data class ReadiumCss(
    val layout: Layout = Layout(
        language = null,
        Layout.Stylesheets.Default,
        ReadingProgression.LTR
    ),
    val rsProperties: RsProperties = RsProperties(),
    val userProperties: UserProperties = UserProperties(),
    val fontFamilyDeclarations: List<FontFamilyDeclaration> = emptyList(),
    val googleFonts: List<FontFamily> = emptyList(),
    val assetsBaseHref: Url,
) {

    /**
     * Injects Readium CSS in the given [html] resource.
     *
     * https://github.com/readium/readium-css/blob/develop/docs/CSS06-stylesheets_order.md
     */
    // FIXME: Replace existing attributes instead of adding new ones
    @Throws
    internal fun injectHtml(html: String): String {
//        if (true) return html
//        val document = Jsoup.parse(html)
        val content = StringBuilder(html)
        injectStyles(content)
        injectCssProperties(content)
        injectDir(content)
//        injectLang(content, document)
        return content.toString()
    }

    /**
     * Inject the Readium CSS stylesheets and font face declarations.
     */
    private fun injectStyles(content: StringBuilder) {
        val hasStyles = content.hasStyles()

        // Pre-build strings to avoid multiple allocations
        val headBeforeContent = buildString {
            append("\n")
            fontsInjectableLinks.forEach { append(it).append("\n") }
            append(stylesheetLink(beforeCss)).append("\n")
            append(
                """
                <style>
                    :root[style], :root { overflow: visible !important; }
                    :root[style] > body, :root > body { overflow: visible !important; }
                </style>
                """.trimMargin()
            ).append("\n")
            append(DROP_CAPS_STYLE).append("\n")
            if (!hasStyles) {
                append(stylesheetLink(defaultCss)).append("\n")
            }
        }

        val headBeforeIndex = content.indexForOpeningTag("head")
        content.insert(headBeforeIndex, headBeforeContent)

        // Pre-build end head content
        val endHeadContent = buildString {
            append("\n")
            append(stylesheetLink(afterCss)).append("\n")
            if (fontsInjectableCss.isNotEmpty()) {
                append(
                    """
                    <style type="text/css">
                    ${fontsInjectableCss.joinToString("\n")}
                    </style>
                    """.trimIndent()
                ).append("\n")
            }
        }

        val endHeadIndex = content.indexForClosingTag("head")
        content.insert(endHeadIndex, endHeadContent)
    }

    private val stylesheetsFolder by lazy {
        assetsBaseHref.resolve(
            Url("readium/readium-css/${layout.stylesheets.folder?.plus("/") ?: ""}")!!
        )
    }

    private val beforeCss by lazy {
        stylesheetsFolder.resolve(Url("ReadiumCSS-before.css")!!)
    }

    private val afterCss by lazy {
        stylesheetsFolder.resolve(Url("ReadiumCSS-after.css")!!)
    }

    private val defaultCss by lazy {
        stylesheetsFolder.resolve(Url("ReadiumCSS-default.css")!!)
    }

    /**
     * Generates the font face declarations from the declared font families.
     */
    private val fontsInjectableCss: List<String> by lazy {
        buildList {
            addAll(
                fontFamilyDeclarations
                    .flatMap { it.fontFaces }
                    .map { it.toCss(::normalizeAssetUrl) }
            )

            if (googleFonts.isNotEmpty()) {
                val families = googleFonts.joinToString("|") { it.name }

                val uri = Uri.parse("https://fonts.googleapis.com/css")
                    .buildUpon()
                    .appendQueryParameter("family", families)
                    .build()
                    .toString()

                // @import needs to be at the top of the <style> declaration.
                add(0, "@import url('$uri');")
            }
        }
    }

    private val fontsInjectableLinks: List<String> by lazy {
        fontFamilyDeclarations
            .flatMap { it.fontFaces }
            .flatMap { it.links(::normalizeAssetUrl) }
    }

    private fun normalizeAssetUrl(url: Url): Url =
        assetsBaseHref.resolve(url)

    /**
     * Returns whether the [String] receiver has any CSS styles.
     *
     * https://github.com/readium/readium-css/blob/develop/docs/CSS06-stylesheets_order.md#append-if-there-is-no-authors-styles
     */
    private fun CharSequence.hasStyles(): Boolean {
        return indexOf("<link ", 0, true) != -1 ||
            indexOf(" style=", 0, true) != -1 ||
            Regex(
                "<style.*?>",
                setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)
            ).containsMatchIn(
                this
            )
    }

    private fun stylesheetLink(href: Url): String =
        """<link rel="stylesheet" type="text/css" href="$href"/>"""

    /**
     * Inject the current Readium CSS properties inline in `html`.
     *
     * We inject them instead of using JavaScript to make sure they are taken into account during
     * the first layout pass.
     */
    private fun injectCssProperties(content: StringBuilder) {
        var css = rsProperties.toCss() + userProperties.toCss()
        if (css.isBlank()) {
            return
        }
        css = css.replace("\"", "&quot;")
        val index = content.indexForTagAttributes("html")
        content.insert(index, " style=\"$css\"")
    }

    /**
     * Inject the `dir` attribute in `html` and `body`.
     *
     * https://github.com/readium/readium-css/blob/develop/docs/CSS16-internationalization.md#direction
     */
    private fun injectDir(content: StringBuilder) {
        val dir = when (layout.stylesheets.htmlDir) {
            Layout.HtmlDir.Unspecified -> null
            Layout.HtmlDir.Ltr -> "ltr"
            Layout.HtmlDir.Rtl -> "rtl"
        } ?: return

        // Removes any dir attributes in html/body using a more memory-efficient approach
        // Convert to string once, do all replacements, then update StringBuilder
        // This is more efficient than the previous approach which did replace(0, length, replace(...))
        val contentString = content.toString()
        val cleanedContent = dirRegex.replace(contentString) { matchResult ->
            matchResult.groupValues[1] // Replace with just the tag, removing dir attribute
        }

        // Only update if content changed to avoid unnecessary operations
        if (cleanedContent != contentString) {
            content.setLength(0)
            content.append(cleanedContent)
        }

        val injectable = " dir=\"$dir\""
        content.insert(content.indexForTagAttributes("html"), injectable)
        content.insert(content.indexForTagAttributes("body"), injectable)
    }

    /**
     * Inject the `xml:lang` attribute in `html` and `body`.
     *
     * https://github.com/readium/readium-css/blob/develop/docs/CSS16-internationalization.md#language
     */
    private fun injectLang(content: StringBuilder, document: Document) {
        val language = layout.language?.code ?: return

        fun Element.hasLang(): Boolean =
            hasAttr("xml:lang") || hasAttr("lang")

        fun Element.lang(): String? =
            attr("xml:lang").takeIf { it.isNotEmpty() }
                ?: attr("lang").takeIf { it.isNotEmpty() }

        val html = document.selectFirst("html")
        if (html?.hasLang() == true) {
            return
        }

        val body = document.body()
        if (body.hasLang()) {
            content.insert(
                content.indexForTagAttributes("html"),
                " xml:lang=\"${body.lang() ?: language}\""
            )
        } else {
            val injectable = " xml:lang=\"$language\""
            content.insert(content.indexForTagAttributes("html"), injectable)
            content.insert(content.indexForTagAttributes("body"), injectable)
        }
    }

    private fun CharSequence.indexForOpeningTag(tag: String): Int =
        (
            Regex("""<$tag.*?>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
                .find(this, 0)
                ?: throw IllegalArgumentException("No <$tag> opening tag found in this resource")
            ).range.last + 1

    private fun CharSequence.indexForClosingTag(tag: String): Int =
        indexOf("</$tag>", 0, true)
            .takeIf { it != -1 }
            ?: throw IllegalArgumentException("No </head> closing tag found in this resource")

    private fun CharSequence.indexForTagAttributes(tag: String): Int =
        (
            indexOf("<$tag", 0, true)
                .takeIf { it != -1 }
                ?: throw IllegalArgumentException("No <$tag> opening tag found in this resource")
            ) + tag.length + 1
}

private val dirRegex = Regex(
    """(<(?:html|body)[^\>]*)\s+dir=[\"']\w*[\"']""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)
)
