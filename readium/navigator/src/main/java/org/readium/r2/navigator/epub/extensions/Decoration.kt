/*
 * Copyright 2021 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub.extensions

import org.json.JSONObject
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.DecorationChange
import org.readium.r2.navigator.html.HtmlDecorationTemplates
import org.readium.r2.shared.publication.epub.EpubLayout
import timber.log.Timber

// Decoration extensions related to HTML/EPUB.

/**
 * The change that adds the receiver to a web view laid out as [layout].
 *
 * Enhanced decorations are positioned in viewport coordinates and dropped while off screen, which
 * only holds for a fixed layout where one resource is one page. A reflowable resource pages by
 * scrolling, so its decorations must be placed in document coordinates and survive the scroll.
 */
internal fun Decoration.addedChangeFor(layout: EpubLayout): DecorationChange =
    if (layout == EpubLayout.REFLOWABLE) {
        DecorationChange.Added(this)
    } else {
        DecorationChange.AddedEnhanced(this)
    }

/**
 * Generates the JavaScript used to apply the receiver list of [DecorationChange] in a web view.
 */
internal fun List<DecorationChange>.javascriptForGroup(
    group: String,
    templates: HtmlDecorationTemplates,
    enhanced: Boolean = false
): String? {
    if (isEmpty()) return null

    return """
        // Using requestAnimationFrame helps to make sure the page is fully laid out before adding the
        // decorations.
        requestAnimationFrame(function () {
            let group = readium.getDecorations('$group');
            ${mapNotNull { it.javascript(templates, enhanced) }.joinToString("\n")}
        });
        """
}

/**
 * Generates the JavaScript used to apply the receiver [DecorationChange] in a web view.
 */
public fun DecorationChange.javascript(
    templates: HtmlDecorationTemplates,
    enhanced: Boolean = false
): String? {
    fun toJSON(decoration: Decoration): JSONObject? {
        val template = templates[decoration.style::class] ?: run {
            Timber.e("Decoration style not registered: ${decoration.style::class}")
            return null
        }
        return decoration.toJSON().apply {
            put("element", template.element(decoration))
        }
    }

    if (this is DecorationChange.Added && enhanced) {
        return toJSON(decoration)?.let { "group.addEnhanced($it);" }
    }

    return when (this) {
        is DecorationChange.Added ->
            toJSON(decoration)?.let {
                if (enhanced) {
                    "group.addEnhanced($it);"
                } else {
                    "group.add($it);"
                }
            }

        is DecorationChange.AddedEnhanced ->
            toJSON(decoration)?.let { "group.addEnhanced($it);" }

        is DecorationChange.Moved ->
            "group.requestLayout();"

        is DecorationChange.Removed ->
            "group.clearEnhanced('$id');"

        is DecorationChange.Updated ->
            toJSON(decoration)?.let { "group.update($it,$enhanced);" }
    }
}
