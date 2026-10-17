import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * ============================================================================
 * Universal Mouse and Scroll Navigation Test Suite
 * ============================================================================
 * Verifies that:
 *   1. CSS rules allow mouse cursor interaction across all platforms.
 *   2. Media row scroll navigation arrows are injected across all platforms.
 *   3. Hero carousel navigation arrows are rendered and bound on all platforms.
 *   4. OSD player cursor setting is active by default everywhere.
 * ============================================================================
 */

test('base.css: cursor is not forcefully suppressed with cursor: none on TV platforms', () => {
    // Read source code of base.css and normalize line endings
    const baseCss = readFileSync('./src/styles/base.css', 'utf8').replace(/\r\n/g, '\n');

    // Ensure legacy platform-specific cursor suppression rule has been eliminated
    assert.equal(
        baseCss.includes('cursor: none !important;'),
        false,
        'base.css must not forcefully suppress cursor with cursor: none !important'
    );

    // Verify baseline cursor rule is set for body
    assert.ok(
        baseCss.includes('body {\n    cursor: default;\n}'),
        'base.css must define cursor: default on body'
    );
});

test('layout.css: row-scroll-arrows are hidden by default and revealed with pointer-events on hover', () => {
    // Read source code of layout.css and normalize line endings
    const layoutCss = readFileSync('./src/styles/layout.css', 'utf8').replace(/\r\n/g, '\n');

    // Verify row-scroll-arrows has pointer-events: none when opacity: 0
    assert.ok(
        layoutCss.includes('opacity: 0;\n    pointer-events: none;'),
        'row-scroll-arrows must have opacity: 0 and pointer-events: none when not hovered'
    );

    // Verify hover state restores opacity and pointer-events
    assert.ok(
        layoutCss.includes('.media-row:hover .row-scroll-arrows {\n    opacity: 1;\n    pointer-events: auto;\n}'),
        '.media-row:hover must set opacity: 1 and pointer-events: auto'
    );
});

test('VirtualCardRow: scroll navigation arrows are injected on all platforms when totalItems > 4', () => {
    // Read source code of VirtualCardRow.js and normalize line endings
    const rowSource = readFileSync('./src/components/VirtualCardRow.js', 'utf8').replace(/\r\n/g, '\n');

    // Verify platform checks are not gating scroll arrows injection
    assert.equal(
        rowSource.includes('(platformInfo.isWeb || platformInfo.isDesktop || platformInfo.isWebOS) && this.totalItems > 4'),
        false,
        'VirtualCardRow must not restrict scroll navigation arrows to specific platforms'
    );

    // Verify unconditional injection when totalItems > 4
    assert.ok(
        rowSource.includes('if (this.totalItems > 4) {\n            this._injectScrollArrows();\n        }'),
        'VirtualCardRow must inject scroll navigation arrows whenever totalItems > 4'
    );
});

test('HeroCarousel: navigation arrows are rendered and bound on all platforms when items.length > 1', () => {
    // Read source code of HeroCarousel.js and normalize line endings
    const carouselSource = readFileSync('./src/ui/HeroCarousel.js', 'utf8').replace(/\r\n/g, '\n');

    // Verify rendering is not guarded by platform check
    assert.equal(
        carouselSource.includes('(platformInfo.isWeb || platformInfo.isDesktop || platformInfo.isWebOS) && this._items.length > 1'),
        false,
        'HeroCarousel must not restrict arrow template rendering to specific platforms'
    );

    // Verify rendering condition is based on items count
    assert.ok(
        carouselSource.includes('if (this._items.length > 1) {\n            navArrowsHtml = `\n                <div class="hero-nav-arrows">'),
        'HeroCarousel must render navArrowsHtml whenever _items.length > 1'
    );

    // Verify arrow click listeners are bound unconditionally when buttons exist
    assert.ok(
        carouselSource.includes('const leftBtn = this._container.querySelector(\'.hero-arrow-left\');\n        const rightBtn = this._container.querySelector(\'.hero-arrow-right\');\n        if (leftBtn && rightBtn) {'),
        'HeroCarousel must bind previous and next click events when arrow buttons exist'
    );
});

test('PlayerSettings: enableMagicCursor defaults to true across all platforms', () => {
    // Read source code of PlayerSettings.js and normalize line endings
    const playerSettingsSource = readFileSync('./src/utils/PlayerSettings.js', 'utf8').replace(/\r\n/g, '\n');

    // Verify enableMagicCursor is not disabled for Tizen
    assert.equal(
        playerSettingsSource.includes('enableMagicCursor: !platformInfo.isTizen'),
        false,
        'PlayerSettings must not disable magic cursor on Tizen'
    );

    // Verify enableMagicCursor is true by default
    assert.ok(
        playerSettingsSource.includes('enableMagicCursor: true,'),
        'PlayerSettings must default enableMagicCursor to true'
    );
});
