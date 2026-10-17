import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ============================================================================
// Environment Mock for ES Module Imports in Node.js
// ============================================================================
// Initialize local storage and window mocks so PlayerSettings, storage,
// and LanguageManager can load cleanly in the Node test environment.
// ============================================================================
const storageMap = new Map();
globalThis.localStorage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, val) => storageMap.set(key, String(val)),
    removeItem: (key) => storageMap.delete(key),
    clear: () => storageMap.clear()
};

globalThis.document = {
    createElement: () => ({
        canPlayType: () => ''
    })
};

globalThis.screen = { width: 1920, height: 1080 };
globalThis.window = globalThis;

// Import LanguageManager, MediaHelper, and storage modules
const { languageManager } = await import('../src/utils/LanguageManager.js');
const { MediaHelper } = await import('../src/player/core/MediaHelper.js');
const { storage } = await import('../src/utils/StorageService.js');

// Read JellyfinPlayer.js source to extract resolveSubtitleStream without loading CSS/DOM
const playerSource = readFileSync(new URL('../src/player/core/JellyfinPlayer.js', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');

function setup(settings = {}, serverUser = null) {
    const currentSettings = {
        subtitleMode: 'Default',
        subtitleLanguage: 'eng',
        preferExternalSubtitles: false,
        ...settings
    };

    let currentUser = serverUser;

    const context = vm.createContext({
        PlayerSettings: {
            get: (key) => currentSettings[key],
            set: (key, val) => { currentSettings[key] = val; }
        },
        storage: {
            getItem: (key) => {
                if (key === 'pref:subtitleLang') return currentSettings.subtitleLanguage || 'none';
                return storageMap.get(key) || null;
            },
            setItem: (key, val) => storageMap.set(key, String(val)),
            removeItem: (key) => storageMap.delete(key)
        },
        auth: {
            getCurrentUser: () => currentUser
        },
        languageManager,
        log: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        }
    });

    // Extract isLanguageMatch, getEffectiveSubtitleMode, isForcedStream, and resolveSubtitleStream
    const startMarker = 'const isLanguageMatch = (trackLang, targetLanguage) => {';
    const endMarker = '/**\n * Automatically resolve the best audio track for a given media source.';

    const startIdx = playerSource.indexOf(startMarker);
    const endIdx = playerSource.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
        throw new Error('Failed to locate resolveSubtitleStream source block in JellyfinPlayer.js');
    }

    const codeToRun = playerSource.slice(startIdx, endIdx).replace(/export function /g, 'function ');
    const script = `
        ${codeToRun}
        ({ resolveSubtitleStream, isForcedStream, getEffectiveSubtitleMode });
    `;

    const { resolveSubtitleStream, isForcedStream, getEffectiveSubtitleMode } = vm.runInContext(script, context);
    return {
        resolveSubtitleStream,
        isForcedStream,
        getEffectiveSubtitleMode,
        setServerUser: (u) => { currentUser = u; },
        setSetting: (key, val) => { currentSettings[key] = val; }
    };
}

// ============================================================================
// Subtitle Mode & Track Selection Test Suite
// ============================================================================

test('isForcedStream: Never treats tracks as forced merely because LocalizedForced is "Forced"', () => {
    const { isForcedStream } = setup();

    // Track matching the user log (Cat's in the Bag... episode)
    const track = {
        Codec: 'PGSSUB',
        Language: 'eng',
        DisplayTitle: 'English - PGSSUB',
        Title: '',
        IsDefault: false,
        IsForced: false,
        LocalizedForced: 'Forced'
    };

    assert.equal(
        isForcedStream(track),
        false,
        'Track with IsForced: false and LocalizedForced: "Forced" must NOT be considered forced'
    );
});

test('isForcedStream: Identifies forced tracks via boolean or title keywords', () => {
    const { isForcedStream } = setup();

    assert.equal(isForcedStream({ IsForced: true, Title: 'English' }), true);
    assert.equal(isForcedStream({ Forced: true, Title: 'English' }), true);
    assert.equal(isForcedStream({ IsForced: false, Title: 'English (Forced)' }), true);
    assert.equal(isForcedStream({ IsForced: false, DisplayTitle: 'English - Forced [SRT]' }), true);
    assert.equal(isForcedStream({ IsForced: false, Title: 'Reinforce' }), false);
    assert.equal(isForcedStream({ IsForced: false, Title: 'English' }), false);
});

test('resolveSubtitleStream: Subtitle mode "None" always returns -1 even if container has default subtitle', () => {
    const { resolveSubtitleStream } = setup({
        subtitleMode: 'None',
        subtitleLanguage: 'eng'
    });

    const mediaSource = {
        Id: 'test-source-none',
        DefaultSubtitleStreamIndex: 2,
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: true, IsForced: false, Title: 'English' },
            { Type: 'Subtitle', Index: 3, Language: 'spa', IsDefault: false, IsForced: false, Title: 'Spanish' }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, -1, 'Subtitle mode "None" must always resolve to -1 (disabled)');
});

test('resolveSubtitleStream: Subtitle mode "OnlyForced" returns -1 for track with LocalizedForced: "Forced"', () => {
    const { resolveSubtitleStream } = setup({
        subtitleMode: 'OnlyForced',
        subtitleLanguage: 'eng'
    });

    // Exact track structure from user's Breaking Bad episode log
    const mediaSource = {
        Id: 'test-source-breaking-bad',
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            {
                Type: 'Subtitle',
                Index: 2,
                Language: 'eng',
                IsDefault: false,
                IsForced: false,
                DisplayTitle: 'English - PGSSUB',
                LocalizedForced: 'Forced'
            }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, -1, 'Subtitle mode "OnlyForced" must resolve to -1 when track is not forced');
});

