/*
 * Copyright 2023 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.pager

import org.readium.r2.shared.InternalReadiumApi

/**
 * Collection of JavaScript functions to be injected into WebView.
 * Separating these scripts from the main fragment class reduces complexity.
 */
@OptIn(InternalReadiumApi::class)
internal object WebViewScripts {


    /**
     * Returns JavaScript to center fixed-layout content in the WebView.
     */
    fun getCenteringScript(): String = """
        javascript:(function() {
            console.log('Applying universal full-page scaling');
            
            // STEP 1: Fix background colors
            document.documentElement.style.backgroundColor = '#FFFFFF';
            document.body.style.backgroundColor = '#FFFFFF';
            
            // STEP 2: Prepare the document for scaling
            document.documentElement.style.margin = '0';
            document.documentElement.style.padding = '0';
            document.documentElement.style.overflow = 'hidden';
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.body.style.overflow = 'hidden';
            
            // STEP 3: Reset any existing transformations
            document.body.style.transform = '';
            document.body.style.transformOrigin = '';
            document.body.style.position = 'static';
            document.body.style.left = '';
            document.body.style.top = '';
            
            // STEP 4: Determine the content dimensions
            // Try multiple approaches to get the actual content size
            var contentWidth, contentHeight;
            
            // Method 1: Try viewport meta tag first (common in fixed-layout EPUBs)
            var metaViewport = document.querySelector('meta[name="viewport"]');
            if (metaViewport) {
                var content = metaViewport.getAttribute('content');
                var widthMatch = content.match(/width=([0-9]+)/);
                var heightMatch = content.match(/height=([0-9]+)/);
                
                if (widthMatch && heightMatch) {
                    contentWidth = parseInt(widthMatch[1]);
                    contentHeight = parseInt(heightMatch[1]);
                    console.log('Using viewport meta dimensions: ' + contentWidth + 'x' + contentHeight);
                }
            }
            
            // Method 2: Try to find content container
            if (!contentWidth || !contentHeight) {
                var containers = [
                    document.querySelector('.PageContainer, #Page, [class*="page"], [id*="page"]'),
                    document.querySelector('section, article, main'),
                    document.querySelector('div[style*="position: absolute"]')
                ];
                
                for (var i = 0; i < containers.length; i++) {
                    var container = containers[i];
                    if (container) {
                        var rect = container.getBoundingClientRect();
                        if (rect.width > 100 && rect.height > 100) {
                            contentWidth = rect.width;
                            contentHeight = rect.height;
                            console.log('Using container dimensions: ' + contentWidth + 'x' + contentHeight);
                            break;
                        }
                    }
                }
            }
            
            // Method 3: Measure the document itself as fallback
            if (!contentWidth || !contentHeight) {
                contentWidth = Math.max(
                    document.documentElement.scrollWidth,
                    document.body.scrollWidth,
                    document.documentElement.offsetWidth,
                    document.body.offsetWidth
                );
                contentHeight = Math.max(
                    document.documentElement.scrollHeight,
                    document.body.scrollHeight,
                    document.documentElement.offsetHeight,
                    document.body.offsetHeight
                );
                console.log('Using document dimensions: ' + contentWidth + 'x' + contentHeight);
            }
            
            // STEP 5: Get viewport dimensions and calculate scale
            var viewportWidth = window.innerWidth;
            var viewportHeight = window.innerHeight;
            console.log('Viewport: ' + viewportWidth + 'x' + viewportHeight);
            
            // Use more conservative scale to ensure margin
            var scaleX = viewportWidth / contentWidth;
            var scaleY = viewportHeight / contentHeight;
            var scale = Math.min(scaleX, scaleY);
            console.log('Using scale: ' + scale);
            
            // STEP 6: Create a new wrapper structure
            // This avoids manipulating the existing DOM structure
            
            // Create a wrapper that takes up the full viewport
            var wrapper = document.createElement('div');
            wrapper.id = 'r2-scale-wrapper';
            wrapper.style.position = 'fixed';
            wrapper.style.top = '0';
            wrapper.style.left = '0';
            wrapper.style.width = '100%';
            wrapper.style.height = '100%';
            wrapper.style.overflow = 'hidden';
            wrapper.style.backgroundColor = 'transparent';
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';     // Vertical centering
            wrapper.style.justifyContent = 'center'; // Horizontal centering
            
            // Create an inner container that will be scaled
            var scaleContainer = document.createElement('div');
            scaleContainer.id = 'r2-scale-container';
            scaleContainer.style.width = contentWidth + 'px';
            scaleContainer.style.height = contentHeight + 'px';
            scaleContainer.style.transformOrigin = 'center center';
            scaleContainer.style.transform = 'scale(' + scale + ')';
            scaleContainer.style.position = 'relative';
            
            // Save all body children
            var bodyContent = Array.from(document.body.children);
            
            // Insert the wrapper into the body
            document.body.appendChild(wrapper);
            
            // Add the scale container to the wrapper
            wrapper.appendChild(scaleContainer);
            
            // Move body content into the scale container
            bodyContent.forEach(function(node) {
                if (node !== wrapper) {
                    scaleContainer.appendChild(node);
                }
            });
            
            console.log('Universal scaling applied successfully');
        })();
    """.trimIndent()
} 