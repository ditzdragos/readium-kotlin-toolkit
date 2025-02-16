package org.readium.r2.shared.util.resource.content

import org.jsoup.Jsoup
import org.jsoup.parser.Parser
import org.readium.r2.shared.extensions.cleanHtmlContent


/**
 * A lightweight HTML parser for text extraction without external dependencies.
 */
public object HtmlParser {
    private val BLOCK_TAGS = setOf(
        "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6",
        "article", "section", "nav", "aside", "header", "footer"
    )

    private val IGNORED_TAGS = setOf("script", "style", "noscript", "head", "meta", "link")

    public fun getFullText(html: String): String {
        val text = Jsoup.parse(html.cleanHtmlContent()).body().wholeText()
        return Parser.unescapeEntities(text, false)
    }

    /**
     * Extracts all text from the <body> of the given HTML.
     *
     * @param html the HTML to parse.
     * @param includeNewLines if true, block elements will cause newline characters to be inserted.
     *                        If false, the text is concatenated into one single line.
     * @param preserveWhitespace if true, preserves original whitespace. If false, collapses whitespace.
     * @return the extracted text.
     */
    public fun extractBodyText(
        html: String,
        includeNewLines: Boolean = false,
        preserveWhitespace: Boolean = false
    ): String {
        val parser = TextExtractor(includeNewLines, preserveWhitespace)
        return parser.parse(html)
    }

    private class TextExtractor(
        private val includeNewLines: Boolean,
        private val preserveWhitespace: Boolean
    ) {
        private val output = StringBuilder()
        private var lastCharIsWhitespace = false
        private var inIgnoredTag = false
        private var currentTag = ""
        private var pos = 0
        private var html = ""

        fun parse(input: String): String {
            html = input.trim()
            pos = 0
            output.clear()
            lastCharIsWhitespace = false
            inIgnoredTag = false
            currentTag = ""

            while (pos < html.length) {
                when (val char = html[pos]) {
                    '<' -> processTag()
                    '&' -> processEntity()
                    else -> if (!inIgnoredTag) processChar(char)
                }
                pos++
            }

            return output.toString().trim()
        }

        private fun processTag() {
            val tagStart = pos
            var endPos = pos + 1
            var isClosingTag = false

            // Check if it's a closing tag
            if (endPos < html.length && html[endPos] == '/') {
                isClosingTag = true
                endPos++
            }

            // Find the end of the tag
            while (endPos < html.length && html[endPos] != '>') {
                endPos++
            }

            if (endPos >= html.length) return

            // Extract tag name
            val tagContent = html.substring(tagStart + 1 + (if (isClosingTag) 1 else 0), endPos)
            val tagName = tagContent.trim().split(Regex("\\s+"))[0].lowercase()

            when {
                IGNORED_TAGS.contains(tagName) -> {
                    inIgnoredTag = !isClosingTag
                }

                includeNewLines && BLOCK_TAGS.contains(tagName) -> {
                    if (!isClosingTag && output.isNotEmpty()) {
                        appendNewLine()
                    }
                }
            }

            currentTag = tagName
            pos = endPos
        }

        private fun processEntity() {
            val entityEnd = html.indexOf(';', pos)
            if (entityEnd == -1 || entityEnd - pos > 10) {
                processChar('&')
                return
            }

            val char = when (val entity = html.substring(pos + 1, entityEnd)) {
                "nbsp" -> ' '
                "lt" -> '<'
                "gt" -> '>'
                "amp" -> '&'
                "quot" -> '"'
                "apos" -> '\''
                else -> when {
                    entity.startsWith("#x") -> entity.substring(2).toIntOrNull(16)?.toChar() ?: '?'
                    entity.startsWith("#") -> entity.substring(1).toIntOrNull()?.toChar() ?: '?'
                    else -> '?'
                }
            }

            processChar(char)
            pos = entityEnd
        }

        private fun processChar(char: Char) {
            if (!inIgnoredTag) {
                if (preserveWhitespace) {
                    output.append(char)
                } else {
                    when {
                        char.isWhitespace() -> {
                            if (!lastCharIsWhitespace) {
                                output.append(' ')
                                lastCharIsWhitespace = true
                            }
                        }

                        else -> {
                            output.append(char)
                            lastCharIsWhitespace = false
                        }
                    }
                }
            }
        }

        private fun appendNewLine() {
            if (output.isNotEmpty() && output.last() != '\n') {
                output.append('\n')
                lastCharIsWhitespace = true
            }
        }
    }
}