import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('PlaybackStopReporting: ApiClient reportPlaybackStopped structure and fallback', () => {
    // Read ApiClient source code directly to inspect network call configurations
    const apiSource = readFileSync(
        new URL('../src/api/ApiClient.js', import.meta.url),
        'utf8'
    );

    // Verify reportPlaybackStopped signature accepts info and options
    assert.ok(
        apiSource.includes('async reportPlaybackStopped(info, options = {})'),
        'ApiClient must define reportPlaybackStopped with optional options parameter'
    );

    // Verify reportPlaybackStopped passes options cleanly without hardcoded keepalive: true
    assert.ok(
        apiSource.includes("return this.post('/Sessions/Playing/Stopped', info, options);"),
        'ApiClient must not force keepalive: true on reportPlaybackStopped'
    );

    // Verify request() has graceful fallback for keepalive failures
    // (Specifically for Chromium 69 / Tizen 5.5 where CORS preflight rejects keepalive)
    assert.ok(
        apiSource.includes('fetchOptions.keepalive && fetchErr instanceof TypeError'),
        'ApiClient request() must detect keepalive TypeError failures and retry without keepalive'
    );
});

test('PlaybackStopReporting: PlayerPage provides XHR fallback on async stop failures', () => {
    // Read PlayerPage source code to verify stop reporting resilience
    const playerSource = readFileSync(
        new URL('../src/pages/PlayerPage.js', import.meta.url),
        'utf8'
    );

    // Verify _reportPlaybackStopped catches async failure and falls back to synchronous XHR
    assert.ok(
        playerSource.includes('await api.reportPlaybackStopped(data);'),
        'PlayerPage must call api.reportPlaybackStopped in async path'
    );

    // Ensure synchronous XHR fallback is present if async reporting fails
    assert.ok(
        playerSource.includes('Async stop report failed, executing synchronous XHR fallback:'),
        'PlayerPage must log and trigger synchronous XHR fallback if async stop reporting fails'
    );

    // Ensure fallback dispatches to Sessions/Playing/Stopped endpoint
    assert.ok(
        playerSource.includes('const url = `${api.serverUrl}/Sessions/Playing/Stopped`;'),
        'PlayerPage must construct stop reporting URL for fallback'
    );
});

test('PlaybackStopReporting: Watched completion threshold settings and server MaxResumePct integration', () => {
    // 1. Verify PlayerSettings defaults to '80'
    const settingsSource = readFileSync(
        new URL('../src/utils/PlayerSettings.js', import.meta.url),
        'utf8'
    );
    assert.ok(
        settingsSource.includes("watchedThreshold: '80'"),
        "PlayerSettings must default watchedThreshold to '80'"
    );

    // 2. Verify ApiClient defines getServerConfiguration
    const apiSource = readFileSync(
        new URL('../src/api/ApiClient.js', import.meta.url),
        'utf8'
    );
    assert.ok(
        apiSource.includes('async getServerConfiguration('),
        'ApiClient must define getServerConfiguration'
    );
    assert.ok(
        apiSource.includes("storage.setItem('server:maxResumePct', config.MaxResumePct);"),
        'ApiClient must cache server:maxResumePct when returned'
    );

    // 3. Verify SettingsPage renders watched-threshold-select dropdown and maps it to watchedThreshold
    const settingsPageSource = readFileSync(
        new URL('../src/pages/SettingsPage.js', import.meta.url),
        'utf8'
    );
    assert.ok(
        settingsPageSource.includes("'watched-threshold-select'"),
        'SettingsPage must render watched-threshold-select dropdown'
    );
    assert.ok(
        settingsPageSource.includes("'watched-threshold-select': { type: 'player', key: 'watchedThreshold' }"),
        'SettingsPage settingsMap must bind watched-threshold-select to watchedThreshold'
    );

    // 4. Verify PlayerPage implements _getWatchedThresholdFraction and uses it for near-complete overrides
    const playerSource = readFileSync(
        new URL('../src/pages/PlayerPage.js', import.meta.url),
        'utf8'
    );
    assert.ok(
        playerSource.includes('_getWatchedThresholdFraction()'),
        'PlayerPage must define _getWatchedThresholdFraction'
    );
    assert.ok(
        playerSource.includes("rawPosition >= durationTicks * thresholdFraction"),
        'PlayerPage._reportPlaybackStopped must evaluate near-complete status using resolved threshold fraction'
    );

    // 5. Verify en-us.json contains all required translation keys
    const enUs = JSON.parse(
        readFileSync(new URL('../src/locales/en-us.json', import.meta.url), 'utf8')
    );
    assert.ok(enUs.WatchedThreshold, 'en-us.json must have WatchedThreshold key');
    assert.ok(enUs.WatchedThresholdDescription, 'en-us.json must have WatchedThresholdDescription key');
    assert.ok(enUs.OptionWatchedThreshold80, 'en-us.json must have OptionWatchedThreshold80 key');
    assert.ok(enUs.OptionWatchedThresholdServer, 'en-us.json must have OptionWatchedThresholdServer key');
});

