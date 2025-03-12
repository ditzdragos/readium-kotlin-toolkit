package org.readium.r2.shared.util.resource.content

import org.jsoup.Jsoup
import org.readium.r2.shared.extensions.cleanHtmlContent


/**
 * A lightweight HTML parser for text extraction without external dependencies.
 */
public object HtmlParser {
    public fun getFullText(html: String): String {
        val processedHtml = html.cleanHtmlContent().replace("</p>", "</p>\n")
        val text = Jsoup.parse(processedHtml).body().wholeText()
        return text
            .replace("\r", "")
    }
}
