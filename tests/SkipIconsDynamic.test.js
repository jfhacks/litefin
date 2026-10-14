import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Load OSDController source stripped of browser-level imports
const osdSource = readFileSync(new URL('../src/player/osd/OSDController.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default class OSDController', 'class OSDController');

test('OSDController: resolves dynamic rewind and forward icons matching user choice (including 20s and 60s->30s)', () => {
    // Mock settings container
    const settings = {
        skipBackLength: 10000,
        skipForwardLength: 30000
    };

    // Define mock icon lookup table
    const mockIcons = {
        replay5: 'SVG_REPLAY_5',
        replay10: 'SVG_REPLAY_10',
        replay15: 'SVG_REPLAY_15',
        replay20: 'SVG_REPLAY_20',
        replay30: 'SVG_REPLAY_30',
        forward5: 'SVG_FORWARD_5',
        forward10: 'SVG_FORWARD_10',
        forward15: 'SVG_FORWARD_15',
        forward20: 'SVG_FORWARD_20',
        forward30: 'SVG_FORWARD_30',
        fastRewind: 'SVG_FAST_REWIND',
        fastForward: 'SVG_FAST_FORWARD'
    };

    // Set up execution context
    const context = vm.createContext({
        Component: class {},
        document: {
            addEventListener() {},
            removeEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; }
        },
        logger: {
            create: () => ({ info() {}, error() {}, warn() {}, debug() {} })
        },
        PlayerSettings: {
            get: (key) => settings[key]
        },
        osdIcons: mockIcons
    });

    // Run the class definition inside context
    const OSD = vm.runInContext(osdSource + '\nOSDController;', context);
    const osd = Object.create(OSD.prototype);
    osd._config = { seekStepBack: 10000, seekStepForward: 10000 };

    // Verify rewind icons for all supported durations
    assert.equal(osd._getRewindIcon(5), 'SVG_REPLAY_5');
    assert.equal(osd._getRewindIcon(10), 'SVG_REPLAY_10');
    assert.equal(osd._getRewindIcon(15), 'SVG_REPLAY_15');
    assert.equal(osd._getRewindIcon(20), 'SVG_REPLAY_20');
    assert.equal(osd._getRewindIcon(30), 'SVG_REPLAY_30');
    // Verify 60s maps to 30s icon per user requirement
    assert.equal(osd._getRewindIcon(60), 'SVG_REPLAY_30');

    // Verify forward icons for all supported durations
    assert.equal(osd._getForwardIcon(5), 'SVG_FORWARD_5');
    assert.equal(osd._getForwardIcon(10), 'SVG_FORWARD_10');
    assert.equal(osd._getForwardIcon(15), 'SVG_FORWARD_15');
    assert.equal(osd._getForwardIcon(20), 'SVG_FORWARD_20');
    assert.equal(osd._getForwardIcon(30), 'SVG_FORWARD_30');
    // Verify 60s maps to 30s icon per user requirement
    assert.equal(osd._getForwardIcon(60), 'SVG_FORWARD_30');

    // Verify resolving from PlayerSettings when no explicit second count passed
    settings.skipBackLength = 20000;
    settings.skipForwardLength = 5000;
    assert.equal(osd._getRewindIcon(), 'SVG_REPLAY_20');
    assert.equal(osd._getForwardIcon(), 'SVG_FORWARD_5');

    // Verify 60000ms in PlayerSettings maps to 30s icon
    settings.skipBackLength = 60000;
    settings.skipForwardLength = 60000;
    assert.equal(osd._getRewindIcon(), 'SVG_REPLAY_30');
    assert.equal(osd._getForwardIcon(), 'SVG_FORWARD_30');
});
