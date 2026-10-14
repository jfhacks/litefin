/**
 * ============================================================================
 * Litefin Tizen - Audio Fallback Language Configuration
 * ============================================================================
 * Single source of truth for the "fallback audio language" feature: how many
 * fallback slots exist and their storage keys / settings-select ids. Both the
 * SettingsPage (renders the rows) and JellyfinPlayer (resolves the chain) import
 * from here so the slot count can never drift between UI and playback logic.
 */

// Number of fallback audio language slots a user can configure, in priority order.
export const AUDIO_FALLBACK_SLOT_COUNT = 3;

const _slots = [];
for (let i = 1; i <= AUDIO_FALLBACK_SLOT_COUNT; i++) {
    _slots.push(i);
}

// Ordered fallback slot numbers: [1, 2, ...N].
export const AUDIO_FALLBACK_SLOTS = _slots;

// Storage key for each fallback slot, in priority order.
// e.g. ['pref:audioLangFallback1', 'pref:audioLangFallback2', 'pref:audioLangFallback3']
export const AUDIO_FALLBACK_STORAGE_KEYS = _slots.map((n) => 'pref:audioLangFallback' + n);

// Settings-select element id for each fallback slot, in priority order.
// e.g. ['audio-fallback-lang-1-select', 'audio-fallback-lang-2-select', ...]
export const AUDIO_FALLBACK_SELECT_IDS = _slots.map((n) => 'audio-fallback-lang-' + n + '-select');

/**
 * Check whether a settings select id refers to one of the audio fallback slots.
 * @param {string} id - The select element id
 * @returns {boolean} True when the id matches an audio fallback language select
 */
export function isAudioFallbackSelect(id) {
    return typeof id === 'string' && _slots.some((n) => id === 'audio-fallback-lang-' + n + '-select');
}
