/*
 * Copyright 2023 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.pager

/**
 * Collection of JavaScript functions to be injected into WebView.
 * Separating these scripts from the main fragment class reduces complexity.
 */
internal object WebViewScripts {

    /**
     * Returns JavaScript to center fixed-layout content in the WebView.
     * @param viewportWidth The actual width of the WebView from Android
     * @param viewportHeight The actual height of the WebView from Android
     */
    fun getCenteringScript(viewportWidth: Int, viewportHeight: Int): String = """
        javascript:(function() {
            // Prevent multiple executions in quick succession
            if (window.r2ScalingInProgress) {
                console.log('Scaling already in progress, skipping');
                return;
            }
            
            // Skip if already scaled with stable dimensions
            if (window.r2ScalingApplied) {
                console.log('Scaling already applied with stable dimensions');
                return;
            }
            
            window.r2ScalingInProgress = true;
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
            
            // STEP 4: Get content dimensions from meta viewport only
            var contentWidth, contentHeight;
            var dimensionMethod = ''; // For debugging
            
            // Only use the meta viewport tag for content dimensions - nothing else
            var metaViewport = document.querySelector('meta[name="viewport"]');
            if (metaViewport) {
                var content = metaViewport.getAttribute('content');
                var widthMatch = content.match(/width=([0-9]+)/);
                var heightMatch = content.match(/height=([0-9]+)/);
                
                if (widthMatch && heightMatch) {
                    contentWidth = parseInt(widthMatch[1]);
                    contentHeight = parseInt(heightMatch[1]);
                    dimensionMethod = 'viewport meta tag';
                    console.log('Using viewport meta dimensions: ' + contentWidth + 'x' + contentHeight);
                }
            }
            
            // Fallback to standard dimensions if no meta viewport tag found
            if (!contentWidth || !contentHeight) {
                console.log('No meta viewport dimensions found, using fallback');
                contentWidth = 1024;  // Standard fallback width
                contentHeight = 768;  // Standard fallback height
                dimensionMethod = 'fallback values (no meta viewport)';
            }
            
            // Record dimensions used
            console.log('Final dimension detection method: ' + dimensionMethod);
            
            // Use the viewport dimensions passed from Android
            var viewportWidth = $viewportWidth;
            var viewportHeight = $viewportHeight;
            console.log('Using exact viewport from Android: ' + viewportWidth + 'x' + viewportHeight);
            
            // Calculate aspect ratios
            var contentRatio = contentHeight / contentWidth;
            var viewportRatio = viewportHeight / viewportWidth;
            
            // Simple ratio comparison for scaling
            var scale = 1.0;
            
            if (viewportRatio < contentRatio) {
                // Viewport is wider relative to height than content
                // Scale down to match the viewport's aspect ratio
                scale = (viewportRatio / contentRatio) * 0.99;
                console.log('Viewport ratio (' + viewportRatio.toFixed(2) + ') is smaller than content ratio (' + 
                            contentRatio.toFixed(2) + '), scaling to: ' + scale.toFixed(3));
            } else {
                // Viewport is taller relative to width than content
                // No scaling needed
                console.log('Viewport ratio (' + viewportRatio.toFixed(2) + ') is larger than content ratio (' + 
                            contentRatio.toFixed(2) + '), no scaling needed');
                scale = 1.0;
            }
            
            // For content that barely fits (scale is close to 1.0), apply a small safety margin
            if (scale >= 0.95 && scale < 1.0) {
                console.log('Content barely fits, applying slight safety margin');
                scale *= 0.99; // Small 1% reduction for safety
            }
            
            console.log('Using scale: ' + scale);
            
            // STEP 6: Apply the scaling with a wrapper
            // Remove any existing wrapper from previous attempts
            var existingWrapper = document.getElementById('r2-scale-wrapper');
            if (existingWrapper) {
                // Move children back to body
                var scaleContainer = document.getElementById('r2-scale-container');
                if (scaleContainer) {
                    while (scaleContainer.firstChild) {
                        document.body.appendChild(scaleContainer.firstChild);
                    }
                }
                document.body.removeChild(existingWrapper);
            }
            
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
            wrapper.style.boxSizing = 'border-box';
            wrapper.style.padding = '0';
            wrapper.style.margin = '0';
            
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
            
            // Mark scaling as completed
            window.r2ScalingApplied = true;
            window.r2ScalingInProgress = false;
            
            // Store dimension information for debugging
            window.r2ContentDimensions = {
                width: contentWidth,
                height: contentHeight,
                method: dimensionMethod
            };
            
            console.log('Universal scaling applied successfully with dimensions ' + contentWidth + 'x' + contentHeight + ' (' + dimensionMethod + ')');
            
            // Store the viewport dimensions from Android for reference
            window.r2AndroidViewportWidth = viewportWidth;
            window.r2AndroidViewportHeight = viewportHeight;
        })();
    """.trimIndent()

