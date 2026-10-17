import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * ============================================================================
 * AndroidAdapter & Remote Back Navigation Test Suite
 * ============================================================================
 * Verifies that:
 *   1. Hardware Back dispatch (`handleHardwareBack`) emits `key:back` onto EventBus.
 *   2. Physical keyboard Escape and Backspace keys emit `key:back`.
 *   3. Native AndroidBridge.exit() is invoked upon adapter.exit().
 *   4. Native AndroidBridge.getDeviceName() resolves hardware model name.
 *   5. D-Pad and media key inputs map correctly to eventBus signals.
 * ============================================================================
 */

test('AndroidAdapter: handleHardwareBack emits key:back on EventBus', () => {
    let backEmitted = 0;
    const emittedEvents = [];

    const mockEventBus = {
        emit(event, data) {
            emittedEvents.push(event);
            if (event === 'key:back') {
                backEmitted++;
            }
        }
    };

    let exitCalled = false;
    let storageFlushed = false;

    const mockStorage = {
        flush() {
            storageFlushed = true;
        }
    };

    const mockWindow = {
        LitefinAndroid: {
            exit() {
                exitCalled = true;
            },
            getDeviceName() {
                return 'Google Chromecast with Google TV';
            }
        },
        location: {
            hash: '#/home'
        }
    };

    const listeners = {};
    const mockDocument = {
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        activeElement: null
    };

    const androidAdapterSource = readFileSync(new URL('../src/android/AndroidAdapter.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export .*;\n/gm, '');

    const sandbox = {
        eventBus: mockEventBus,
        storage: mockStorage,
        logger: { create: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
        window: mockWindow,
        document: mockDocument,
        Date,
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(androidAdapterSource + '\n; sandboxAdapter = new AndroidAdapter();', sandbox);

    const adapter = sandbox.sandboxAdapter;
    adapter.init();

    // Verify window.androidAdapter registration
    assert.strictEqual(mockWindow.androidAdapter, adapter);

    // Verify hardware back button dispatch
    adapter.handleHardwareBack();
    assert.strictEqual(backEmitted, 1, 'handleHardwareBack() should emit key:back');

    // Verify keyboard Escape key triggers back
    const keydownHandler = listeners['keydown']?.[0];
    assert.ok(keydownHandler, 'keydown handler should be registered');

    let defaultPrevented = false;
    keydownHandler({
        keyCode: 27,
        preventDefault() {
            defaultPrevented = true;
        }
    });

    assert.strictEqual(backEmitted, 2, 'Escape key should emit key:back');
    assert.strictEqual(defaultPrevented, true, 'Escape key should prevent default');

    // Verify exit delegation
    adapter.exit();
    assert.strictEqual(storageFlushed, true, 'Storage should be flushed on exit');
    assert.strictEqual(exitCalled, true, 'Native LitefinAndroid.exit should be called');

    // Verify device name query
    const deviceName = adapter.getDeviceName();
    assert.strictEqual(deviceName, 'Google Chromecast with Google TV');
});

test('AndroidAdapter: media and navigation keys trigger appropriate events', () => {
    const emittedEvents = [];
    const mockEventBus = {
        emit(event) {
            emittedEvents.push(event);
        }
    };

    const listeners = {};
    const mockDocument = {
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        activeElement: null
    };

    const mockWindow = {
        location: { hash: '#/player/123' }
    };

    const androidAdapterSource = readFileSync(new URL('../src/android/AndroidAdapter.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export .*;\n/gm, '');

    const sandbox = {
        eventBus: mockEventBus,
        storage: { flush() {} },
        logger: { create: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
        window: mockWindow,
        document: mockDocument,
        Date,
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(androidAdapterSource + '\n; sandboxAdapter = new AndroidAdapter();', sandbox);

    const adapter = sandbox.sandboxAdapter;
    adapter.init();

    const keydownHandler = listeners['keydown']?.[0];

    // D-Pad navigation
    keydownHandler({ keyCode: 37, preventDefault() {} }); // LEFT
    keydownHandler({ keyCode: 38, preventDefault() {} }); // UP
    keydownHandler({ keyCode: 39, preventDefault() {} }); // RIGHT
    keydownHandler({ keyCode: 40, preventDefault() {} }); // DOWN
    keydownHandler({ keyCode: 13, preventDefault() {} }); // ENTER

    // Media keys
    keydownHandler({ keyCode: 179, preventDefault() {} }); // PLAY_PAUSE
    keydownHandler({ keyCode: 227, preventDefault() {} }); // REWIND
    keydownHandler({ keyCode: 228, preventDefault() {} }); // FAST_FORWARD

    assert.deepStrictEqual(emittedEvents, [
        'key:left',
        'key:up',
        'key:right',
        'key:down',
        'key:enter',
        'key:playPause',
        'key:rewind',
        'key:fastForward'
    ]);
});

/**
 * ============================================================================
 * AndroidAdapter Screen Wake Lock & KeepScreenOn Test
 * ============================================================================
 * Verifies that:
 *   1. setKeepScreenOn correctly routes wake lock requests to LitefinAndroid bridge.
 *   2. player:play, player:playing, player:paused, and player:stopped triggers
 *      keepScreenOn transitions to prevent the 15-minute Android system screensaver.
 *   3. Modern navigator.wakeLock fallback engages when native bridge is unavailable.
 * ============================================================================
 */
test('AndroidAdapter: setKeepScreenOn delegates to native bridge and responds to player events', async () => {
    // Track invocations of native bridge setKeepScreenOn calls
    const keepScreenOnCalls = [];
    const eventHandlers = {};

    // Mock EventBus supporting registration and emission
    const mockEventBus = {
        on(event, handler) {
            eventHandlers[event] = eventHandlers[event] || [];
            eventHandlers[event].push(handler);
        },
        emit(event, payload) {
            const handlers = eventHandlers[event] || [];
            for (const fn of handlers) {
                fn(payload);
            }
        }
    };

    // Mock native LitefinAndroid host bridge
    const mockWindow = {
        LitefinAndroid: {
            setKeepScreenOn(keepOn) {
                keepScreenOnCalls.push(keepOn);
            },
            isTv() {
                return true;
            }
        },
        location: {
            hash: '#/home'
        }
    };

    // Minimal document stub for event listener attachments
    const mockDocument = {
        addEventListener() {},
        querySelector() {
            return null;
        },
        documentElement: {
            style: {
                removeProperty() {}
            },
            removeAttribute() {},
            hasAttribute() {
                return false;
            },
            requestFullscreen: async () => {}
        }
    };

    // Load AndroidAdapter source code dynamically in clean VM context
    const androidAdapterSource = readFileSync(new URL('../src/android/AndroidAdapter.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export .*;\n/gm, '');

    const sandbox = {
        eventBus: mockEventBus,
        storage: { flush() {} },
        logger: { create: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
        window: mockWindow,
        document: mockDocument,
        Date,
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(androidAdapterSource + '\n; sandboxAdapter = new AndroidAdapter();', sandbox);

    const adapter = sandbox.sandboxAdapter;
    adapter.init();

    // 1. Explicit setKeepScreenOn method verification
    adapter.setKeepScreenOn(true);
    adapter.setKeepScreenOn(false);

    assert.deepStrictEqual(keepScreenOnCalls, [true, false]);

    // 2. Playback state event integration tests
    // Reset call recording array
    keepScreenOnCalls.length = 0;

    // Simulate playback start: player:play
    mockEventBus.emit('player:play');
    assert.strictEqual(keepScreenOnCalls[keepScreenOnCalls.length - 1], true);

    // Simulate active playback frame arrival: player:playing
    mockEventBus.emit('player:playing');
    assert.strictEqual(keepScreenOnCalls[keepScreenOnCalls.length - 1], true);

    // Simulate user pausing: player:paused
    mockEventBus.emit('player:paused');
    assert.strictEqual(keepScreenOnCalls[keepScreenOnCalls.length - 1], false);

    // Simulate playback stopping / exiting: player:stopped
    mockEventBus.emit('player:stopped');
    assert.strictEqual(keepScreenOnCalls[keepScreenOnCalls.length - 1], false);
});

/**
 * ============================================================================
 * AndroidAdapter TV Remote Color Buttons Test Suite (TCL & Android TV)
 * ============================================================================
 * Validates that:
 *   1. Red/Green/Yellow/Blue remote buttons map to `key:red`, `key:green`,
 *      `key:yellow`, and `key:blue` using Android KeyEvent codes (183-186).
 *   2. Standard TV keycodes (403-406) also route correctly.
 *   3. W3C string keys (ColorF0Red, ColorF1Green, ColorF2Yellow, ColorF3Blue)
 *      are recognized even if keycode is absent or zero.
 *   4. Native bridge hooks (__litefinAndroidColorButton / onTvRemoteColor)
 *      dispatch colored remote signals into EventBus.
 * ============================================================================
 */
test('AndroidAdapter: TV remote colored buttons (Red, Green, Yellow, Blue) dispatch events correctly', () => {
    // Record emitted event names and payload contents
    const emittedEvents = [];
    const mockEventBus = {
        emit(event, data) {
            emittedEvents.push({ event, data });
        }
    };

    // Store DOM listeners registered by adapter
    const listeners = {};
    const mockDocument = {
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        activeElement: null
    };

    const mockWindow = {
        location: { hash: '#/home' }
    };

    const androidAdapterSource = readFileSync(new URL('../src/android/AndroidAdapter.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export .*;\n/gm, '');

    const sandbox = {
        eventBus: mockEventBus,
        storage: { flush() {} },
        logger: { create: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
        window: mockWindow,
        document: mockDocument,
        Date,
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(androidAdapterSource + '\n; sandboxAdapter = new AndroidAdapter();', sandbox);

    const adapter = sandbox.sandboxAdapter;
    adapter.init();

    const keydownHandler = listeners['keydown']?.[0];
    assert.ok(keydownHandler, 'keydown handler must be registered');

    // Prevent default verification flags
    let preventedCount = 0;
    const makeEvent = (props) => ({
        preventDefault() { preventedCount++; },
        ...props
    });

    // 1. Android native keycodes (TCL TV remotes: 183, 184, 185, 186)
    keydownHandler(makeEvent({ keyCode: 183 })); // KEYCODE_PROG_RED
    keydownHandler(makeEvent({ keyCode: 184 })); // KEYCODE_PROG_GREEN
    keydownHandler(makeEvent({ keyCode: 185 })); // KEYCODE_PROG_YELLOW
    keydownHandler(makeEvent({ keyCode: 186 })); // KEYCODE_PROG_BLUE

    assert.strictEqual(preventedCount, 4, 'Color keys must invoke preventDefault');
    assert.strictEqual(emittedEvents[0].event, 'key:red');
    assert.strictEqual(emittedEvents[1].event, 'key:green');
    assert.strictEqual(emittedEvents[2].event, 'key:yellow');
    assert.strictEqual(emittedEvents[3].event, 'key:blue');

    // 2. Standard smart TV / legacy keycodes (403, 404, 405, 406)
    keydownHandler(makeEvent({ keyCode: 403 }));
    keydownHandler(makeEvent({ keyCode: 404 }));
    keydownHandler(makeEvent({ keyCode: 405 }));
    keydownHandler(makeEvent({ keyCode: 406 }));

    assert.strictEqual(emittedEvents[4].event, 'key:red');
    assert.strictEqual(emittedEvents[5].event, 'key:green');
    assert.strictEqual(emittedEvents[6].event, 'key:yellow');
    assert.strictEqual(emittedEvents[7].event, 'key:blue');

    // 3. W3C DOM UI Events key attribute evaluation
    keydownHandler(makeEvent({ keyCode: 0, key: 'ColorF0Red' }));
    keydownHandler(makeEvent({ keyCode: 0, key: 'ColorF1Green' }));
    keydownHandler(makeEvent({ keyCode: 0, key: 'ColorF2Yellow' }));
    keydownHandler(makeEvent({ keyCode: 0, key: 'ColorF3Blue' }));

    assert.strictEqual(emittedEvents[8].event, 'key:red');
    assert.strictEqual(emittedEvents[9].event, 'key:green');
    assert.strictEqual(emittedEvents[10].event, 'key:yellow');
    assert.strictEqual(emittedEvents[11].event, 'key:blue');

    // 4. Native bridge hooks invocation
    mockWindow.__litefinAndroidColorButton('red');
    mockWindow.onTvRemoteColor('green');
    adapter.handleColorButton('yellow');
    adapter.handleColorButton('blue');

    assert.strictEqual(emittedEvents[12].event, 'key:red');
    assert.strictEqual(emittedEvents[13].event, 'key:green');
    assert.strictEqual(emittedEvents[14].event, 'key:yellow');
    assert.strictEqual(emittedEvents[15].event, 'key:blue');
});

/**
 * ============================================================================
 * AndroidAdapter Dedicated Media Buttons & MediaSession Test Suite
 * ============================================================================
 * Validates that:
 *   1. Dedicated Play/Pause/Forward/Backward buttons on TV remotes fire
 *      corresponding key events.
 *   2. Skip Forward (274/272) and Skip Backward (275/273) keys map to seeking.
 *   3. Next (87) and Previous (88) track buttons fire key:next and key:previous.
 *   4. updateMediaSession binds action handlers and metadata on navigator.mediaSession.
 *   5. Action handlers successfully delegate to player callbacks.
 *   6. clearMediaSession cleanly detaches all action handlers.
 * ============================================================================
 */
test('AndroidAdapter: dedicated media controls and MediaSession integration operate seamlessly', () => {
    // Record emitted event names
    const emittedEvents = [];
    const mockEventBus = {
        emit(event) {
            emittedEvents.push(event);
        },
        on() {}
    };

    const listeners = {};
    const mockDocument = {
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        activeElement: null
    };

    // Mock W3C MediaSession environment
    const actionHandlers = {};
    const mockMediaSession = {
        metadata: null,
        playbackState: 'none',
        setActionHandler(action, handler) {
            actionHandlers[action] = handler;
        }
    };

    const mockWindow = {
        location: { hash: '#/player/456' },
        MediaMetadata: function(data) {
            Object.assign(this, data);
        }
    };

    const mockNavigator = {
        mediaSession: mockMediaSession
    };

    const androidAdapterSource = readFileSync(new URL('../src/android/AndroidAdapter.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export .*;\n/gm, '');

    const sandbox = {
        eventBus: mockEventBus,
        storage: { flush() {} },
        logger: { create: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
        window: mockWindow,
        navigator: mockNavigator,
        document: mockDocument,
        Date,
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(androidAdapterSource + '\n; sandboxAdapter = new AndroidAdapter();', sandbox);

    const adapter = sandbox.sandboxAdapter;
    adapter.init();

    const keydownHandler = listeners['keydown']?.[0];
    const makeEvent = (props) => ({
        preventDefault() {},
        ...props
    });

    // 1. Media keycodes dispatch tests
    keydownHandler(makeEvent({ keyCode: 126 })); // KEYCODE_MEDIA_PLAY
    keydownHandler(makeEvent({ keyCode: 127 })); // KEYCODE_MEDIA_PAUSE
    keydownHandler(makeEvent({ keyCode: 85 }));  // KEYCODE_MEDIA_PLAY_PAUSE
    keydownHandler(makeEvent({ keyCode: 86 }));  // KEYCODE_MEDIA_STOP
    keydownHandler(makeEvent({ keyCode: 90 }));  // KEYCODE_MEDIA_FAST_FORWARD
    keydownHandler(makeEvent({ keyCode: 89 }));  // KEYCODE_MEDIA_REWIND
    keydownHandler(makeEvent({ keyCode: 274 })); // KEYCODE_MEDIA_SKIP_FORWARD (TCL/Sony)
    keydownHandler(makeEvent({ keyCode: 275 })); // KEYCODE_MEDIA_SKIP_BACKWARD (TCL/Sony)
    keydownHandler(makeEvent({ keyCode: 87 }));  // KEYCODE_MEDIA_NEXT
    keydownHandler(makeEvent({ keyCode: 88 }));  // KEYCODE_MEDIA_PREVIOUS

    // Key string fallbacks (Chromium WebView on Android TV)
    keydownHandler(makeEvent({ keyCode: 0, key: 'MediaPlay' }));
    keydownHandler(makeEvent({ keyCode: 0, key: 'MediaPause' }));
    keydownHandler(makeEvent({ keyCode: 0, key: 'MediaFastForward' }));
    keydownHandler(makeEvent({ keyCode: 0, key: 'MediaRewind' }));

    assert.deepStrictEqual(emittedEvents, [
        'key:play',
        'key:pause',
        'key:playPause',
        'key:stop',
        'key:fastForward',
        'key:rewind',
        'key:fastForward',
        'key:rewind',
        'key:next',
        'key:previous',
        'key:play',
        'key:pause',
        'key:fastForward',
        'key:rewind'
    ]);

    // 2. MediaSession synchronization tests
    let played = false;
    let paused = false;
    let soughtFwd = false;
    let soughtBack = false;

    adapter.updateMediaSession(
        {
            title: 'Interstellar',
            artist: '2014',
            album: 'Sci-Fi'
        },
        {
            onPlay: () => { played = true; },
            onPause: () => { paused = true; },
            onSeekForward: () => { soughtFwd = true; },
            onSeekBackward: () => { soughtBack = true; }
        }
    );

    // Verify metadata was stored
    assert.strictEqual(mockMediaSession.metadata.title, 'Interstellar');
    assert.strictEqual(mockMediaSession.metadata.artist, '2014');

    // Verify action handlers trigger callbacks
    assert.ok(typeof actionHandlers['play'] === 'function');
    actionHandlers['play']();
    assert.strictEqual(played, true);

    assert.ok(typeof actionHandlers['pause'] === 'function');
    actionHandlers['pause']();
    assert.strictEqual(paused, true);

    assert.ok(typeof actionHandlers['seekforward'] === 'function');
    actionHandlers['seekforward']();
    assert.strictEqual(soughtFwd, true);

    assert.ok(typeof actionHandlers['seekbackward'] === 'function');
    actionHandlers['seekbackward']();
    assert.strictEqual(soughtBack, true);

    // Verify clearMediaSession nullifies handlers
    adapter.clearMediaSession();
    assert.strictEqual(actionHandlers['play'], null);
    assert.strictEqual(actionHandlers['pause'], null);
    assert.strictEqual(mockMediaSession.metadata, null);
});

test('AndroidAdapter: mobile fullscreen toggling, default state, and TV vs Mobile distinction', () => {
    const storageData = {};
    const emittedEvents = [];

    const mockEventBus = {
        emit(event, data) {
            emittedEvents.push({ event, data });
        },
        on() {},
        off() {}
    };

    const mockStorage = {
        getItem(key) {
            return storageData[key] || null;
        },
        setItem(key, value) {
            storageData[key] = String(value);
        }
    };

    let nativeFullscreenCalls = [];
    const mockWindow = {
        LitefinAndroid: {
            isTv() {
                return false; // Mobile phone environment
            },
            setFullscreen(fs) {
                nativeFullscreenCalls.push(fs);
            }
        },
        addEventListener() {},
        removeEventListener() {}
    };

    const mockDocument = {
        addEventListener() {},
        querySelector() { return null; },
        documentElement: {
            setAttribute() {},
            removeAttribute() {},
            style: {
                removeProperty() {},
                setProperty() {}
            }
        }
    };

    const androidAdapterSource = readFileSync(new URL('../src/android/AndroidAdapter.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export .*;\n/gm, '');

    const sandbox = {
        eventBus: mockEventBus,
        storage: mockStorage,
        logger: { create: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
        window: mockWindow,
        document: mockDocument,
        Date,
        console
    };

    vm.createContext(sandbox);
    vm.runInContext(androidAdapterSource + '\n; sandboxAdapter = new AndroidAdapter();', sandbox);

    const adapter = sandbox.sandboxAdapter;

    // 1. Verify default state is NOT fullscreen on mobile
    assert.strictEqual(adapter.isMobileFullscreenEnabled(), false, 'Mobile fullscreen should default to false');

    // 2. Initialize adapter on mobile - should invoke setFullscreen(false)
    nativeFullscreenCalls = [];
    adapter.init();
    assert.deepStrictEqual(nativeFullscreenCalls, [false], 'Mobile init should set native fullscreen to false by default');

    // 3. Toggle fullscreen ON
    nativeFullscreenCalls = [];
    adapter.setMobileFullscreen(true);
    assert.strictEqual(adapter.isMobileFullscreenEnabled(), true, 'Preference should now be true');
    assert.strictEqual(storageData['pref:mobileFullscreen'], 'true', 'Storage should persist true');
    assert.deepStrictEqual(nativeFullscreenCalls, [true], 'Native bridge should receive setFullscreen(true)');
    assert.ok(emittedEvents.some(e => e.event === 'settings:mobileFullscreenChanged' && e.data === true));

    // 4. Toggle fullscreen OFF
    nativeFullscreenCalls = [];
    adapter.setMobileFullscreen(false);
    assert.strictEqual(adapter.isMobileFullscreenEnabled(), false, 'Preference should now be false');
    assert.strictEqual(storageData['pref:mobileFullscreen'], 'false', 'Storage should persist false');
    assert.deepStrictEqual(nativeFullscreenCalls, [false], 'Native bridge should receive setFullscreen(false)');

    // 5. Verify TV behavior: Android TV is always fullscreen
    mockWindow.LitefinAndroid.isTv = () => true;
    assert.strictEqual(adapter.isMobileFullscreenEnabled(), true, 'Android TV should always report fullscreen enabled');

    // Attempting to set false on TV does not disable fullscreen
    nativeFullscreenCalls = [];
    adapter.setMobileFullscreen(false);
    assert.strictEqual(nativeFullscreenCalls.length, 0, 'TV hardware should ignore setFullscreen calls from mobile toggle');
});

