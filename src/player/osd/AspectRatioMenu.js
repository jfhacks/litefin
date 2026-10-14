import BaseMenu from './BaseMenu.js';
import { osdIcons } from '../../utils/Icons.js';
import { logger } from '../../utils/Logger.js';
import { i18n } from '../../utils/i18n.js';
import { platformInfo } from '../../utils/PlatformInfo.js';

const log = logger.create('AspectRatioMenu');

export default class AspectRatioMenu extends BaseMenu {
    constructor(osdController) {
        super(osdController);
        this.isModal = true;

        // ====================================================================
        // Menu Option Definitions
        // ====================================================================
        // We define supported aspect ratios dynamically per platform backend.
        // Tizen AVPlay supports calculated Zoom, Auto, Stretch, and native Video Aspect Ratio.
        this.options = this._getSupportedOptions();
    }

    /**
     * Determine supported aspect ratio options based on active device platform and player backend.
     *
     * AVPlay Hardware Consideration:
     * - Tizen AVPlay calculates zoom geometry via setDisplayRect (similar to WebOSPlayer)
     *   to seamlessly crop letterbox/pillarbox margins without distorting the picture.
     * - In addition to Auto, Zoom, and Stretch, AVPlay supports native automatic
     *   aspect ratio handling via 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO' ('video_aspect_ratio').
     * - Non-AVPlay platforms (HTML5, ExoPlayer, WebOS) provide standard Auto, Zoom, and Stretch modes.
     *
     * @private
     * @returns {Array<{id: string, label: string, key: string}>}
     */
    _getSupportedOptions() {
        // Detect whether current player backend is Tizen AVPlay via backend type or runtime globals
        const isAvPlay = this.osd?.player?.backendType === 'tizen' ||
            platformInfo.isTizen ||
            (typeof window !== 'undefined' && Boolean(window.webapis?.avplay || window.tizen));

        // When using Samsung AVPlay backend, provide Auto, Zoom, Video Aspect Ratio, and Stretch
        if (isAvPlay) {
            return [
                // Standard letterbox mode preserving geometry with borders
                { id: 'auto', label: i18n.t('Auto'), key: 'Auto' },
                // Math-calculated geometric crop zoom filling the screen
                { id: 'zoom', label: i18n.t('Zoom'), key: 'Zoom' },
                // AVPlay hardware display mode honoring stream DAR / PAR tags
                { id: 'video_aspect_ratio', label: i18n.t('VideoAspectRatio') || 'Video Aspect Ratio', key: 'VideoAspectRatio' },
                // Fullscreen stretch mode filling the physical display panel
                { id: 'stretch', label: i18n.t('Stretch'), key: 'Stretch' }
            ];
        }

        // Standard web, ExoPlayer, and WebOS platforms supporting crop zoom
        return [
            { id: 'auto', label: i18n.t('Auto'), key: 'Auto' },
            { id: 'zoom', label: i18n.t('Zoom'), key: 'Zoom' },
            { id: 'stretch', label: i18n.t('Stretch'), key: 'Stretch' }
        ];
    }

    open() {
        this.focusIndex = 0;

        // Refresh options in case device platform or player backend has updated
        this.options = this._getSupportedOptions();

        // Pre-select current aspect ratio
        const current = this.osd.player.getAspectRatio();
        const index = this.options.findIndex(opt => opt.id === current);
        if (index !== -1) {
            this.focusIndex = index;
        }

        this.render();
        this.show();
    }

    show() {
        // Capture focus context
        this._prevFocus = this.osd._getFocused();
        this._prevRow = this.osd._currentFocusRow;
        this._prevIndex = this.osd._currentFocusIndex;

        this.isVisible = true;
        if (this.$el) {
            this.$el.classList.add('visible');
            this.updateFocus();
        }
    }