    /**
     * Returns JavaScript to update scaling when viewport dimensions change.
     * Call this when the WebView size changes (e.g., orientation change).
     * @param viewportWidth The new width of the WebView
     * @param viewportHeight The new height of the WebView
     */
    fun getUpdateViewportScript(viewportWidth: Int, viewportHeight: Int): String = """
        javascript:(function() {
            console.log('Updating viewport dimensions: ' + $viewportWidth + 'x' + $viewportHeight);
            
            // Compare with previous dimensions
            var previousWidth = window.r2AndroidViewportWidth || 0;
            var previousHeight = window.r2AndroidViewportHeight || 0;
            
            // Skip if dimensions are the same or very close
            if (Math.abs(previousWidth - $viewportWidth) < 5 && Math.abs(previousHeight - $viewportHeight) < 5) {
                console.log('Viewport dimensions unchanged, skipping update');
                return;
            }
            
            // Find content dimensions (from existing scale container)
            var scaleContainer = document.getElementById('r2-scale-container');
            if (!scaleContainer) {
                console.log('Scale container not found, cannot update scaling');
                return;
            }
            
            var contentWidth = parseInt(scaleContainer.style.width);
            var contentHeight = parseInt(scaleContainer.style.height);
            
            // If we have stored dimension info, use it for logging
            var dimensionMethod = window.r2ContentDimensions ? window.r2ContentDimensions.method : 'unknown';
            console.log('Content dimensions: ' + contentWidth + 'x' + contentHeight + ' (' + dimensionMethod + ')');
            
            // Calculate new scale
            var viewportWidth = $viewportWidth;
            var viewportHeight = $viewportHeight;
            var scaleX = viewportWidth / contentWidth;
            var scaleY = viewportHeight / contentHeight;
            
            // Apply a small safety margin
            var marginFactor = 0.99; // Default to 1% margin
            
            var scale = Math.min(scaleX, scaleY) * marginFactor;
            
            // IMPORTANT: Only scale down, never scale up
            // If content is smaller than viewport, set scale to 1.0 (no scaling)
            // BUT - we need to account for aspect ratio differences
            
            // Calculate aspect ratios
            var contentRatio = contentHeight / contentWidth;
            var viewportRatio = viewportHeight / viewportWidth;
            
            if (viewportRatio < contentRatio) {
                // Viewport is wider relative to height than content
                // Scale down to match the viewport's aspect ratio
                scale = (viewportRatio / contentRatio) * 0.99;
                console.log('Viewport ratio (' + viewportRatio.toFixed(2) + ') is smaller than content ratio (' + 
                            contentRatio.toFixed(2) + '), scaling to: ' + scale.toFixed(3));
            } else {
                // Viewport is taller relative to width than content
                // No scaling needed
                console.log('Viewport ratio (' + viewportRatio.toFixed(2) + ') is larger than content ratio (' + 
                            contentRatio.toFixed(2) + '), no scaling needed');
                scale = 1.0;
            }
            
            // For content that barely fits (scale is close to 1.0), apply a small safety margin
            if (scale >= 0.95 && scale < 1.0) {
                console.log('Content barely fits, applying slight safety margin');
                scale *= 0.99; // Small 1% reduction for safety
            }
            
            console.log('Updating scale to: ' + scale);
            scaleContainer.style.transform = 'scale(' + scale + ')';
            
            // Update stored dimensions
            window.r2AndroidViewportWidth = viewportWidth;
            window.r2AndroidViewportHeight = viewportHeight;
        })();
    """.trimIndent()
} 