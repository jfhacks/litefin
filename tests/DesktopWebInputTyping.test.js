import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * ============================================================================
 * Web & Desktop Keyboard Input Handling Test Suite
 * ============================================================================
 * Verifies that:
 *   1. Letters 'W' (87), 'X' (88), 'U' (85) are not hijacked as media keys.
 *   2. When actively typing inside form inputs (<input>, <textarea>, contentEditable),
 *      no letter keys or shortcuts call preventDefault() or emit media actions.
 *   3. Escape key continues to emit key:back for dialog dismissal.
 *   4. Outside form inputs, standard shortcuts (e.g. K/Space for playPause) function.
 * ============================================================================
 */

function setupAdapterTest(filePath, adapterExportName, keysName) {
    const source = readFileSync(filePath, 'utf8');

    let keydownListener = null;
    let activeElement = null;

    const mockDocument = {
        addEventListener(event, handler) {
            if (event === 'keydown') {
                keydownListener = handler;
            }
        },
        removeEventListener() {},
        get activeElement() {
            return activeElement;
        }
    };

    const emittedEvents = [];
    const mockEventBus = {
        emit(event, payload) {
            emittedEvents.push({ event, payload });
        },
        on() {},
        off() {}
    };

    const mockStorage = {
        getItem() { return null; },
        setItem() {},
        flush() {}
    };

    const mockLogger = {
        create() {
            return { debug() {}, info() {}, warn() {}, error() {} };
        }
    };

    const mockWindow = {
        location: { hash: '#/home' }
    };

    const cleanedSource = source
        .replace(/import\s+[\s\S]*?from\s+['"].*?['"];?/g, '')
        .replace(/export\s+default\s+.*?;?/g, '')
        .replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =');

    const context = {
        document: mockDocument,
        window: mockWindow,
        navigator: { userAgent: 'Chrome/120.0' },
        eventBus: mockEventBus,
        storage: mockStorage,
        logger: mockLogger,
        console,
        Boolean,
        Date
    };

    vm.createContext(context);
    vm.runInContext(cleanedSource + `\nthis.adapter = ${adapterExportName}; this.KEYS = ${keysName};`, context);

    const adapter = context.adapter;
    const KEYS = context.KEYS;

    adapter._setupKeyHandler();

    return {
        adapter,
        KEYS,
        emittedEvents,
        mockWindow,
        setActiveElement: (elem) => { activeElement = elem; },
        dispatchKey: (key, keyCode) => {
            let prevented = false;
            const event = {
                key,
                keyCode,
                preventDefault() { prevented = true; },
                ctrlKey: false,
                altKey: false,
                metaKey: false
            };
            keydownListener(event);
            return { prevented, event };
        }
    };
}

test('WebAdapter: WEB_KEYS does not contain bogus media aliases for W, X, U', () => {
    const { KEYS } = setupAdapterTest('./src/web/WebAdapter.js', 'webAdapter', 'WEB_KEYS');

    assert.equal(KEYS.MEDIA_PLAY_PAUSE_ALT, undefined, 'MEDIA_PLAY_PAUSE_ALT (85) must be removed');
    assert.equal(KEYS.MEDIA_NEXT_ALT, undefined, 'MEDIA_NEXT_ALT (87) must be removed');
    assert.equal(KEYS.MEDIA_PREV_ALT, undefined, 'MEDIA_PREV_ALT (88) must be removed');
});

test('WebAdapter: All letters (including W, X, U) are allowed in text inputs without preventDefault', () => {
    const harness = setupAdapterTest('./src/web/WebAdapter.js', 'webAdapter', 'WEB_KEYS');

    harness.setActiveElement({
        tagName: 'INPUT',
        type: 'text'
    });

    // Test 'w' / 'W' (keyCode 87)
    let res = harness.dispatchKey('w', 87);
    assert.equal(res.prevented, false, "'w' must not be prevented in input");

    // Test 'x' / 'X' (keyCode 88)
    res = harness.dispatchKey('x', 88);
    assert.equal(res.prevented, false, "'x' must not be prevented in input");

    // Test 'u' / 'U' (keyCode 85)
    res = harness.dispatchKey('u', 85);
    assert.equal(res.prevented, false, "'u' must not be prevented in input");

    // Test other letters like 'k', 'j', 'l', 'm', 'f' (player shortcuts)
    for (const [char, code] of [['k', 75], ['j', 74], ['l', 76], ['m', 77], ['f', 70]]) {
        res = harness.dispatchKey(char, code);
        assert.equal(res.prevented, false, `'${char}' must not be prevented in input`);
    }

    // Verify no media events were emitted while typing
    assert.equal(harness.emittedEvents.length, 0, 'No media shortcuts should be emitted when typing in input');
});

test('WebAdapter: Escape inside input field emits key:back and prevents default', () => {
    const harness = setupAdapterTest('./src/web/WebAdapter.js', 'webAdapter', 'WEB_KEYS');

    harness.setActiveElement({
        tagName: 'INPUT',
        type: 'text'
    });

    const res = harness.dispatchKey('Escape', 27);
    assert.equal(res.prevented, true, 'Escape should call preventDefault');
    assert.equal(harness.emittedEvents.some(e => e.event === 'key:back'), true, 'Escape should emit key:back');
});

test('DesktopAdapter: DESKTOP_KEYS does not contain bogus media aliases for W, X, U', () => {
    const { KEYS } = setupAdapterTest('./src/desktop/DesktopAdapter.js', 'desktopAdapter', 'DESKTOP_KEYS');

    assert.equal(KEYS.MEDIA_PLAY_PAUSE_ALT, undefined, 'MEDIA_PLAY_PAUSE_ALT (85) must be removed');
    assert.equal(KEYS.MEDIA_NEXT_ALT, undefined, 'MEDIA_NEXT_ALT (87) must be removed');
    assert.equal(KEYS.MEDIA_PREV_ALT, undefined, 'MEDIA_PREV_ALT (88) must be removed');
});

test('DesktopAdapter: All letters (including W, X, U) are allowed in text inputs without preventDefault', () => {
    const harness = setupAdapterTest('./src/desktop/DesktopAdapter.js', 'desktopAdapter', 'DESKTOP_KEYS');

    harness.setActiveElement({
        tagName: 'INPUT',
        type: 'text'
    });

    // Test 'w' / 'W' (keyCode 87)
    let res = harness.dispatchKey('w', 87);
    assert.equal(res.prevented, false, "'w' must not be prevented in input");

    // Test 'x' / 'X' (keyCode 88)
    res = harness.dispatchKey('x', 88);
    assert.equal(res.prevented, false, "'x' must not be prevented in input");

    // Test 'u' / 'U' (keyCode 85)
    res = harness.dispatchKey('u', 85);
    assert.equal(res.prevented, false, "'u' must not be prevented in input");

    // Test textarea element as well
    harness.setActiveElement({
        tagName: 'TEXTAREA'
    });
    res = harness.dispatchKey('u', 85);
    assert.equal(res.prevented, false, "'u' must not be prevented in textarea");

    // Verify no media events were emitted while typing
    assert.equal(harness.emittedEvents.length, 0, 'No media shortcuts should be emitted when typing in input');
});

test('DesktopAdapter: Outside inputs during video playback, media shortcuts still function', () => {
    const harness = setupAdapterTest('./src/desktop/DesktopAdapter.js', 'desktopAdapter', 'DESKTOP_KEYS');

    // Outside input (e.g. focused on container or button)
    harness.setActiveElement({
        tagName: 'DIV'
    });
    harness.mockWindow.location.hash = '#/player';

    // Press 'k' for play/pause
    const res = harness.dispatchKey('k', 75);
    assert.equal(res.prevented, true, "'k' in player outside inputs should call preventDefault");
    assert.equal(harness.emittedEvents.some(e => e.event === 'key:playPause'), true, "'k' should emit key:playPause");
});
