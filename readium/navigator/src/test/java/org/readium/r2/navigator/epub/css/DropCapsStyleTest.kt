package org.readium.r2.navigator.epub.css

import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test

class DropCapsStyleTest {

    private class Rule(val selectors: List<String>, val body: String)

    private val rules: List<Rule> = DROP_CAPS_STYLE
        .substringAfter("<style>")
        .substringBefore("</style>")
        .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        .split("}")
        .filter { it.contains("{") }
        .map { block ->
            Rule(
                selectors = block.substringBefore("{").split(",").map { it.trim() },
                body = block.substringAfter("{")
            )
        }

    private fun rulesFor(selector: String) = rules.filter { selector in it.selectors }

    private val spanSelectors = listOf(
        """span[class*="dropcap"]""",
        """span[class*="drop-cap"]""",
        "span.initial"
    )

    @Test
    fun `RR-9312 a floated span drop cap is not indented`() {
        for (selector in spanSelectors) {
            assertTrue(
                rulesFor(selector).none { it.body.contains("text-indent") },
                "$selector must not get a text-indent: it pushes a floated cap over the text"
            )
        }
    }

    @Test
    fun `RR-9312 a floated span drop cap keeps a positive height`() {
        for (selector in spanSelectors) {
            val bodies = rulesFor(selector).joinToString { it.body }
            assertTrue(
                bodies.contains("margin-top: 0 !important") &&
                    bodies.contains("margin-bottom: 0 !important"),
                "$selector must reset negative vertical margins so text wraps around the float"
            )
        }
    }

    @Test
    fun `RR-9312 a span drop cap keeps the book's look`() {
        for (selector in spanSelectors) {
            val bodies = rulesFor(selector).joinToString { it.body }
            assertEquals(
                emptyList(),
                listOf("font-size", "font-weight", "line-height", "float", "display")
                    .filter { bodies.contains("$it:") },
                "$selector must keep the book's own cap size and placement (RR-9229 enlarges an inline cap)"
            )
        }
    }

    @Test
    fun `RR-9345 a stick-up cap keeps a line tall enough to hold it at the top of a page`() {
        val bodies = rulesFor("""span[class*="stickup"]""").joinToString { it.body }

        assertTrue(
            bodies.contains("line-height: normal !important"),
            "a stick-up cap with line-height 0 rises above the page top and is cut off"
        )
    }
}
