package org.readium.navigator.web.layout

import org.readium.navigator.common.ReadingOrder
import org.readium.r2.shared.publication.presentation.Presentation
import org.readium.r2.shared.util.Url

public data class ReadingOrder(
    override val items: List<ReadingOrderItem>
) : ReadingOrder

public data class ReadingOrderItem(
    override val href: Url,
    val page: Presentation.Page?
) : ReadingOrder.Item