    hide() {
        this.isVisible = false;
        if (this.$el) {
            this.$el.classList.remove('visible');
        }

        // Restore focus to Settings Menu if it's open, otherwise back to OSD
        // Note: Logic in OSDController usually handles "back" stack, but here we just restore
        // to where we came from.
        if (this._prevRow !== undefined) {
            this.osd._currentFocusRow = this._prevRow;
            this.osd._currentFocusIndex = this._prevIndex;
            this.osd._updateFocus();

            /*
             * Lock out enter/click inputs for 350ms to absorb any ghost key presses
             * or trailing clicks on the newly focused parent button on the OSD.
             */
            this.osd._focusRestoreLockout = true;
            if (this.osd._focusRestoreLockoutTimer) {
                clearTimeout(this.osd._focusRestoreLockoutTimer);
            }
            this.osd._focusRestoreLockoutTimer = setTimeout(() => {
                this.osd._focusRestoreLockout = false;
                this.osd._focusRestoreLockoutTimer = null;
            }, 350);
        }
    }

    render() {
        if (!this.$el) {
            this.$el = document.createElement('div');
            this.$el.className = 'track-menu-overlay'; // Reuse track menu styles
            document.body.appendChild(this.$el);

            this.$el.addEventListener('click', (e) => {
                if (e.target === this.$el) {
                    this.osd.closeMenu();
                }
            });
        }

        const current = this.osd.player.getAspectRatio();

        // ====================================================================
        // Build Aspect Ratio Options HTML List
        // ====================================================================
        // Maps options to layout templates. The active selection gets a checkmark icon.
        // We reference the unified osdIcons.check icon instead of checkOutline.
        const optionsHtml = this.options.map((opt, i) => {
            const isSelected = opt.id === current;
            const checkIcon = isSelected ? osdIcons.check : '';

            return `
            <button class="track-option track-item ${isSelected ? 'selected' : ''}" 
                    data-id="${opt.id}" data-menu-index="${i}">
                <span class="track-option-label" data-i18n="${opt.key}">${opt.label}</span>
                <span class="track-option-check">${checkIcon}</span>
            </button>
            `;
        }).join('');

        this.$el.innerHTML = `
            <div class="track-menu">
                <div class="track-menu-title" data-i18n="AspectRatio">${i18n.t('AspectRatio')}</div>
                <div class="track-menu-options">
                    ${optionsHtml}
                </div>
            </div>
        `;

        this.$el.querySelectorAll('.track-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                /*
                 * ================================================================
                 * TIZEN TV CLICK ORIGIN GUARD
                 * ================================================================
                 * Discard synthetic focus-clicks and Enter-synthesized clicks (detail === 0
                 * or clientX === 0 && clientY === 0). D-pad Enter is handled exclusively
                 * via handleKey() -> handleEnter().
                 * ================================================================
                 */
                if (btn._programmaticFocus) return;
                if (e.detail === 0) return;
                if (e.clientX === 0 && e.clientY === 0) return;

                this.focusIndex = parseInt(btn.dataset.menuIndex);
                this.handleEnter();
            });
        });

        this.updateFocus();
    }

    handleKey(key) {
        switch (key) {
            case 'up':
                if (this.focusIndex > 0) {
                    this.focusIndex--;
                } else {
                    this.focusIndex = this.options.length - 1;
                }
                this.updateFocus();
                return true;
            case 'down':
                if (this.focusIndex < this.options.length - 1) {
                    this.focusIndex++;
                } else {
                    this.focusIndex = 0;
                }
                this.updateFocus();
                return true;
            case 'enter':
                this.handleEnter();
                return true;
            case 'back':
            case 'left':
            case 'right':
                this.hide();
                // Return to Settings Menu (Options)
                this.osd.toggleSettings(true);
                return true;
        }
        return false;
    }

    handleEnter() {
        const selected = this.options[this.focusIndex];
        if (selected) {
            log.info('Selected aspect ratio:', selected.id);
            this.osd.player.setAspectRatio(selected.id);
            this.osd.closeMenu();
        }
    }

    updateFocus() {
        if (!this.$el) return;
        const options = this.$el.querySelectorAll('.track-option');
        options.forEach((opt, i) => {
            const isFocused = i === this.focusIndex;
            opt.classList.toggle('focused', isFocused);
            if (isFocused) {
                opt._programmaticFocus = true;
                opt.focus({ preventScroll: true });
                setTimeout(() => { opt._programmaticFocus = false; }, 0);
                opt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });
    }
}
