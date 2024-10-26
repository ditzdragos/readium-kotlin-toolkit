package org.readium.navigator.web.layout

import org.readium.r2.shared.DelicateReadiumApi
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.presentation.Presentation
import org.readium.r2.shared.util.Url

@ExperimentalReadiumApi
internal data class ReadingOrder(
    val items: List<ReadingOrderItem>
) {

    @OptIn(DelicateReadiumApi::class)
    fun indexOfHref(href: Url): Int? = items
        .indexOfFirst { it.href == href }
        .takeUnless { it == -1 }
}

@ExperimentalReadiumApi
internal data class ReadingOrderItem(
    val href: Url,
    val page: Presentation.Page?
)