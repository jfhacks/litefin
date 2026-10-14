import assert from 'node:assert/strict';
import test from 'node:test';

// Setup environment mocks
globalThis.window = {
    innerWidth: 1920,
    innerHeight: 1080
};
globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};
globalThis.document = {
    documentElement: { clientWidth: 1920, clientHeight: 1080 },
    createElement: () => ({
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        addEventListener: () => {},
        querySelectorAll: () => [],
        appendChild: () => {},
        innerHTML: ''
    }),
    body: {
        appendChild: () => {}
    }
};

test('AspectRatioMenu: Offers Zoom option on Tizen along with Auto, Video Aspect Ratio, and Stretch', async () => {
    // 1. Test Tizen platform detection
    globalThis.window.tizen = {};
    const { platformInfo } = await import('../src/utils/PlatformInfo.js');
    platformInfo._platform = 'tizen';

    const { default: AspectRatioMenu } = await import('../src/player/osd/AspectRatioMenu.js');

    const mockOsd = {
        player: {
            backendType: 'tizen',
            getAspectRatio: () => 'auto',
            setAspectRatio: () => {}
        },
        _getFocused: () => null,
        _currentFocusRow: 0,
        _currentFocusIndex: 0,
        _updateFocus: () => {}
    };

    const menu = new AspectRatioMenu(mockOsd);
    const optionsOnTizen = menu.options.map(opt => opt.id);

    assert.deepStrictEqual(
        optionsOnTizen,
        ['auto', 'zoom', 'video_aspect_ratio', 'stretch'],
        'On Tizen AVPlay, AspectRatioMenu must offer Auto, Zoom, Video Aspect Ratio, and Stretch'
    );
});

test('AspectRatioMenu: Retains Zoom option on non-Tizen platforms', async () => {
    // 2. Test non-Tizen platform
    delete globalThis.window.tizen;
    delete globalThis.window.webapis;

    const { platformInfo } = await import('../src/utils/PlatformInfo.js');
    platformInfo._platform = 'web';

    const { default: AspectRatioMenu } = await import('../src/player/osd/AspectRatioMenu.js');

    const mockOsd = {
        player: {
            getAspectRatio: () => 'auto',
            setAspectRatio: () => {}
        },
        _getFocused: () => null,
        _currentFocusRow: 0,
        _currentFocusIndex: 0,
        _updateFocus: () => {}
    };

    const menu = new AspectRatioMenu(mockOsd);
    const optionsOnWeb = menu.options.map(opt => opt.id);

    assert.deepStrictEqual(
        optionsOnWeb,
        ['auto', 'zoom', 'stretch'],
        'On non-Tizen platforms, AspectRatioMenu must retain Auto, Zoom, and Stretch'
    );
});

test('WebOSPlayer: Computes explicit layout bounding box geometry for auto, zoom, and stretch modes', async () => {
    // ------------------------------------------------------------------------
    // WebOS Player Architecture Verification
    // ------------------------------------------------------------------------
    // On webOS TV, CSS object-fit is not supported on hardware-backed <video>.
    // Verify that WebOSPlayer calculates and applies explicit layout bounding
    // box dimensions (width, height, left, top) for all supported modes.
    // ------------------------------------------------------------------------

    // Dynamically import WebOSPlayer backend
    const { WebOSPlayer } = await import('../src/player/core/WebOSPlayer.js');

    // Create a mock style object to record CSS properties
    const mockStyle = {};

    // Mock video element representing 2.40:1 ultrawide content (1920x800)
    const mockVideo = {
        videoWidth: 1920,
        videoHeight: 800,
        style: mockStyle
    };

    // Mock container representing a standard 1080p display viewport (1920x1080)
    const mockContainer = {
        clientWidth: 1920,
        clientHeight: 1080,
        appendChild: () => {}
    };

    // Instantiate WebOSPlayer instance with the mock container
    const player = new WebOSPlayer({ container: mockContainer });
    player._videoElement = mockVideo;

    // ------------------------------------------------------------------------
    // Case 1: Fullscreen Stretch Mode
    // ------------------------------------------------------------------------
    // Must force the bounding box to match the full container (1920x1080)
    player.setAspectRatio('stretch');
    assert.strictEqual(player.getAspectRatio(), 'stretch');
    assert.strictEqual(mockStyle.left, '0px');
    assert.strictEqual(mockStyle.top, '0px');
    assert.strictEqual(mockStyle.width, '1920px');
    assert.strictEqual(mockStyle.height, '1080px');
    assert.strictEqual(mockStyle.objectFit, 'fill');

    // ------------------------------------------------------------------------
    // Case 2: Auto (Letterbox / Contain) Mode
    // ------------------------------------------------------------------------
    // Scale = min(1920/1920, 1080/800) = 1.0
    // Width = 1920px, Height = 800px, Top = (1080 - 800) / 2 = 140px
    player.setAspectRatio('auto');
    assert.strictEqual(player.getAspectRatio(), 'auto');
    assert.strictEqual(mockStyle.width, '1920px');
    assert.strictEqual(mockStyle.height, '800px');
    assert.strictEqual(mockStyle.left, '0px');
    assert.strictEqual(mockStyle.top, '140px');

    // ------------------------------------------------------------------------
    // Case 3: Zoom (Crop / Cover) Mode
    // ------------------------------------------------------------------------
    // Scale = max(1920/1920, 1080/800) = 1.35
    // Width = round(1920 * 1.35) = 2592px, Height = round(800 * 1.35) = 1080px
    // Left = round((1920 - 2592) / 2) = -336px, Top = 0px
    player.setAspectRatio('zoom');
    assert.strictEqual(player.getAspectRatio(), 'zoom');
    assert.strictEqual(mockStyle.width, '2592px');
    assert.strictEqual(mockStyle.height, '1080px');
    assert.strictEqual(mockStyle.left, '-336px');
    assert.strictEqual(mockStyle.top, '0px');

    // ------------------------------------------------------------------------
    // Case 4: Transition from Stretch directly to Zoom
    // ------------------------------------------------------------------------
    // When previous mode was 'stretch', setting 'zoom' resets to auto first,
    // ensuring right and bottom constraints from stretch are cleared.
    player.setAspectRatio('stretch');
    assert.strictEqual(mockStyle.right, '0px');
    assert.strictEqual(mockStyle.bottom, '0px');

    player.setAspectRatio('zoom');
    assert.strictEqual(player.getAspectRatio(), 'zoom');
    assert.strictEqual(mockStyle.width, '2592px');
    assert.strictEqual(mockStyle.height, '1080px');
    assert.strictEqual(mockStyle.left, '-336px');
    assert.strictEqual(mockStyle.top, '0px');
    assert.strictEqual(mockStyle.right, '');
    assert.strictEqual(mockStyle.bottom, '');
});