test('resolveSubtitleStream: Subtitle mode "OnlyForced" detects forced track via IsForced boolean', () => {
    const { resolveSubtitleStream } = setup({
        subtitleMode: 'OnlyForced',
        subtitleLanguage: 'eng'
    });

    const mediaSource = {
        Id: 'test-source-forced-bool',
        DefaultSubtitleStreamIndex: 2,
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: true, IsForced: false, Title: 'Full Subtitles' },
            { Type: 'Subtitle', Index: 3, Language: 'eng', IsDefault: false, IsForced: true, Title: 'English Forced' }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, 3, 'Subtitle mode "OnlyForced" must select track with IsForced: true');
});

test('resolveSubtitleStream: Subtitle mode "Default" defers to server preference "OnlyForced"', () => {
    // Client setting: 'Default' (Server Preference)
    // Server user profile: SubtitleMode = 'OnlyForced'
    const serverUser = {
        Configuration: {
            SubtitleMode: 'OnlyForced',
            SubtitleLanguagePreference: 'eng'
        }
    };

    const { resolveSubtitleStream } = setup({ subtitleMode: 'Default' }, serverUser);

    // Media source with non-forced container default track
    const mediaSource = {
        Id: 'test-source-server-forced',
        DefaultSubtitleStreamIndex: 2,
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: true, IsForced: false, Title: 'SHD', DisplayTitle: 'SHD - English - Default - SUBRIP' }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, -1, 'Client in Default mode with server set to OnlyForced must return -1 when no forced track exists');
});

test('resolveSubtitleStream: Subtitle mode "Default" selects forced track when server preference is "OnlyForced"', () => {
    const serverUser = {
        Configuration: {
            SubtitleMode: 'OnlyForced',
            SubtitleLanguagePreference: 'eng'
        }
    };

    const { resolveSubtitleStream } = setup({ subtitleMode: 'Default' }, serverUser);

    const mediaSource = {
        Id: 'test-source-server-forced-match',
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: true, IsForced: false, Title: 'Full' },
            { Type: 'Subtitle', Index: 3, Language: 'eng', IsDefault: false, IsForced: true, Title: 'English (Forced)' }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, 3, 'Client in Default mode with server set to OnlyForced must select forced track');
});

test('resolveSubtitleStream: Subtitle mode "Default" defers to server preference "None"', () => {
    const serverUser = {
        Configuration: {
            SubtitleMode: 'None'
        }
    };

    const { resolveSubtitleStream } = setup({ subtitleMode: 'Default' }, serverUser);

    const mediaSource = {
        Id: 'test-source-server-none',
        DefaultSubtitleStreamIndex: 2,
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: true, IsForced: false, Title: 'English' }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, -1, 'Client in Default mode with server set to None must return -1');
});

test('resolveSubtitleStream: Subtitle mode "Always" selects user preferred language track', () => {
    const { resolveSubtitleStream } = setup({
        subtitleMode: 'Always',
        subtitleLanguage: 'spa',
        preferExternalSubtitles: false
    });

    const mediaSource = {
        Id: 'test-source-always',
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: true, IsForced: false },
            { Type: 'Subtitle', Index: 3, Language: 'spa', IsDefault: false, IsForced: false }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, 3, 'Subtitle mode "Always" should pick track matching preferred language');
});

test('resolveSubtitleStream: Subtitle mode "Smart" shows subtitles when audio does not match preferred subtitle language', () => {
    const { resolveSubtitleStream } = setup({
        subtitleMode: 'Smart',
        subtitleLanguage: 'eng'
    });

    const mediaSource = {
        Id: 'test-source-smart-foreign',
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'jpn', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: true, IsForced: false }
        ]
    };

    const result = resolveSubtitleStream(mediaSource, { audioStreamIndex: 1 });
    assert.equal(result, 2, 'Subtitle mode "Smart" should enable English subtitles when audio is Japanese');
});

test('Saved item subtitle guard discards previously saved non-forced track in "OnlyForced" mode', () => {
    const { isForcedStream, getEffectiveSubtitleMode } = setup({
        subtitleMode: 'OnlyForced'
    });

    const effectiveMode = getEffectiveSubtitleMode();
    assert.equal(effectiveMode, 'OnlyForced');

    const mediaSource = {
        Id: 'test-guard-source',
        MediaStreams: [
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true },
            { Type: 'Subtitle', Index: 2, Language: 'eng', IsDefault: false, IsForced: false, DisplayTitle: 'English - PGSSUB' }
        ]
    };

    // Simulate item previously saved track 2 (from before fix)
    let savedSubtitleIndex = 2;
    if (effectiveMode === 'OnlyForced') {
        const stream = mediaSource.MediaStreams.find((s) => s.Type === 'Subtitle' && s.Index === savedSubtitleIndex);
        if (stream && !isForcedStream(stream)) {
            savedSubtitleIndex = undefined;
        }
    }

    assert.equal(savedSubtitleIndex, undefined, 'Saved non-forced track must be cleared in OnlyForced mode');
});
