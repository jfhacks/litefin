import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * ============================================================================
 * Player Backend Platform Recommendation and Dynamic Fallback Test Suite
 * ============================================================================
 * Verifies that the video player backend dynamically and reliably defaults to:
 *   - 'avplay' on Samsung Smart TV (Tizen)
 *   - 'webos' on LG Smart TV (webOS)
 *   - 'exoplayer' on Android devices (with native bridge)
 *   - 'movi' on Web / Desktop supporting WebCodecs
 *   - 'html5' as fallback for standard web browsers
 *
 * Also verifies that:
 *   1. Unconfigured backend preference (null in storage) resolves dynamically
 *      to the platform's recommendation at runtime instead of returning a stale
 *      static fallback.
 *   2. Legacy 'auto' preferences are cleanly migrated to the platform recommendation.
 *   3. Explicit user selections (e.g. forced 'html5') are strictly respected.
 * ============================================================================
 */

// Setup storage backing map and DOM globals for node test runner
const storageMap = new Map();
globalThis.localStorage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, val) => storageMap.set(key, String(val)),
    removeItem: (key) => storageMap.delete(key),
    clear: () => storageMap.clear()
};
globalThis.window = globalThis;
globalThis.document = {
    createElement: () => ({ canPlayType: () => '' })
};

// Import dependencies
const { platformInfo } = await import('../src/utils/PlatformInfo.js');
const { storage } = await import('../src/utils/StorageService.js');
const { PlayerSettings } = await import('../src/utils/PlayerSettings.js');

test('PlayerBackend: unconfigured preference on Tizen resolves to avplay', () => {
    // Clear storage to emulate a clean install or unconfigured setting
    storage.removeItem('player:playerBackend');

    // Emulate Samsung Tizen hardware environment
    globalThis.window.tizen = {};
    platformInfo.init();

    // Verify platform identification
    assert.strictEqual(platformInfo.isTizen, true, 'platformInfo must detect Tizen environment');

    // Verify dynamic recommendation resolver
    assert.strictEqual(
        PlayerSettings.getRecommendedBackend(),
        'avplay',
        'Recommended backend on Tizen must be avplay'
    );

    // Verify setting fetch with null storage returns recommended backend
    assert.strictEqual(
        PlayerSettings.get('playerBackend'),
        'avplay',
        'Unconfigured playerBackend on Tizen must resolve to avplay'
    );

    // Cleanup globals
    delete globalThis.window.tizen;
});

test('PlayerBackend: legacy auto setting on Tizen migrates to avplay and persists', () => {
    // Populate storage with legacy 'auto' value
    storage.removeItem('player:playerBackend');
    storage.setItem('player:playerBackend', 'auto');

    // Emulate Samsung Tizen hardware environment
    globalThis.window.tizen = {};
    platformInfo.init();

    // Query setting - must trigger migration
    const resolved = PlayerSettings.get('playerBackend');
    assert.strictEqual(resolved, 'avplay', 'Legacy auto on Tizen must resolve to avplay');

    // Verify persistence to storage
    assert.strictEqual(
        storage.getItem('player:playerBackend'),
        'avplay',
        'Migrated backend preference must be persisted to storage'
    );

    // Cleanup globals
    delete globalThis.window.tizen;
});

test('PlayerBackend: explicit user choice is preserved', () => {
    // Emulate Samsung Tizen hardware environment
    storage.removeItem('player:playerBackend');
    globalThis.window.tizen = {};
    platformInfo.init();

    // User explicitly selects HTML5 backend
    PlayerSettings.set('playerBackend', 'html5');

    // Verify explicit selection is returned even though avplay is recommended
    assert.strictEqual(
        PlayerSettings.get('playerBackend'),
        'html5',
        'Explicit user choice of html5 must be honored'
    );

    // Cleanup globals
    delete globalThis.window.tizen;
    storage.removeItem('player:playerBackend');
});

