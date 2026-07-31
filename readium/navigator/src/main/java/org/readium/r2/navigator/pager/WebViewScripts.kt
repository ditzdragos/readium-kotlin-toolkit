/*
 * Copyright 2023 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.pager

import java.util.Locale

/**
 * Collection of JavaScript functions to be injected into WebView.
 * Separating these scripts from the main fragment class reduces complexity.
 */
internal object WebViewScripts {

    /**
     * Cancels HTML5 drag events at the document level so chapter text cannot
     * be dragged out of the reader into other apps. Selection, the action-mode
     * menu, and copy still work because we only block `dragstart`/`drag`/`drop`.
     *
     * Idempotent — installs once per WebView document via a window flag.
     */
    val disableTextDragScript: String = """
        (function() {
            if (window.__r2DragDisabled) { return; }
            window.__r2DragDisabled = true;

            var block = function(e) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            };
            document.addEventListener('dragstart', block, true);
            document.addEventListener('drag', block, true);
            document.addEventListener('drop', block, true);

            var style = document.createElement('style');
            style.textContent =
                '*, *::before, *::after {' +
                '  -webkit-user-drag: none !important;' +
                '  user-drag: none !important;' +
                '}';
            (document.head || document.documentElement).appendChild(style);
        })();
    """.trimIndent()

    /**
     * Restates a fixed-layout page's scale as `initial-scale` on its own viewport meta, which is
     * what makes it refit — Chromium resolves `loadWithOverviewMode` only once. No-op when the page
     * is already at that scale, so a correct fit is never disturbed.
     */
    fun getFixedLayoutScaleScript(width: Double, height: Double, scale: Double): String {
        val w = format(width)
        val h = format(height)
        val s = format(scale)
        return """
            (function() {
                var meta = document.querySelector('meta[name=viewport]');
                if (!meta) { return; }
                var current = window.visualViewport ? window.visualViewport.scale : 0;
                if (Math.abs(current - $s) < 0.002) { return; }
                meta.setAttribute('content', 'width=$w, height=$h, initial-scale=$s');
            })();
        """.trimIndent()
    }

    private fun format(value: Double): String = String.format(Locale.ROOT, "%.5f", value)
}
