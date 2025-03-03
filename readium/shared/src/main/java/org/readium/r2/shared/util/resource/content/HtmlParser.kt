package org.readium.r2.shared.util.resource.content

import org.jsoup.Jsoup
import org.jsoup.parser.Parser
import org.readium.r2.shared.extensions.cleanHtmlContent


/**
 * A lightweight HTML parser for text extraction without external dependencies.
 */
public object HtmlParser {
    public fun getFullText(html: String): String {
        val text = Jsoup.parse(html.cleanHtmlContent()).body().wholeText()
        return Parser.unescapeEntities(text, false)
            .replace("\r", "")
    }
}