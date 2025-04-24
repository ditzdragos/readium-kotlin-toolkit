// scaling.js

/** Debounce utility to limit how often a function is called */
function debounce(func, wait, immediate) {
	var timeout;
	return function() {
		var context = this, args = arguments;
		var later = function() {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		var callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
};

/**
 * Applies initial scaling and centering to fixed-layout content.
 */
export function applyInitialScaling() {
    // Prevent multiple executions
    if (window.r2ScalingApplied || window.r2ScalingInProgress) {
        console.log('Scaling already applied or in progress, skipping initial scaling.');
        return;
    }
    window.r2ScalingInProgress = true;
    console.log('Applying universal full-page scaling');

    // Prepare document/body styles
    document.documentElement.style.margin = '0';
    document.documentElement.style.padding = '0';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.backgroundColor = 'white'; // Ensure body background is white

    // Get content dimensions primarily from meta viewport
    var contentWidth, contentHeight;
    var dimensionMethod = '';
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

    // Fallback if meta tag is missing or invalid - crucial for FXL without viewport
    if (!contentWidth || !contentHeight) {
        console.log('No valid meta viewport dimensions found, using body scroll dimensions as fallback.');
        // Use scrollWidth/Height for fallback, but prefer clientWidth/Height if available and non-zero
        contentWidth = document.body.scrollWidth || document.documentElement.scrollWidth || document.body.clientWidth || document.documentElement.clientWidth;
        contentHeight = document.body.scrollHeight || document.documentElement.scrollHeight || document.body.clientHeight || document.documentElement.clientHeight;
        dimensionMethod = 'body/doc scroll/client dimensions';
        // Further fallback if scroll dimensions are zero (rare case)
        if (!contentWidth || !contentHeight) {
            console.log('Body/doc dimensions are zero, using default fallback 1024x768');
            contentWidth = 1024; // Consider if this fallback is appropriate
            contentHeight = 768;
            dimensionMethod = 'default fallback';
        }
        console.log('Using fallback dimensions: ' + contentWidth + 'x' + contentHeight);
    }

    console.log('Final dimension detection method: ' + dimensionMethod);

    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    console.log('Using JS viewport: ' + viewportWidth + 'x' + viewportHeight);

    // Calculate scale based on fitting content within viewport
    var scale = 1.0;
    if (contentWidth > 0 && contentHeight > 0) {
        scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);
    } else {
        console.warn("Content dimensions are zero or invalid, defaulting scale to 1.0");
        scale = 1.0;
    }

    // Apply safety margin (e.g., 1%)
    scale *= 0.99;
    console.log('Calculated scale (with safety margin): ' + scale.toFixed(3));

    // Apply scaling via wrapper
    var existingWrapper = document.getElementById('r2-scale-wrapper');
    var scaleContainer;

    if (existingWrapper) {
        console.log('Removing existing scale wrapper.');
        scaleContainer = document.getElementById('r2-scale-container');
        if (scaleContainer) {
            // Move children back to body carefully
            while (scaleContainer.firstChild) {
                 if(scaleContainer.firstChild !== existingWrapper) { // Avoid infinite loop
                    document.body.appendChild(scaleContainer.firstChild);
                 } else {
                    // If somehow the wrapper got inside, just remove it
                    scaleContainer.removeChild(scaleContainer.firstChild);
                 }
            }
        }
        // Remove wrapper from its parent, wherever it might be
        if (existingWrapper.parentNode) {
            existingWrapper.parentNode.removeChild(existingWrapper);
        }
    }

    console.log('Creating new scale wrapper and container.');
    var wrapper = document.createElement('div');
    wrapper.id = 'r2-scale-wrapper';
    // Style the wrapper to center its content (the scaleContainer)
    wrapper.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        overflow: hidden; background-color: transparent; /* Wrapper is see-through */
        display: flex; align-items: center; justify-content: center;
        box-sizing: border-box; padding: 0; margin: 0;
        pointer-events: none; /* Wrapper should not intercept clicks */
    `;

    scaleContainer = document.createElement('div');
    scaleContainer.id = 'r2-scale-container';
    // Style the container with original content dimensions and apply scale
    scaleContainer.style.cssText = `
        width: ${contentWidth}px; height: ${contentHeight}px;
        transform-origin: center center;
        transform: scale(${scale});
        position: relative; /* Needed for transform */
        background-color: white; /* Set background on container to avoid transparency issues */
        overflow: hidden; /* Contain the scaled content */
        pointer-events: auto; /* Allow interaction with scaled content */
    `;

    // Move original body children into the scale container
    var bodyContent = Array.from(document.body.children);

    document.body.appendChild(wrapper); // Add wrapper first to body
    wrapper.appendChild(scaleContainer); // Add scale container inside wrapper

    bodyContent.forEach(function(node) {
        // Make sure not to move the wrapper itself, or scripts/styles that should remain top-level
        if (node !== wrapper && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE' && node.tagName !== 'LINK') {
            scaleContainer.appendChild(node);
        }
    });

    // Mark scaling as completed and store info
    window.r2ScalingApplied = true;
    window.r2ScalingInProgress = false;
    window.r2ContentDimensions = { width: contentWidth, height: contentHeight, method: dimensionMethod };
    window.r2CurrentScale = scale;
    // Store the JS viewport dimensions used for this scaling for potential future comparison
    window.r2LastJSViewport = { width: viewportWidth, height: viewportHeight };

    console.log(`Universal scaling applied: ${contentWidth}x${contentHeight} (${dimensionMethod}) scaled to ${scale.toFixed(3)}`);
}

/**
 * Updates the scaling factor when viewport dimensions change.
 */
export function updateScaling() {
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;

    // Optional: Check if viewport actually changed significantly to avoid unnecessary updates
    if (window.r2LastJSViewport &&
        Math.abs(window.r2LastJSViewport.width - viewportWidth) < 5 &&
        Math.abs(window.r2LastJSViewport.height - viewportHeight) < 5) {
        // console.log('Viewport dimensions nearly unchanged, skipping scale update.');
        return;
    }

    console.log('Updating scaling for viewport: ' + viewportWidth + 'x' + viewportHeight);

    var scaleContainer = document.getElementById('r2-scale-container');
    if (!scaleContainer) {
        console.warn('Scale container not found during update. Attempting re-initialization.');
        // Reset flags and try to apply initial scaling again
        window.r2ScalingApplied = false;
        window.r2ScalingInProgress = false;
        applyInitialScaling();
        return;
    }

    // Use stored content dimensions if available, otherwise try reading from style (less reliable)
    var contentWidth = window.r2ContentDimensions?.width || parseInt(scaleContainer.style.width);
    var contentHeight = window.r2ContentDimensions?.height || parseInt(scaleContainer.style.height);

    if (!contentWidth || !contentHeight || contentWidth <= 0 || contentHeight <= 0) {
         console.error('Cannot update scaling: Invalid content dimensions detected.', { width: contentWidth, height: contentHeight });
         // Potentially attempt re-initialization here as well?
         return;
    }

    var dimensionMethod = window.r2ContentDimensions?.method || 'from style';
    // console.log('Using content dimensions for update: ' + contentWidth + 'x' + contentHeight + ' (' + dimensionMethod + ')');

    // Calculate new scale
    var scale = 1.0;
    if (contentWidth > 0 && contentHeight > 0) {
         scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);
    } else {
        console.warn("Content dimensions zero/invalid during update, defaulting scale to 1.0");
        scale = 1.0;
    }

    scale *= 0.99; // Apply safety margin

    console.log('Updating scale transform to: ' + scale.toFixed(3));
    scaleContainer.style.transform = 'scale(' + scale + ')';
    window.r2CurrentScale = scale; // Update stored scale
    // Update the stored viewport dimensions
    window.r2LastJSViewport = { width: viewportWidth, height: viewportHeight };
}

/**
 * Sets up the necessary event listeners for scaling.
 * This should be called once the core Readium scripts are ready.
 */
export function setupScalingListeners() {
    // Check if this content *should* be scaled (e.g., has viewport meta tag)
    const hasViewportMeta = document.querySelector('meta[name="viewport"]');

    if (hasViewportMeta) {
        console.log(`Viewport meta tag detected, setting up scaling listeners.`);

        // Debounced resize handler to avoid excessive updates
        const debouncedUpdateScaling = debounce(updateScaling, 250); // 250ms delay seems reasonable

        // Apply initial scaling
        // Check if document is already loaded, otherwise wait for DOMContentLoaded
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            console.log("Document ready, applying initial scaling immediately.");
            applyInitialScaling();
        } else {
            console.log("Document not ready, applying initial scaling on DOMContentLoaded.");
            // Using once: true ensures the listener is removed after first execution
            window.addEventListener('DOMContentLoaded', applyInitialScaling, { once: true });
        }

        // Add listener to update scaling on window resize
        window.addEventListener('resize', debouncedUpdateScaling);

    } else {
        console.log("No viewport meta tag found. Assuming reflowable content, scaling setup skipped.");
        // Ensure no previous scaling artifacts are present if switching content types
        var existingWrapper = document.getElementById('r2-scale-wrapper');
        if(existingWrapper && existingWrapper.parentNode) {
            console.log("Removing leftover scale wrapper found on non-FXL content.");
             // Move children back from container to body before removing wrapper
             var scaleContainer = document.getElementById('r2-scale-container');
             if (scaleContainer) {
                 while (scaleContainer.firstChild) {
                      if(scaleContainer.firstChild !== existingWrapper){
                         document.body.appendChild(scaleContainer.firstChild);
                      } else {
                         scaleContainer.removeChild(scaleContainer.firstChild);
                      }
                 }
             }
             existingWrapper.parentNode.removeChild(existingWrapper);
        }
        // Reset flags in case they were set by previous content
        window.r2ScalingApplied = false;
        window.r2ScalingInProgress = false;
        window.r2ContentDimensions = null;
        window.r2CurrentScale = null;
        window.r2LastJSViewport = null;
    }
}