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
}
