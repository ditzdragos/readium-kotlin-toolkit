/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

private val urlRegex = Regex("""url\(\s*["']?([^"')]+?)["']?\s*\)""", RegexOption.IGNORE_CASE)
private val ruleRegex = Regex("""([^{}@;]+)\{([^{}]*)\}""")
private val idRegex = Regex("""\bid\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
private val classRegex = Regex("""\bclass\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
private val idSelectorRegex = Regex("""#([\w-]+)""")
private val classSelectorRegex = Regex("""\.([\w-]+)""")
private val commentRegex = Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL)

/** The `url(...)` references written in [html] itself, in inline styles or `<style>` blocks. */
internal fun inlineUrlRefs(html: String): List<String> =
    urlRegex.findAll(html).map { it.groupValues[1] }.filterNot { it.isDataUrl() }.distinct().toList()

/**
 * The `url(...)` references of the rules in [css] that can select an element of [html]: every id
 * and class the selector names is on the page. A stylesheet shared by a whole book often holds one
 * rule per page, such as `#page003 { background-image: url(page003.jpg) }`, and only the page's
 * own rule is worth fetching ahead.
 */
internal fun cssUrlRefsFor(css: String, html: String): List<String> {
    val ids = idRegex.findAll(html).map { it.groupValues[1] }.toSet()
    val classes = classRegex.findAll(html).flatMap { it.groupValues[1].split(Regex("\\s+")) }.toSet()
    fun selects(selector: String): Boolean =
        idSelectorRegex.findAll(selector).all { it.groupValues[1] in ids } &&
            classSelectorRegex.findAll(selector).all { it.groupValues[1] in classes }

    return ruleRegex.findAll(css.replace(commentRegex, ""))
        .filter { rule -> rule.groupValues[1].split(',').any { selects(it.trim()) } }
        .flatMap { rule -> urlRegex.findAll(rule.groupValues[2]).map { it.groupValues[1] } }
        .filterNot { it.isDataUrl() }
        .distinct()
        .toList()
}

private fun String.isDataUrl(): Boolean = startsWith("data:", ignoreCase = true)
