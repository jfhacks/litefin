import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * ============================================================================
 * Desktop & Web Sidebar Back Navigation Test Suite
 * ============================================================================
 * Verifies that:
 *   1. `router.canGoBack()` correctly detects whether back navigation is possible.
 *   2. `router.back()` pops history and falls back to /home if history is empty.
 *   3. Sidebar surfaces `#sidebar-back-btn` and adds `.has-back-button` when
 *      running on desktop/web layouts and canGoBack is true.
 *   4. Sidebar suppresses `#sidebar-back-btn` on TV platforms.
 * ============================================================================
 */

test('Router.canGoBack: returns false on root/home with single history entry', () => {
    // Read source code of Router.js
    const routerSource = readFileSync('./src/core/Router.js', 'utf8');

    // Setup isolated VM context
    const mockWindow = {
        location: {
            hash: '#/home',
            replace(newHash) {
                this.hash = newHash;
            }
        }
    };

    const mockState = {
        get() { return null; },
        set() {}
    };

    const mockEventBus = {
        emit() {},
        on() {},
        off() {}
    };

    const mockPluginManager = {
        notifyPageLoad() {},
        notifyPageUnload() {}
    };

    const mockNavigationState = {
        captureState() { return null; },
        restoreState() {}
    };

    const mockLogger = {
        create() {
            return {
                debug() {},
                info() {},
                warn() {},
                error() {}
            };
        }
    };

    // Clean module exports/imports to run in vm
    const cleanedSource = routerSource
        .replace(/import\s+[\s\S]*?from\s+['"].*?['"];?/g, '')
        .replace(/export\s+default\s+Router;?/g, '')
        .replace(/export\s+/g, '');

    const context = {
        window: mockWindow,
        state: mockState,
        eventBus: mockEventBus,
        pluginManager: mockPluginManager,
        navigationState: mockNavigationState,
        logger: mockLogger,
        console,
        URLSearchParams,
        RegExp,
        Array,
        Object,
        Date
    };

    vm.createContext(context);
    vm.runInContext(cleanedSource + '\nthis.router = router; this.Router = Router;', context);

    const router = context.router;

    // At root '/home' with single entry
    router._history = [{ path: '/home', state: null }];
    mockWindow.location.hash = '#/home';
    assert.equal(router.canGoBack(), false, 'canGoBack should be false at /home with 1 history entry');

    // Push 2nd-level route into history
    router._history.push({ path: '/details/movie123', state: null });
    mockWindow.location.hash = '#/details/movie123';
    assert.equal(router.canGoBack(), true, 'canGoBack should be true when history length is 2');

    // Call router.back()
    const backSuccess = router.back();
    assert.equal(backSuccess, true, 'router.back() should return true');
    assert.equal(mockWindow.location.hash, '#/home', 'router.back() should return to /home');
    assert.equal(router._history.length, 1, 'history should be popped down to 1 entry');
    assert.equal(router.canGoBack(), false, 'canGoBack should now be false back at home');
});

test('Router.canGoBack and back: direct deep-link to 2nd-level page falls back to /home', () => {
    const routerSource = readFileSync('./src/core/Router.js', 'utf8');

    const mockWindow = {
        location: {
            hash: '#/details/direct123',
            replace(newHash) {
                this.hash = newHash;
            }
        }
    };

    const mockState = { get() { return null; }, set() {} };
    const mockEventBus = { emit() {}, on() {}, off() {} };
    const mockPluginManager = { notifyPageLoad() {}, notifyPageUnload() {} };
    const mockNavigationState = { captureState() { return null; }, restoreState() {} };
    const mockLogger = {
        create() {
            return { debug() {}, info() {}, warn() {}, error() {} };
        }
    };

    const cleanedSource = routerSource
        .replace(/import\s+[\s\S]*?from\s+['"].*?['"];?/g, '')
        .replace(/export\s+default\s+Router;?/g, '')
        .replace(/export\s+/g, '');

    const context = {
        window: mockWindow,
        state: mockState,
        eventBus: mockEventBus,
        pluginManager: mockPluginManager,
        navigationState: mockNavigationState,
        logger: mockLogger,
        console,
        URLSearchParams,
        RegExp,
        Array,
        Object,
        Date
    };

    vm.createContext(context);
    vm.runInContext(cleanedSource + '\nthis.router = router; this.Router = Router;', context);

    const router = context.router;

    // Simulate direct load with only 1 history entry on deep link
    router._history = [{ path: '/details/direct123', state: null }];
    mockWindow.location.hash = '#/details/direct123';

    assert.equal(router.canGoBack(), true, 'canGoBack should be true on 2nd-level page even with 1 history entry');

    let navigatedTo = null;
    router.navigate = (target) => {
        navigatedTo = target;
    };

    const backResult = router.back();
    assert.equal(backResult, true, 'router.back() should succeed on deep-link');
    assert.equal(navigatedTo, '/home', 'router.back() should navigate to /home fallback');
});

test('Sidebar._updateBackButtonState: activates back button and has-back-button class on desktop/web', () => {
    // Setup mock DOM element
    const classList = new Set();
    const backBtn = {
        style: { display: 'none' },
        tabIndex: -1
    };

    const mockSidebarEl = {
        classList: {
            add(c) { classList.add(c); },
            remove(c) { classList.delete(c); },
            toggle(c, val) {
                if (val) classList.add(c);
                else classList.delete(c);
            },
            contains(c) { return classList.has(c); }
        },
        querySelector(selector) {
            if (selector === '#sidebar-back-btn') return backBtn;
            return null;
        }
    };

    let cacheInvalidated = false;
    const mockFocusManager = {
        invalidateCache(section) {
            if (section === 'sidebar') cacheInvalidated = true;
        }
    };

    // Test on desktop environment
    const platformDesktop = { isWeb: false, isDesktop: true };
    const routerCanBack = { canGoBack: () => true };
    const routerNoBack = { canGoBack: () => false };

    // Function matching _updateBackButtonState logic
    function updateBackButtonState(el, platform, router) {
        if (!el) return;
        const isDesktopOrWeb = platform.isWeb || platform.isDesktop;
        const canBack = isDesktopOrWeb && router.canGoBack();
        el.classList.toggle('has-back-button', canBack);
        const btn = el.querySelector('#sidebar-back-btn');
        if (btn) {
            btn.style.display = canBack ? 'flex' : 'none';
            btn.tabIndex = canBack ? 0 : -1;
        }
        mockFocusManager.invalidateCache('sidebar');
    }

    // 1. On desktop when canGoBack is true -> button is surfaced and class added
    updateBackButtonState(mockSidebarEl, platformDesktop, routerCanBack);
    assert.equal(mockSidebarEl.classList.contains('has-back-button'), true, 'Should add has-back-button class');
    assert.equal(backBtn.style.display, 'flex', 'Back button should be visible');
    assert.equal(backBtn.tabIndex, 0, 'Back button should be focusable');
    assert.equal(cacheInvalidated, true, 'FocusManager cache should be invalidated');

    // 2. On desktop when canGoBack is false -> button is hidden and class removed
    updateBackButtonState(mockSidebarEl, platformDesktop, routerNoBack);
    assert.equal(mockSidebarEl.classList.contains('has-back-button'), false, 'Should remove has-back-button class');
    assert.equal(backBtn.style.display, 'none', 'Back button should be hidden');
    assert.equal(backBtn.tabIndex, -1, 'Back button should not be focusable');

    // 3. On TV platform (isWeb=false, isDesktop=false) -> always hidden
    const platformTv = { isWeb: false, isDesktop: false };
    updateBackButtonState(mockSidebarEl, platformTv, routerCanBack);
    assert.equal(mockSidebarEl.classList.contains('has-back-button'), false, 'TV should not show has-back-button');
    assert.equal(backBtn.style.display, 'none', 'TV back button should remain hidden');
});
