/**
 * ============================================================================
 * Litefin - WebCodecs Decode Probe
 * ============================================================================
 * Some engines advertise a codec through WebCodecs and then fail every decode()
 * call. WebKitGTK/WPE up to 2.54.0 do this for AV1: VideoDecoder.configure()
 * succeeds, but no GStreamer AV1 decoder accepts the caps it builds, so each
 * chunk fails with "Decode error" (https://bugs.webkit.org/show_bug.cgi?id=327481).
 *
 * isConfigSupported() cannot detect this, so the probe decodes one tiny real
 * frame instead and caches the result for the session. When it fails, the Movi
 * backend stops offering AV1 and AV1 plays through the HTML5 backend instead,
 * until WebKitGTK/WPE releases with the fixes (bugs 327481 and 327483) ship. On
 * those releases the probe passes and Movi plays AV1 again with no code change.
 * ============================================================================
 */

import { logger } from './Logger.js';

const log = logger.create('WebCodecsProbe');

// One 64x64 8-bit AV1 keyframe (temporal unit, low-overhead OBU format, Main profile, level 2.0).
const AV1_PROBE_FRAME = 'EgAKCgAAAAKv/5tfIAgyEBAA5AAAAsAAAAoF8E5WL8A=';
const AV1_PROBE_CODEC = 'av01.0.00M.08';
const PROBE_TIMEOUT_MS = 3000;

class WebCodecsProbe {
    constructor() {
        this._av1Decodes = null;
        this._av1Promise = null;
    }

    /**
     * Result of the AV1 probe: true or false once it has run, null before.
     * @type {boolean|null}
     */
    get av1Decodes() {
        return this._av1Decodes;
    }

    /**
     * Run the AV1 decode probe once per session.
     * @returns {Promise<boolean>} Resolves to true if a real AV1 frame decoded (never rejects).
     */
    probeAV1() {
        if (!this._av1Promise) {
            this._av1Promise = this._decodeOneFrame(AV1_PROBE_CODEC, AV1_PROBE_FRAME, 64, 64).then((decodes) => {
                this._av1Decodes = decodes;
                log.info(
                    `AV1 decode probe: ${decodes ? 'frame decoded' : 'decoding fails, AV1 goes to the HTML5 backend'}`
                );
                return decodes;
            });
        }
        return this._av1Promise;
    }

    _decodeOneFrame(codec, base64Data, width, height) {
        return new Promise((resolve) => {
            if (
                typeof window === 'undefined' ||
                typeof window.VideoDecoder !== 'function' ||
                typeof window.EncodedVideoChunk !== 'function'
            ) {
                resolve(false);
                return;
            }

            let decoder = null;
            let settled = false;
            let timer = null;
            const finish = (decodes, reason) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (!decodes) log.debug(`Probe for ${codec} failed: ${reason}`);
                try {
                    if (decoder && decoder.state !== 'closed') decoder.close();
                } catch (_) {}
                resolve(decodes);
            };
            timer = setTimeout(() => finish(false, 'timeout'), PROBE_TIMEOUT_MS);

            try {
                decoder = new window.VideoDecoder({
                    output: (frame) => {
                        frame.close();
                        finish(true);
                    },
                    error: (err) => finish(false, err?.message || 'decoder error')
                });
                decoder.configure({ codec, codedWidth: width, codedHeight: height });

                const binary = atob(base64Data);
                const data = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
                decoder.decode(new window.EncodedVideoChunk({ type: 'key', timestamp: 0, data }));
                decoder.flush().then(
                    () => finish(false, 'flush completed without output'),
                    (err) => finish(false, err?.message || 'flush failed')
                );
            } catch (err) {
                finish(false, err?.message || 'exception');
            }
        });
    }
}

export const webCodecsProbe = new WebCodecsProbe();