test('TizenAVPlayer: Computes explicit display rect geometry for auto, zoom, stretch, and video_aspect_ratio modes', async () => {
    // ------------------------------------------------------------------------
    // Tizen AVPlay Architecture Verification
    // ------------------------------------------------------------------------
    // On Samsung Tizen TVs, AVPlay renders video via a hardware overlay plane.
    // CSS object-fit cannot be applied to this video plane.
    // Verify that TizenAVPlayer calculates and applies explicit layout bounding
    // box dimensions (x, y, width, height) and hardware display methods.
    // ------------------------------------------------------------------------

    // Dynamically import TizenAVPlayer backend
    const { TizenAVPlayer } = await import('../src/player/core/TizenAVPlayer.js');

    // Mock webapis.avplay hardware interface
    let lastRect = null;
    let lastMethod = null;
    const methodCalls = [];
    const mockAvplay = {
        setDisplayRect: (x, y, w, h) => {
            lastRect = { x, y, width: w, height: h };
        },
        setDisplayMethod: (method) => {
            lastMethod = method;
            methodCalls.push(method);
        },
        getCurrentStreamInfo: () => [
            {
                type: 'VIDEO',
                extra_info: JSON.stringify({ Width: 1920, Height: 800 })
            }
        ]
    };

    // Mock container representing a standard 1080p display viewport (1920x1080)
    const mockContainer = {
        clientWidth: 1920,
        clientHeight: 1080,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 })
    };

    // Instantiate TizenAVPlayer instance with mock container and mock avplay
    const player = new TizenAVPlayer({ container: mockContainer });
    player._avplay = mockAvplay;

    // ------------------------------------------------------------------------
    // Case 1: Fullscreen Stretch Mode
    // ------------------------------------------------------------------------
    player.setAspectRatio('stretch');
    assert.strictEqual(player.getAspectRatio(), 'stretch');
    assert.deepStrictEqual(lastRect, { x: 0, y: 0, width: 1920, height: 1080 });
    assert.strictEqual(lastMethod, 'PLAYER_DISPLAY_MODE_FULL_SCREEN');

    // ------------------------------------------------------------------------
    // Case 2: Auto (Letterbox / Contain) Mode
    // ------------------------------------------------------------------------
    player.setAspectRatio('auto');
    assert.strictEqual(player.getAspectRatio(), 'auto');
    assert.deepStrictEqual(lastRect, { x: 0, y: 0, width: 1920, height: 1080 });
    assert.strictEqual(lastMethod, 'PLAYER_DISPLAY_MODE_LETTER_BOX');

    // ------------------------------------------------------------------------
    // Case 3: Video Aspect Ratio Mode (Hardware DAR/PAR)
    // ------------------------------------------------------------------------
    player.setAspectRatio('video_aspect_ratio');
    assert.strictEqual(player.getAspectRatio(), 'video_aspect_ratio');
    assert.deepStrictEqual(lastRect, { x: 0, y: 0, width: 1920, height: 1080 });
    assert.strictEqual(lastMethod, 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');

    // ------------------------------------------------------------------------
    // Case 4: Zoom (Crop / Cover) Mode
    // ------------------------------------------------------------------------
    // Scale = max(1920/1920, 1080/800) = 1.35
    // Width = round(1920 * 1.35) = 2592px, Height = round(800 * 1.35) = 1080px
    // Left = round((1920 - 2592) / 2) = -336px, Top = 0px
    player.setAspectRatio('zoom');
    assert.strictEqual(player.getAspectRatio(), 'zoom');
    assert.deepStrictEqual(lastRect, { x: -336, y: 0, width: 2592, height: 1080 });
    assert.strictEqual(lastMethod, 'PLAYER_DISPLAY_MODE_LETTER_BOX');

    // ------------------------------------------------------------------------
    // Case 5: Transition from Stretch directly to Zoom
    // ------------------------------------------------------------------------
    // When previous mode was 'stretch', setting 'zoom' resets to 'auto' first
    // (clearing FULL_SCREEN stretch deformation) before applying the zoom crop.
    player.setAspectRatio('stretch');
    methodCalls.length = 0;
    player.setAspectRatio('zoom');
    assert.strictEqual(player.getAspectRatio(), 'zoom');
    assert.deepStrictEqual(methodCalls, ['PLAYER_DISPLAY_MODE_LETTER_BOX', 'PLAYER_DISPLAY_MODE_LETTER_BOX']);
    assert.deepStrictEqual(lastRect, { x: -336, y: 0, width: 2592, height: 1080 });
    assert.strictEqual(lastMethod, 'PLAYER_DISPLAY_MODE_LETTER_BOX');
});
