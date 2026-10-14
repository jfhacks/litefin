const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * sync-locales.cjs
 * 
 * Synchronizes all localization JSON dictionaries in src/locales with en-us.json.
 * Enforces unified key ordering, injects missing keys with English fallbacks,
 * detects English source string modifications to invalidate stale translations for re-translation,
 * and strips obsolete keys.
 */

// Primary locale directory and master reference dictionary
const LOCALE_DIR = path.join(__dirname, '../src/locales');
const EN_JSON_PATH = path.join(LOCALE_DIR, 'en-us.json');

// Structural markers separating core and application-specific keys
const LITEFIN_MARKER = "_Litefin Specific Keys";
const UNTRANSLATED_MARKER = "_Jellyfin Untranslated Keys";

/**
 * Serializes JSON dictionary with clean multi-line indentation and spacing around markers.
 * @param {string} outputPath Destination file path
 * @param {object} jsonObject Dictionary to serialize
 */
function writeJsonWithMarkers(outputPath, jsonObject) {
    // Format JSON with standard 4-space indentation
    let outputString = JSON.stringify(jsonObject, null, 4);

    // Inject empty line before markers for clean git diff readability
    outputString = outputString.replace(
        new RegExp(`^(\\s+)"${UNTRANSLATED_MARKER}"`, 'm'),
        '\n$1"' + UNTRANSLATED_MARKER + '"'
    );
    outputString = outputString.replace(
        new RegExp(`^(\\s+)"${LITEFIN_MARKER}"`, 'm'),
        '\n$1"' + LITEFIN_MARKER + '"'
    );

    // Write file with trailing newline
    fs.writeFileSync(outputPath, outputString + '\n');
}

/**
 * Detects keys whose English source strings have been modified compared to git HEAD.
 * When source English changes, existing translations become invalid and must be reset to English.
 * @param {object} currentEn Master English dictionary
 * @returns {Set<string>} Set of modified key names
 */
function detectModifiedKeys(currentEn) {
    const modified = new Set();

    // Check if explicit keys were passed via command line arguments (--reset key1,key2)
    const resetArgIndex = process.argv.indexOf('--reset');
    if (resetArgIndex !== -1 && process.argv[resetArgIndex + 1]) {
        const explicitKeys = process.argv[resetArgIndex + 1].split(',').map((k) => k.trim());
        explicitKeys.forEach((k) => modified.add(k));
        console.log(`Using explicit reset keys (${modified.size}): ${Array.from(modified).join(', ')}`);
        return modified;
    }

    // Automatically inspect git repository HEAD to detect modified English strings
    try {
        const gitOutput = execSync('git show HEAD:src/locales/en-us.json', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        const headEn = JSON.parse(gitOutput);

        // Compare each entry against the committed version
        for (const [key, value] of Object.entries(currentEn)) {
            // Ignore comment and metadata markers
            if (key.startsWith('_')) continue;

            // Flag keys that existed in HEAD but have modified values
            if (headEn[key] !== undefined && headEn[key] !== value) {
                modified.add(key);
            }
        }

        if (modified.size > 0) {
            console.log(`Detected ${modified.size} modified English keys to reset for re-translation:`);
            modified.forEach((k) => console.log(`  - ${k}`));
        }
    } catch (err) {
        // Fall back gracefully if git command cannot be executed
        console.warn('Note: Git HEAD check unavailable; skipping automatic modified key reset.');
    }

    return modified;
}

/**
 * Main synchronization execution procedure.
 */
function syncLocales() {
    console.log("Starting locale synchronization...");

    // Validate existence of source of truth
    if (!fs.existsSync(EN_JSON_PATH)) {
        console.error(`Error: Could not find master file at ${EN_JSON_PATH}`);
        process.exit(1);
    }

    // 1. Read master dictionary and identify section boundaries
    const enContent = JSON.parse(fs.readFileSync(EN_JSON_PATH, 'utf8'));
    const enEntries = Object.entries(enContent);
    const markerIndex = enEntries.findIndex(([key]) => key === LITEFIN_MARKER);

    // Detect modified keys that need to be invalidated in target languages
    const modifiedKeys = detectModifiedKeys(enContent);

    let sharedKeys;
    let litefinSpecificKeys;

    // Partition and sort keys into shared and custom segments
    if (markerIndex !== -1) {
        sharedKeys = enEntries.slice(0, markerIndex).sort((a, b) => a[0].localeCompare(b[0]));
        litefinSpecificKeys = enEntries.slice(markerIndex + 1).sort((a, b) => a[0].localeCompare(b[0]));
    } else {
        sharedKeys = enEntries.sort((a, b) => a[0].localeCompare(b[0]));
        litefinSpecificKeys = [];
    }

    // Reconstruct normalized master dictionary
    const sortedEnContent = {};
    sharedKeys.forEach(([k, v]) => { sortedEnContent[k] = v; });
    if (markerIndex !== -1) {
        sortedEnContent[LITEFIN_MARKER] = "";
        litefinSpecificKeys.forEach(([k, v]) => { sortedEnContent[k] = v; });
    }

    // Write sorted master en-us.json
    writeJsonWithMarkers(EN_JSON_PATH, sortedEnContent);
    console.log("Verified and sorted en-us.json");

    // 2. Discover and synchronize all target locale files
    const localeFiles = fs.readdirSync(LOCALE_DIR)
        .filter((file) => file.endsWith('.json') && file !== 'en-us.json');

    localeFiles.forEach((file) => {
        const filePath = path.join(LOCALE_DIR, file);
        let currentJson = {};

        try {
            currentJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.warn(`Warning: Could not parse ${file}, starting fresh.`);
        }

        const synchronizedJson = {};

        // Sync Shared Section
        sharedKeys.forEach(([key, enValue]) => {
            // If the English source was modified, reset to English to flag for re-translation
            if (modifiedKeys.has(key)) {
                synchronizedJson[key] = enValue;
            } else {
                // Keep existing translation if valid, or fall back to English
                synchronizedJson[key] = currentJson[key] || enValue;
            }
        });

        // Sync Custom Application Section
        if (markerIndex !== -1) {
            synchronizedJson[LITEFIN_MARKER] = "";
            litefinSpecificKeys.forEach(([key, enValue]) => {
                // Invalidate stale translation if English source changed
                if (modifiedKeys.has(key)) {
                    synchronizedJson[key] = enValue;
                } else {
                    synchronizedJson[key] = currentJson[key] || enValue;
                }
            });
        }

        // Persist synchronized dictionary
        writeJsonWithMarkers(filePath, synchronizedJson);
        console.log(`Synchronized ${file}`);
    });

    console.log("Locale synchronization complete!");
}

// Execute synchronization
syncLocales();
