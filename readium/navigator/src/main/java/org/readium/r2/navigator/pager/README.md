# EPUB WebView Rendering Extensions

This package contains extensions for the Readium EPUB rendering process, particularly focusing on handling specific styling scenarios in WebView.

### Implementation

The implementation consists of:

1. **WebViewScripts.kt**: Contains JavaScript for injection into the WebView
   - `getCenteringScript()`: Returns JavaScript to center fixed-layout content

2. **ReadiumCss.kt**: Contains CSS that's injected earlier in the process
   - Resets first-letter styling to ensure consistency

3. **R2EpubPageFragment.kt**: Controls when to inject the scripts
   - For fixed layouts: Calls `injectCenteringJavaScript()`

## Adding New WebView Scripts

When adding new WebView scripts:

1. Add your script function to `WebViewScripts.kt`
2. Implement a corresponding injection method in `R2EpubPageFragment.kt`
3. Call your injection method at the appropriate time in the page lifecycle
4. Document your approach in this README

## Maintainer Notes

- Keep JavaScript strings clean and well-commented
- Use triple quotes (`"""`) for JavaScript strings to avoid escaping issues
- Consider the timing of script injection (it matters when manipulating the DOM)
- Test on a variety of EPUB files, especially those with complex layouts 