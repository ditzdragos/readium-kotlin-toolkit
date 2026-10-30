/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

private val urlRegex = Regex("""url\(\s*["']?([^"')]+?)["']?\s*\)""", RegexOption.IGNORE_CASE)
private val commentRegex = Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL)
private val idRegex = Regex("""\bid\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
private val classRegex = Regex("""\bclass\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
private val whitespace = Regex("\\s+")

/** The `url(...)` references written in [html] itself, in inline styles or `<style>` blocks. */
internal fun inlineUrlRefs(html: String): List<String> =
    urlRegex.findAll(html).map { it.groupValues[1] }.filterNot { it.isDataUrl() }.distinct().toList()

/** The ids and classes used in a page's HTML. */
internal class PageNames(html: String) {
    val ids: Set<String> = idRegex.findAll(html).map { it.groupValues[1] }.toSet()
    val classes: Set<String> =
        classRegex.findAll(html).flatMap { it.groupValues[1].split(whitespace) }.toSet()
}

/**
 * The rules of a stylesheet that reference images, parsed once so that finding a page's images is
 * a few set lookups. A stylesheet shared by a whole book often holds one rule per page, such as
 * `#page003 { background-image: url(page003.jpg) }`, and only the page's own rule is worth
 * fetching ahead.
 */
internal class StylesheetImageRules(css: String) {

    /** The ids and classes a selector names, which must all be on the page for it to match. */
    private class Selector(val ids: List<String>, val classes: List<String>)

    private class Rule(val selectors: List<Selector>, val urls: List<String>)

    private val rules: List<Rule> = parseRules(css.replace(commentRegex, ""))

    /** The `url(...)` references of the rules that can select an element of [page]. */
    fun urlRefsFor(page: PageNames): List<String> =
        rules
            .filter { rule -> rule.selectors.any { it.matches(page) } }
            .flatMap { it.urls }
            .distinct()

    private fun Selector.matches(page: PageNames): Boolean =
        page.ids.containsAll(ids) && page.classes.containsAll(classes)

    /**
     * Splits [css] into its innermost `selectors { declarations }` blocks with a single scan, so
     * a group such as `@media` contributes the rules inside it.
     */
    private fun parseRules(css: String): List<Rule> {
        val rules = mutableListOf<Rule>()
        var start = 0
        while (true) {
            val open = css.indexOf('{', start)
            val close = css.indexOf('}', open + 1)
            if (open < 0 || close < 0) break
            val nestedOpen = css.indexOf('{', open + 1)
            if (nestedOpen in 0 until close) {
                start = open + 1
                continue
            }
            val body = css.substring(open + 1, close)
            if (body.contains("url(", ignoreCase = true)) {
                val urls = urlRegex.findAll(body).map { it.groupValues[1] }.filterNot { it.isDataUrl() }.toList()
                val selectors = css.substring(start, open).substringAfterLast(';').split(',')
                if (urls.isNotEmpty()) rules.add(Rule(selectors.map(::parseSelector), urls))
            }
            start = close + 1
        }
        return rules
    }

    private fun parseSelector(selector: String): Selector {
        val ids = mutableListOf<String>()
        val classes = mutableListOf<String>()
        var i = 0
        while (i < selector.length) {
            val prefix = selector[i++]
            if (prefix != '#' && prefix != '.') continue
            val start = i
            while (i < selector.length && selector[i].isNameChar()) i++
            if (i > start) (if (prefix == '#') ids else classes).add(selector.substring(start, i))
        }
        return Selector(ids, classes)
    }

    private fun Char.isNameChar(): Boolean = isLetterOrDigit() || this == '-' || this == '_'
}

/** The `url(...)` references of the rules in [css] that can select an element of [html]. */
internal fun cssUrlRefsFor(css: String, html: String): List<String> =
    StylesheetImageRules(css).urlRefsFor(PageNames(html))

private fun String.isDataUrl(): Boolean = startsWith("data:", ignoreCase = true)
