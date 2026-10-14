import assert from 'node:assert/strict';
import test from 'node:test';

// Polyfill minimal browser DOM globals
globalThis.__APP_VERSION__ = '1.9.82';

const storageMap = new Map();
globalThis.localStorage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, val) => storageMap.set(key, String(val)),
    removeItem: (key) => storageMap.delete(key),
    clear: () => storageMap.clear()
};

const attributes = {};
const styles = {};
const appStyles = {};

const mockRoot = {
    setAttribute(k, v) { attributes[k] = String(v); },
    removeAttribute(k) { delete attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attributes, k); },
    getAttribute(k) { return attributes[k] || null; },
    style: {
        setProperty(k, v) { styles[k] = String(v); },
        removeProperty(k) { delete styles[k]; },
        getPropertyValue(k) { return styles[k] || ''; }
    }
};

const mockAppEl = {
    style: {
        width: '',
        height: '',
        removeProperty(k) { delete appStyles[k]; }
    }
};

globalThis.document = {
    documentElement: mockRoot,
    addEventListener: () => {},
    removeEventListener: () => {},
    body: {
        style: {
            removeProperty() {}
        }
    },
    getElementById(id) {
        if (id === 'app') return mockAppEl;
        return null;
    },
    createElement: () => ({ canPlayType: () => '', setAttribute: () => {}, style: {} })
};

globalThis.window = {
    innerWidth: 375,
    innerHeight: 812,
    addEventListener() {},
    removeEventListener() {}
};

const { layoutManager } = await import('../src/ui/LayoutManager.js');

/**
 * ============================================================================
 * Mobile UI & Display Scale Engine Test Suite
 * ============================================================================
 * Verifies that:
 *   1. Narrow / portrait viewports on web and mobile activate the mobile UI.
 *   2. Stamping data-litefin-portrait and data-litefin-scaled activates
 *      responsive styling and MobileNav.
 *   3. The Display Scale option scales BOTH portrait and landscape mobile UIs
 *      proportionally with the user's selected scale multiplier.
 * ============================================================================
 */

test('Mobile Scaling: Portrait viewport activates mobile portrait markers and calculates base scale', () => {
    // Simulate mobile phone in portrait (375x812)
    globalThis.window.innerWidth = 375;
    globalThis.window.innerHeight = 812;

    // Set display scale to auto
    layoutManager.setDisplayScale('auto', false);

    // Verify portrait markers are stamped
    assert.strictEqual(attributes['data-litefin-portrait'], '1', 'Must stamp data-litefin-portrait');
    assert.strictEqual(attributes['data-litefin-scaled'], '1', 'Must stamp data-litefin-scaled');

    // Base scale for 375px width against 750px portrait design width is 375 / 750 = 0.5
    const zoom = parseFloat(styles['zoom']);
    assert.ok(Math.abs(zoom - 0.5) < 0.01, `Zoom factor must be approximately 0.5 (actual: ${zoom})`);
    assert.strictEqual(styles['--litefin-app-w'], '750px', 'Counter-expanded width must be 750px');
});

test('Mobile Scaling: Display Scale option scales portrait mobile UI proportionally', () => {
    // Simulate mobile phone in portrait (375x812)
    globalThis.window.innerWidth = 375;
    globalThis.window.innerHeight = 812;

    // Set user display scale to 110% (1.1)
    layoutManager.setDisplayScale('1.1', false);

    // Expected scale: 0.5 base * 1.1 multiplier = 0.55
    const zoom = parseFloat(styles['zoom']);
    assert.ok(Math.abs(zoom - 0.55) < 0.01, `Portrait zoom must scale by 1.1x (actual: ${zoom})`);

    // Test scaling down to 80% (0.8)
    layoutManager.setDisplayScale('0.8', false);
    const zoom80 = parseFloat(styles['zoom']);
    assert.ok(Math.abs(zoom80 - 0.4) < 0.01, `Portrait zoom must scale by 0.8x (actual: ${zoom80})`);
});

test('Mobile Scaling: Display Scale option scales landscape mobile UI proportionally', () => {
    // Simulate mobile phone / tablet in landscape (800x375)
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 375;

    // Base landscape scale for 800px against 1600px is 800 / 1600 = 0.5
    layoutManager.setDisplayScale('auto', false);

    assert.strictEqual(attributes['data-litefin-portrait'], undefined, 'Must not be portrait');
    assert.strictEqual(attributes['data-litefin-scaled'], '1', 'Must stamp data-litefin-scaled in landscape');

    const baseZoom = parseFloat(styles['zoom']);
    assert.ok(Math.abs(baseZoom - 0.5) < 0.01, `Landscape base zoom must be 0.5 (actual: ${baseZoom})`);

    // Apply 120% display scale
    layoutManager.setDisplayScale('1.2', false);
    const zoom120 = parseFloat(styles['zoom']);
    assert.ok(Math.abs(zoom120 - 0.6) < 0.01, `Landscape zoom must scale to 0.5 * 1.2 = 0.6 (actual: ${zoom120})`);
});
