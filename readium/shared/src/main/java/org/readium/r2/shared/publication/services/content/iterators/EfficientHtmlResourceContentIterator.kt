/*
 * Copyright 2024 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

@file:OptIn(InternalReadiumApi::class)

package org.readium.r2.shared.publication.services.content.iterators

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.readium.r2.shared.DelicateReadiumApi
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Manifest
import org.readium.r2.shared.publication.PublicationServicesHolder
import org.readium.r2.shared.publication.services.content.Content
import org.readium.r2.shared.publication.services.content.iterators.EfficientHtmlResourceContentIterator.LightweightHtmlParser.MediaElement
import org.readium.r2.shared.publication.services.positionsByReadingOrder
import org.readium.r2.shared.util.DebugError
import org.readium.r2.shared.util.Language
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.data.decodeString
import org.readium.r2.shared.util.flatMap
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.resource.Resource
import org.readium.r2.shared.util.toDebugDescription
import org.readium.r2.shared.util.use
import timber.log.Timber

/**
 * An efficient HTML resource content iterator that uses a lightweight HTML parser.
 * This implementation avoids using JSoup for better performance.
 */
@ExperimentalReadiumApi
@DelicateReadiumApi
public class EfficientHtmlResourceContentIterator internal constructor(
    private val resource: Resource,
    private val totalProgressionRange: ClosedRange<Double>?,
    private val locator: Locator,
    private val beforeMaxLength: Int = 50
) : Content.Iterator {

    public class Factory : ResourceContentIteratorFactory {
        override suspend fun create(
            manifest: Manifest,
            servicesHolder: PublicationServicesHolder,
            readingOrderIndex: Int,
            resource: Resource,
            mediaType: MediaType,
            locator: Locator
        ): Content.Iterator? {
            if (!mediaType.matchesAny(MediaType.HTML, MediaType.XHTML)) {
                return null
            }

            val positions = servicesHolder.positionsByReadingOrder()
            return EfficientHtmlResourceContentIterator(
                resource,
                totalProgressionRange = positions.getOrNull(readingOrderIndex)
                    ?.firstOrNull()?.locations?.totalProgression
                    ?.let { start ->
                        val end = positions.getOrNull(readingOrderIndex + 1)
                            ?.firstOrNull()?.locations?.totalProgression
                            ?: 1.0

                        start..end
                    },
                locator = locator
            )
        }
    }

    private data class ElementWithDelta(
        val element: Content.Element,
        val delta: Int
    )

    private var currentElement: ElementWithDelta? = null
    private var currentIndex: Int? = null

    override suspend fun hasPrevious(): Boolean {
        if (currentElement?.delta == -1) return true

        val elements = elements()
        val index = (currentIndex ?: elements.startIndex) - 1

        val content = elements.elements.getOrNull(index)
            ?: return false

        currentIndex = index
        currentElement = ElementWithDelta(content, -1)
        return true
    }

    override fun previous(): Content.Element =
        currentElement
            ?.takeIf { it.delta == -1 }?.element
            ?.also { currentElement = null }
            ?: throw IllegalStateException(
                "Called previous() without a successful call to hasPrevious() first"
            )

    override suspend fun hasNext(): Boolean {
        if (currentElement?.delta == +1) return true

        val elements = elements()
        val index = (currentIndex ?: (elements.startIndex - 1)) + 1

        val content = elements.elements.getOrNull(index)
            ?: return false

        currentIndex = index
        currentElement = ElementWithDelta(content, +1)
        return true
    }

    override fun next(): Content.Element =
        currentElement
            ?.takeIf { it.delta == +1 }?.element
            ?.also { currentElement = null }
            ?: throw IllegalStateException(
                "Called next() without a successful call to hasNext() first"
            )

    private suspend fun elements(): ParsedElements =
        parsedElements
            ?: parseElements().also { parsedElements = it }

    private var parsedElements: ParsedElements? = null

    private suspend fun parseElements(): ParsedElements =
        withContext(Dispatchers.Default) {
            val html = resource.use { res ->
                res.read()
                    .flatMap { it.decodeString() }
                    .getOrElse {
                        val error = DebugError("Failed to read HTML resource", it.cause)
                        Timber.w(error.toDebugDescription())
                        return@withContext ParsedElements()
                    }
            }

            val elements = mutableListOf<Content.Element>()
            var startIndex = 0

            // Parse HTML efficiently without using JSoup
            val parser = LightweightHtmlParser()
            val blocks = parser.parseBlocks(html)

            blocks.forEachIndexed { index, block ->
                if (block.text.isNotBlank()) {
                    val progression = index.toDouble() / blocks.size
                    val totalProgression = totalProgressionRange?.let {
                        totalProgressionRange.start + progression * (totalProgressionRange.endInclusive - totalProgressionRange.start)
                    }

                    // Create a text element for each block
                    elements.add(
                        Content.TextElement(
                            locator = locator.copy(
                                locations = Locator.Locations(
                                    progression = progression,
                                    totalProgression = totalProgression
                                ),
                                text = Locator.Text(
                                    before = if (index > 0) blocks[index - 1].text.takeLast(
                                        beforeMaxLength
                                    ) else null,
                                    highlight = block.text,
                                    after = blocks.getOrNull(index + 1)?.text?.take(beforeMaxLength)
                                )
                            ),
                            role = Content.TextElement.Role.Body,
                            segments = listOf(
                                Content.TextElement.Segment(
                                    locator = locator.copy(
                                        locations = Locator.Locations(
                                            progression = progression,
                                            totalProgression = totalProgression
                                        ),
                                        text = Locator.Text(
                                            before = if (index > 0) blocks[index - 1].text.takeLast(
                                                beforeMaxLength
                                            ) else null,
                                            highlight = block.text,
                                            after = blocks.getOrNull(index + 1)?.text?.take(
                                                beforeMaxLength
                                            )
                                        )
                                    ),
                                    text = block.text,
                                    attributes = buildList {
                                        block.language?.let {
                                            add(
                                                Content.Attribute(
                                                    Content.AttributeKey.LANGUAGE,
                                                    Language(it)
                                                )
                                            )
                                        }
                                    }
                                )
                            )
                        )
                    )

                    // Handle media elements if present
                    block.media?.let { media ->
                        when (media) {
                            is MediaElement.Image -> elements.add(
                                Content.ImageElement(
                                    locator = locator.copy(
                                        locations = Locator.Locations(
                                            progression = progression,
                                            totalProgression = totalProgression
                                        )
                                    ),
                                    embeddedLink = Link(href = media.src),
                                    caption = media.alt,
                                    attributes = emptyList()
                                )
                            )

                            is MediaElement.Audio -> elements.add(
                                Content.AudioElement(
                                    locator = locator.copy(
                                        locations = Locator.Locations(
                                            progression = progression,
                                            totalProgression = totalProgression
                                        )
                                    ),
                                    embeddedLink = Link(href = media.src),
                                    attributes = emptyList()
                                )
                            )

                            is MediaElement.Video -> elements.add(
                                Content.VideoElement(
                                    locator = locator.copy(
                                        locations = Locator.Locations(
                                            progression = progression,
                                            totalProgression = totalProgression
                                        )
                                    ),
                                    embeddedLink = Link(href = media.src),
                                    attributes = emptyList()
                                )
                            )
                        }
                    }
                }
            }

            // Handle starting position based on locator
            if (locator.locations.progression == 1.0) {
                startIndex = elements.size
            }

            ParsedElements(elements, startIndex)
        }

    internal data class ParsedElements(
        val elements: List<Content.Element> = emptyList(),
        val startIndex: Int = 0
    )

    private class LightweightHtmlParser {
        private val blockTags = setOf(
            "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6",
            "article", "section", "nav", "aside", "header", "footer"
        )
        private val ignoredTags = setOf("script", "style", "noscript", "head", "meta", "link")

        // Pre-compile regex patterns for better performance
        private val attributeRegex = Regex("""(\w+)\s*=\s*["']([^"']*)["']""")

        data class Block(
            val text: String,
            val language: String? = null,
            val media: MediaElement? = null
        )

        sealed class MediaElement {
            data class Image(val src: Url, val alt: String? = null) : MediaElement()
            data class Audio(val src: Url) : MediaElement()
            data class Video(val src: Url) : MediaElement()
        }

        // Cache for HTML entities to avoid repeated lookups
        private val entityMap = mapOf(
            "nbsp" to ' ',
            "lt" to '<',
            "gt" to '>',
            "amp" to '&',
            "quot" to '"',
            "apos" to '\''
        )

        fun parseBlocks(html: String): List<Block> {
            val blocks = mutableListOf<Block>()
            val currentBlock = StringBuilder(html.length / 10) // Pre-allocate with estimated size
            var currentLanguage: String? = null
            var pos = 0
            var inIgnoredTag = false
            var inTag = false

            // Use CharArray for faster character access
            val chars = html.toCharArray()
            val length = chars.size

            while (pos < length) {
                val char = chars[pos]
                if (inTag) {
                    // We're inside a tag, look for the closing '>'
                    if (char == '>') {
                        inTag = false
                    }
                    pos++
                    continue
                }

                when (char) {
                    '<' -> {
                        inTag = true
                        val tagStart = pos + 1
                        val isClosingTag = pos + 1 < length && chars[pos + 1] == '/'

                        // Find tag end using CharArray for better performance
                        var tagEnd = pos
                        while (tagEnd < length && chars[tagEnd] != '>') tagEnd++

                        if (tagEnd < length) {
                            // Extract tag content efficiently
                            val tagContent = html.substring(
                                tagStart + (if (isClosingTag) 1 else 0),
                                tagEnd
                            ).trim()

                            // Fast tag name extraction without regex
                            val spaceIndex = tagContent.indexOf(' ')
                            val tagName = if (spaceIndex == -1) {
                                tagContent.lowercase()
                            } else {
                                tagContent.substring(0, spaceIndex).lowercase()
                            }

                            when {
                                ignoredTags.contains(tagName) -> {
                                    inIgnoredTag = !isClosingTag
                                }

                                blockTags.contains(tagName) -> {
                                    if (!isClosingTag) {
                                        // Extract attributes only when needed
                                        if (tagName == "img" || tagName == "audio" || tagName == "video" || !currentLanguage.isNullOrEmpty()) {
                                            val attributes = extractAttributes(tagContent)
                                            currentLanguage =
                                                attributes["lang"] ?: attributes["xml:lang"]

                                            // Handle media elements
                                            when (tagName) {
                                                "img" -> handleImageElement(
                                                    attributes,
                                                    blocks,
                                                    currentBlock,
                                                    currentLanguage
                                                )

                                                "audio" -> handleAudioElement(
                                                    attributes,
                                                    blocks,
                                                    currentBlock,
                                                    currentLanguage
                                                )

                                                "video" -> handleVideoElement(
                                                    attributes,
                                                    blocks,
                                                    currentBlock,
                                                    currentLanguage
                                                )
                                            }
                                        }
                                    } else {
                                        // End of block
                                        if (currentBlock.isNotEmpty()) {
                                            blocks.add(
                                                Block(
                                                    currentBlock.toString().trim(),
                                                    currentLanguage
                                                )
                                            )
                                            currentBlock.clear()
                                        }
                                    }
                                }
                            }
                            pos = tagEnd
                        }
                        pos++
                    }

                    '&' -> {
                        if (!inIgnoredTag) {
                            var entityEnd = pos + 1
                            while (entityEnd < length && chars[entityEnd] != ';' && entityEnd - pos <= 10) entityEnd++

                            if (entityEnd < length && chars[entityEnd] == ';') {
                                val entity = html.substring(pos + 1, entityEnd)
                                val decodedChar = decodeEntity(entity)
                                currentBlock.append(decodedChar)
                                pos = entityEnd
                            } else {
                                currentBlock.append(char)
                            }
                        }
                        pos++
                    }

                    else -> {
                        if (!inIgnoredTag) {
                            currentBlock.append(char)
                        }
                        pos++
                    }
                }
            }

            // Add any remaining text
            if (currentBlock.isNotEmpty()) {
                blocks.add(Block(currentBlock.toString().trim(), currentLanguage))
            }

            return blocks
        }

        private fun decodeEntity(entity: String): Char = when {
            entityMap.containsKey(entity) -> entityMap[entity]!!
            entity.startsWith("#x") -> entity.substring(2).toIntOrNull(16)?.toChar() ?: '?'
            entity.startsWith("#") -> entity.substring(1).toIntOrNull()?.toChar() ?: '?'
            else -> '?'
        }

        private fun extractAttributes(tagContent: String): Map<String, String> {
            val attributes = mutableMapOf<String, String>()
            attributeRegex.findAll(tagContent).forEach { matchResult ->
                val (name, value) = matchResult.destructured
                attributes[name] = value
            }
            return attributes
        }

        private fun handleImageElement(
            attributes: Map<String, String>,
            blocks: MutableList<Block>,
            currentBlock: StringBuilder,
            currentLanguage: String?
        ) {
            attributes["src"]?.let { src ->
                if (currentBlock.isNotEmpty()) {
                    blocks.add(Block(currentBlock.toString().trim(), currentLanguage))
                    currentBlock.clear()
                }
                blocks.add(
                    Block(
                        "",
                        currentLanguage,
                        Url(src)?.let { MediaElement.Image(it, attributes["alt"]) }
                    )
                )
            }
        }

        private fun handleAudioElement(
            attributes: Map<String, String>,
            blocks: MutableList<Block>,
            currentBlock: StringBuilder,
            currentLanguage: String?
        ) {
            attributes["src"]?.let { src ->
                if (currentBlock.isNotEmpty()) {
                    blocks.add(Block(currentBlock.toString().trim(), currentLanguage))
                    currentBlock.clear()
                }
                blocks.add(
                    Block(
                        "",
                        currentLanguage,
                        Url(src)?.let { MediaElement.Audio(it) }
                    )
                )
            }
        }

        private fun handleVideoElement(
            attributes: Map<String, String>,
            blocks: MutableList<Block>,
            currentBlock: StringBuilder,
            currentLanguage: String?
        ) {
            attributes["src"]?.let { src ->
                if (currentBlock.isNotEmpty()) {
                    blocks.add(Block(currentBlock.toString().trim(), currentLanguage))
                    currentBlock.clear()
                }
                blocks.add(
                    Block(
                        "",
                        currentLanguage,
                        Url(src)?.let { MediaElement.Video(it) }
                    )
                )
            }
        }
    }
} 